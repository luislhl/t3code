import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useThreadNotesStore } from "./threadNotesStore";

const THREAD = "environment-a:thread-1";
const OTHER_THREAD = "environment-a:thread-2";

function setNote(threadKey: string, note: string) {
  useThreadNotesStore.getState().setThreadNote(threadKey, note);
}

describe("threadNotesStore", () => {
  beforeEach(() => {
    useThreadNotesStore.setState({ notesByThreadKey: {} });
  });

  it("keeps each thread's note apart, as typed", () => {
    setNote(THREAD, "  first line\n\nsecond line  ");
    setNote(OTHER_THREAD, "other");

    expect(useThreadNotesStore.getState().notesByThreadKey).toEqual({
      [THREAD]: "  first line\n\nsecond line  ",
      [OTHER_THREAD]: "other",
    });
  });

  it("drops a thread's note when it is cleared or only whitespace", () => {
    setNote(THREAD, "todo");
    setNote(OTHER_THREAD, "keep");

    setNote(THREAD, " \n ");
    expect(useThreadNotesStore.getState().notesByThreadKey).toEqual({ [OTHER_THREAD]: "keep" });

    setNote(OTHER_THREAD, "");
    expect(useThreadNotesStore.getState().notesByThreadKey).toEqual({});
  });
});
