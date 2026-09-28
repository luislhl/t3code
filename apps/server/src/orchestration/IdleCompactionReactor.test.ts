import {
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type ProviderSession,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";
import type { ProviderAdapterCapabilities } from "../provider/Services/ProviderAdapter.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as IdleCompactionReactor from "./IdleCompactionReactor.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const THREAD_ID = ThreadId.make("idle-thread");
const INSTANCE_ID = ProviderInstanceId.make("claudeAgent");
const TURN_COMPLETED_AT = "2026-09-25T12:00:00.000Z";
const MINUTE = 60_000;
const IDLE = { idleMs: 25 * MINUTE, minTokens: 100_000 };

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(1),
  digest: (_algorithm, data) => Effect.succeed(data),
});

function makeThread(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("idle-project"),
    title: "Idle thread",
    modelSelection: { instanceId: INSTANCE_ID, model: "claude-opus-5-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    pullRequests: [],
    branch: null,
    worktreePath: null,
    latestTurn: {
      turnId: TurnId.make("turn-1"),
      state: "completed",
      requestedAt: "2026-09-25T11:58:00.000Z",
      startedAt: "2026-09-25T11:58:00.000Z",
      completedAt: TURN_COMPLETED_AT,
      assistantMessageId: null,
    },
    createdAt: "2026-09-25T11:00:00.000Z",
    updatedAt: TURN_COMPLETED_AT,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: {
      threadId: THREAD_ID,
      status: "ready",
      providerName: "claudeAgent",
      providerInstanceId: INSTANCE_ID,
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: TURN_COMPLETED_AT,
    },
    latestUserMessageAt: "2026-09-25T11:58:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

const makeHarness = (input: {
  readonly usedTokens: number;
  readonly capabilities?: ProviderAdapterCapabilities;
  readonly sessionStatus?: ProviderSession["status"];
}) => {
  let thread = makeThread();
  const commands: Array<OrchestrationCommand> = [];
  const session: ProviderSession = {
    provider: ProviderDriverKind.make("claudeAgent"),
    providerInstanceId: INSTANCE_ID,
    status: input.sessionStatus ?? "ready",
    runtimeMode: "full-access",
    threadId: THREAD_ID,
    createdAt: "2026-09-25T11:00:00.000Z",
    updatedAt: TURN_COMPLETED_AT,
  };

  const layer = IdleCompactionReactor.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProviderService)({
          listSessions: () => Effect.succeed([session]),
          getCapabilities: () =>
            Effect.succeed(
              input.capabilities ?? { sessionModelSwitch: "in-session", idleCompaction: IDLE },
            ),
        }),
        Layer.mock(ProjectionSnapshotQuery)({
          getThreadShellById: () => Effect.sync(() => Option.some(thread)),
        }),
        Layer.mock(ProjectionThreadActivityRepository)({
          listByThreadId: () =>
            Effect.succeed([
              {
                activityId: EventId.make("usage-1"),
                threadId: THREAD_ID,
                turnId: TurnId.make("turn-1"),
                tone: "info",
                kind: "context-window.updated",
                summary: "Context window updated",
                payload: { usedTokens: input.usedTokens },
                createdAt: TURN_COMPLETED_AT,
              },
            ]),
        }),
        Layer.mock(OrchestrationEngineService)({
          readEvents: () => Stream.empty,
          streamDomainEvents: Stream.empty,
          latestSequence: Effect.succeed(0),
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              // Mirror the projection: the `/compact` message becomes the latest user message.
              if (command.type === "thread.turn.start") {
                thread = { ...thread, latestUserMessageAt: command.createdAt };
              }
              return { sequence: commands.length };
            }),
        }),
        Layer.succeed(Crypto.Crypto, testCrypto),
      ),
    ),
  );
  return { commands, layer };
};

const sweepAt = (minutesIdle: number) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(TURN_COMPLETED_AT) + minutesIdle * MINUTE);
    const reactor = yield* IdleCompactionReactor.IdleCompactionReactor;
    yield* reactor.sweep;
  });

