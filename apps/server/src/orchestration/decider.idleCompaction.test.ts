import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { makeIdleCompactionCommandId } from "./idleCompactionCommand.ts";

const NOW = "2026-01-01T00:00:00.000Z";
// The decider's clock is the Effect test clock, pinned to the epoch.
const FUTURE_WAKE = "1970-01-02T09:00:00.000Z";

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
  threads: [
    {
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-5-5",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: FUTURE_WAKE,
      snoozedAt: "1969-12-30T00:00:00.000Z",
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: NOW,
};

const compactTurn = (commandId: CommandId) =>
  decideOrchestrationCommand({
    command: {
      type: "thread.turn.start",
      commandId,
      threadId: ThreadId.make("thread-1"),
      message: {
        messageId: MessageId.make("message-1"),
        role: "user",
        text: "/compact",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: NOW,
    },
    readModel,
  }).pipe(Effect.map((result) => (Array.isArray(result) ? result : [result])));

it.layer(NodeServices.layer)("idle compaction decider", (it) => {
  it.effect("keeps a snooze through an idle compaction", () =>
    Effect.gen(function* () {
      const idle = yield* compactTurn(makeIdleCompactionCommandId("uuid-1"));
      expect(idle.map((event) => event.type)).not.toContain("thread.unsnoozed");
      expect(idle.map((event) => event.type)).toContain("thread.turn-start-requested");

      // The same message from the user still ends the snooze.
      const manual = yield* compactTurn(CommandId.make("cmd-manual-compact"));
      expect(manual.map((event) => event.type)).toContain("thread.unsnoozed");
    }),
  );
});
