import { CommandId } from "@t3tools/contracts";

const IDLE_COMPACTION_COMMAND_PREFIX = "server:idle-compaction:";

/** Command id of a `/compact` turn IdleCompactionReactor starts. */
export const makeIdleCompactionCommandId = (uuid: string): CommandId =>
  CommandId.make(`${IDLE_COMPACTION_COMMAND_PREFIX}${uuid}`);

/**
 * Idle compaction is maintenance, not the user coming back, so the decider
 * keeps a snooze in place for these turns.
 */
export const isIdleCompactionCommandId = (commandId: string): boolean =>
  commandId.startsWith(IDLE_COMPACTION_COMMAND_PREFIX);