describe("isIdleCompactionCandidate", () => {
  const now = Date.parse(TURN_COMPLETED_AT) + 25.5 * MINUTE;
  const candidate = (overrides: Partial<OrchestrationThreadShell>, compactedAt?: string): boolean =>
    IdleCompactionReactor.isIdleCompactionCandidate({
      thread: makeThread(overrides),
      idleMs: IDLE.idleMs,
      now,
      compactedAt,
    });

  it("accepts a quiet thread with a live session", () => {
    assert.isTrue(candidate({}));
  });

  it("measures idle time from the latest session or turn activity", () => {
    const recent = DateTime.formatIso(DateTime.makeUnsafe(now - 10 * MINUTE));
    assert.isFalse(candidate({ session: { ...makeThread().session!, updatedAt: recent } }));
    assert.isFalse(candidate({ latestTurn: { ...makeThread().latestTurn!, completedAt: recent } }));
  });

  it("skips threads that are busy or waiting on the user", () => {
    assert.isFalse(candidate({ session: { ...makeThread().session!, status: "running" } }));
    assert.isFalse(candidate({ hasPendingApprovals: true }));
    assert.isFalse(candidate({ hasPendingUserInput: true }));
    assert.isFalse(candidate({ backgroundLiveness: "working" }));
  });

  it("skips threads a new user message would pull back into view", () => {
    assert.isFalse(candidate({ archivedAt: TURN_COMPLETED_AT }));
    assert.isFalse(candidate({ settledAt: TURN_COMPLETED_AT }));
  });

  it("leaves a thread that went due while the server was not sweeping", () => {
    const lateBy = (minutes: number) =>
      IdleCompactionReactor.isIdleCompactionCandidate({
        thread: makeThread(),
        idleMs: IDLE.idleMs,
        now: Date.parse(TURN_COMPLETED_AT) + IDLE.idleMs + minutes * MINUTE,
        compactedAt: undefined,
      });
    assert.isTrue(lateBy(2));
    // After the computer slept, the prompt cache has likely expired.
    assert.isFalse(lateBy(2.5));
    assert.isFalse(lateBy(120));
  });

  it("skips a thread already compacted since its latest user message", () => {
    assert.isFalse(candidate({}, makeThread().latestUserMessageAt!));
  });
});

describe("IdleCompactionReactor", () => {
  it.effect("compacts once after the idle time, then waits for a new user message", () => {
    const harness = makeHarness({ usedTokens: 250_000 });
    return Effect.gen(function* () {
      yield* sweepAt(24);
      assert.equal(harness.commands.length, 0);

      yield* sweepAt(25);
      assert.equal(harness.commands.length, 1);
      const [command] = harness.commands;
      assert.equal(command?.type, "thread.turn.start");
      if (command?.type === "thread.turn.start") {
        assert.equal(command.threadId, THREAD_ID);
        assert.equal(command.message.text, "/compact");
        assert.deepEqual(command.message.attachments, []);
      }

      yield* sweepAt(25.5);
      assert.equal(harness.commands.length, 1);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does not compact after the computer slept past the idle time", () => {
    const harness = makeHarness({ usedTokens: 250_000 });
    return Effect.gen(function* () {
      yield* sweepAt(24);
      yield* sweepAt(120);
      assert.equal(harness.commands.length, 0);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("leaves threads below the token minimum alone", () => {
    const harness = makeHarness({ usedTokens: 99_999 });
    return Effect.gen(function* () {
      yield* sweepAt(26);
      assert.equal(harness.commands.length, 0);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does nothing when the instance has idle compaction off", () => {
    const harness = makeHarness({
      usedTokens: 250_000,
      capabilities: { sessionModelSwitch: "in-session" },
    });
    return Effect.gen(function* () {
      yield* sweepAt(26);
      assert.equal(harness.commands.length, 0);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("does not compact while the provider session is still working", () => {
    const harness = makeHarness({ usedTokens: 250_000, sessionStatus: "running" });
    return Effect.gen(function* () {
      yield* sweepAt(26);
      assert.equal(harness.commands.length, 0);
    }).pipe(Effect.provide(harness.layer));
  });
});
