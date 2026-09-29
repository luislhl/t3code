import {
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { forkParked } from "../serverActivation.ts";
import { makeIdleCompactionCommandId } from "./idleCompactionCommand.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Compacts idle threads while their provider session is still alive, so the
 * prompt cache is still warm when the summary is written. Without it, the
 * next message after the cache expires re-sends the whole conversation as an
 * uncached write. Adapters opt in with `capabilities.idleCompaction`.
 */
export class IdleCompactionReactor extends Context.Service<
  IdleCompactionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** One pass over live sessions. Exposed so tests can drive it with a test clock. */
    readonly sweep: Effect.Effect<void>;
  }
>()("t3/orchestration/IdleCompactionReactor") {}

const SWEEP_INTERVAL = "30 seconds";
// A sweep reaches a thread within one interval of it becoming due. A thread
// found much later went due while the server was not sweeping, usually while
// the computer slept. Wall-clock time kept running, so its prompt cache has
// likely expired, and compacting now would re-read the history uncached.
const MAX_LATENESS_MS = 2 * 60 * 1000;

type IdleCompactionThread = Pick<
  OrchestrationThreadShell,
  | "session"
  | "latestTurn"
  | "latestUserMessageAt"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "backgroundLiveness"
  | "archivedAt"
  | "settledAt"
>;

/**
 * Whether a thread became due for compaction just now, before reading its
 * context size. Threads past their due time by more than MAX_LATENESS_MS are
 * left for the user to compact on return. `compactedAt` is the latest user
 * message time recorded when this thread was last compacted here: the
 * compaction's own `/compact` message, so the thread stays skipped until the
 * user sends something new.
 */
/** @internal Exported for tests. */
export function isIdleCompactionCandidate(input: {
  readonly thread: IdleCompactionThread;
  readonly idleMs: number;
  readonly now: number;
  readonly compactedAt: string | undefined;
}): boolean {
  const { thread } = input;
  const session = thread.session;
  if (
    session === null ||
    (session.status !== "ready" && session.status !== "idle") ||
    session.activeTurnId !== null ||
    thread.latestUserMessageAt === null ||
    thread.latestUserMessageAt === input.compactedAt ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    // Background subagents and monitors still use the conversation.
    thread.backgroundLiveness != null ||
    // Compacting sends a user message, which would pull these back into view.
    thread.archivedAt !== null ||
    thread.settledAt !== null
  ) {
    return false;
  }
  const lastActivity = Math.max(
    Date.parse(session.updatedAt),
    Date.parse(thread.latestTurn?.completedAt ?? ""),
  );
  if (Number.isNaN(lastActivity)) return false;
  const lateness = input.now - (lastActivity + input.idleMs);
  return lateness >= 0 && lateness <= MAX_LATENESS_MS;
}

