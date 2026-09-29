import { beforeEach, describe, expect, it } from "vite-plus/test";

import { usePinnedMessagesStore } from "./pinnedMessagesStore";

const THREAD = "environment-a:thread-1";
const OTHER_THREAD = "environment-a:thread-2";

function pin(threadKey: string, messageId: string, createdAt: string, text = "hello") {
  usePinnedMessagesStore
    .getState()
    .pinMessage(threadKey, { messageId, role: "user", createdAt, text });
}

function pinnedIds(threadKey: string) {
  return (usePinnedMessagesStore.getState().pinnedMessagesByThreadKey[threadKey] ?? []).map(
    (entry) => entry.messageId,
  );
}

describe("pinnedMessagesStore", () => {
  beforeEach(() => {
    usePinnedMessagesStore.persist.clearStorage();
    usePinnedMessagesStore.setState({ pinnedMessagesByThreadKey: {} });
  });

  it("lists pins in thread order, not pin order", () => {
    pin(THREAD, "late", "2026-09-29T12:00:00.000Z");
    pin(THREAD, "early", "2026-09-29T10:00:00.000Z");
    pin(THREAD, "middle", "2026-09-29T11:00:00.000Z");

    expect(pinnedIds(THREAD)).toEqual(["early", "middle", "late"]);
  });

  it("keeps each thread's pins apart and ignores a second pin of one message", () => {
    pin(THREAD, "message-1", "2026-09-29T10:00:00.000Z");
    pin(THREAD, "message-1", "2026-09-29T10:00:00.000Z");
    pin(OTHER_THREAD, "message-2", "2026-09-29T10:00:00.000Z");

    expect(pinnedIds(THREAD)).toEqual(["message-1"]);
    expect(pinnedIds(OTHER_THREAD)).toEqual(["message-2"]);
  });

  it("drops the thread entry when its last pin is removed", () => {
    pin(THREAD, "message-1", "2026-09-29T10:00:00.000Z");
    pin(THREAD, "message-2", "2026-09-29T11:00:00.000Z");
    const { unpinMessage } = usePinnedMessagesStore.getState();

    unpinMessage(THREAD, "message-1");
    expect(pinnedIds(THREAD)).toEqual(["message-2"]);

    unpinMessage(THREAD, "message-2");
    expect(usePinnedMessagesStore.getState().pinnedMessagesByThreadKey).toEqual({});
  });

  it("keeps a one-line plain preview of the message", () => {
    pin(
      THREAD,
      "message-1",
      "2026-09-29T10:00:00.000Z",
      `  **first** line\n\n\`second\` ${"x".repeat(300)}`,
    );

    const [entry] = usePinnedMessagesStore.getState().pinnedMessagesByThreadKey[THREAD] ?? [];
    expect(entry?.preview.startsWith("first line second x")).toBe(true);
    expect(entry?.preview).toHaveLength(200);
  });
});