const make = Effect.gen(function* () {
  const providerService = yield* ProviderService;
  const snapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const activities = yield* ProjectionThreadActivityRepository;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  // In memory on purpose: a server restart ends every provider session, and
  // only live sessions are compacted.
  const compactedAtByThread = new Map<ThreadId, string>();
  // Snoozed threads being compacted, by the compaction's `/compact` time.
  const snoozesToRestore = new Map<ThreadId, string>();

  /** The latest context size, unless the thread compacted after it. */
  const latestUsedTokens = Effect.fn("IdleCompactionReactor.latestUsedTokens")(function* (
    threadId: ThreadId,
  ) {
    const [latest] = yield* activities.listByThreadId({
      threadId,
      activityKinds: ["context-window.updated", "context-compaction"],
      limit: 1,
    });
    if (latest?.kind !== "context-window.updated") return undefined;
    const payload = Predicate.isObject(latest.payload) ? latest.payload : undefined;
    return Predicate.isNumber(payload?.usedTokens) ? payload.usedTokens : undefined;
  });

  const compactIfIdle = Effect.fn("IdleCompactionReactor.compactIfIdle")(function* (
    threadId: ThreadId,
    policy: { readonly idleMs: number; readonly minTokens: number },
    now: number,
  ) {
    const thread = Option.getOrUndefined(yield* snapshotQuery.getThreadShellById(threadId));
    if (
      thread === undefined ||
      !isIdleCompactionCandidate({
        thread,
        idleMs: policy.idleMs,
        now,
        compactedAt: compactedAtByThread.get(threadId),
      })
    ) {
      return;
    }
    const usedTokens = yield* latestUsedTokens(threadId);
    if (usedTokens === undefined || usedTokens === 0 || usedTokens < policy.minTokens) return;

    const createdAt = DateTime.formatIso(yield* DateTime.now);
    // The same standalone `/compact` turn the composer's Compact context
    // action sends, so messages sent meanwhile queue behind it.
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: makeIdleCompactionCommandId(yield* crypto.randomUUIDv4),
      threadId,
      message: {
        messageId: MessageId.make(yield* crypto.randomUUIDv4),
        role: "user",
        text: "/compact",
        attachments: [],
      },
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt,
    });
    compactedAtByThread.set(threadId, createdAt);
    if (thread.snoozedUntil != null) snoozesToRestore.set(threadId, createdAt);
    yield* Effect.logInfo("thread.idle-compaction.requested", { threadId, usedTokens });
  });

  /**
   * Clients show a snoozed thread again when a turn completes after it was
   * snoozed. Once the compaction turn completes, this snoozes the thread again
   * so the snooze is newer than the compaction.
   */
  const restoreSnooze = Effect.fn("IdleCompactionReactor.restoreSnooze")(function* (
    threadId: ThreadId,
  ) {
    const compactedAt = snoozesToRestore.get(threadId);
    if (compactedAt === undefined) return;
    const thread = Option.getOrUndefined(yield* snapshotQuery.getThreadShellById(threadId));
    const turn = thread?.latestTurn;
    // A newer user message already ended the snooze.
    if (thread === undefined || thread.latestUserMessageAt !== compactedAt) {
      snoozesToRestore.delete(threadId);
      return;
    }
    const completedAt = Date.parse(turn?.completedAt ?? "");
    // Still compacting.
    if (
      turn == null ||
      Number.isNaN(completedAt) ||
      Date.parse(turn.requestedAt) < Date.parse(compactedAt)
    ) {
      return;
    }
    snoozesToRestore.delete(threadId);
    // Only a completed turn wakes a snoozed thread in clients.
    if (turn.state !== "completed" || thread.snoozedUntil == null) return;
    if (thread.snoozedAt != null && Date.parse(thread.snoozedAt) >= completedAt) return;
    const wakeAt = Date.parse(thread.snoozedUntil);
    if (!(wakeAt > (yield* Clock.currentTimeMillis))) return;
    // Snoozing again to the same wake time counts as a duplicate and keeps
    // the old snooze time. One millisecond later stamps a new one.
    yield* engine.dispatch({
      type: "thread.snooze",
      commandId: makeIdleCompactionCommandId(yield* crypto.randomUUIDv4),
      threadId,
      snoozedUntil: DateTime.formatIso(DateTime.makeUnsafe(wakeAt + 1)),
    });
  });

  const restoreSnoozeAfter = (event: OrchestrationEvent) => {
    if (event.type !== "thread.session-set" && event.type !== "thread.turn-diff-completed") {
      return Effect.void;
    }
    const threadId = event.payload.threadId;
    if (!snoozesToRestore.has(threadId)) return Effect.void;
    return restoreSnooze(threadId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("idle compaction snooze not restored", {
          threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  };

  const sweep = Effect.gen(function* () {
    // Catches a completion whose event arrived before the projection showed it.
    for (const threadId of snoozesToRestore.keys()) {
      yield* restoreSnooze(threadId).pipe(Effect.catchCause(() => Effect.void));
    }
    const sessions = yield* providerService.listSessions();
    const now = yield* Clock.currentTimeMillis;
    const liveThreadIds = new Set(sessions.map((session) => session.threadId));
    for (const threadId of compactedAtByThread.keys()) {
      if (!liveThreadIds.has(threadId)) compactedAtByThread.delete(threadId);
    }
    yield* Effect.forEach(
      sessions,
      (session) =>
        Effect.gen(function* () {
          if (session.status !== "ready" || session.providerInstanceId === undefined) return;
          const capabilities = yield* providerService.getCapabilities(session.providerInstanceId);
          if (capabilities.idleCompaction === undefined) return;
          yield* compactIfIdle(session.threadId, capabilities.idleCompaction, now);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("idle compaction skipped", {
              threadId: session.threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      { discard: true },
    );
  });

  const start: IdleCompactionReactor["Service"]["start"] = () =>
    Effect.gen(function* () {
      const events = yield* engine.subscribeDomainEvents;
      yield* forkParked(Stream.runForEach(events, restoreSnoozeAfter));
      yield* forkParked(sweep.pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)), Effect.asVoid));
    });

  return { start, sweep } satisfies IdleCompactionReactor["Service"];
});

export const layer = Layer.effect(IdleCompactionReactor, make);
