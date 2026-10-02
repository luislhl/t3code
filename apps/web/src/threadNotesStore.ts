/**
 * The user's plain-text note for each thread, keyed by scoped thread key.
 *
 * Notes live in this browser only. They are a scratchpad for the user, so they
 * stay out of the server's event log and do not sync across clients.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDeferredStorage } from "./lib/storage";

const THREAD_NOTES_STORAGE_KEY = "t3code:thread-notes:v1";
const THREAD_NOTES_PERSIST_DEBOUNCE_MS = 500;

export type ThreadNotesMode = "edit" | "preview";

export interface ThreadNotesSize {
  readonly width: number;
  readonly height: number;
}

interface ThreadNotesStoreState {
  notesByThreadKey: Record<string, string>;
  /** The notepad's last mode and size, shared by every thread. */
  mode: ThreadNotesMode;
  size: ThreadNotesSize | null;
  setThreadNote: (threadKey: string, note: string) => void;
  setMode: (mode: ThreadNotesMode) => void;
  setSize: (size: ThreadNotesSize) => void;
}

// Notes change on every keystroke; write them once typing pauses.
const threadNotesStorage = createDeferredStorage<string>(
  typeof window !== "undefined" ? window.localStorage : undefined,
  (value) => value,
  THREAD_NOTES_PERSIST_DEBOUNCE_MS,
);

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    threadNotesStorage.flush();
  });
}

export const useThreadNotesStore = create<ThreadNotesStoreState>()(
  persist(
    (set) => ({
      notesByThreadKey: {},
      mode: "edit",
      size: null,
      setThreadNote: (threadKey, note) =>
        set((state) => {
          if ((state.notesByThreadKey[threadKey] ?? "") === note) return state;
          const { [threadKey]: _removed, ...rest } = state.notesByThreadKey;
          // A note of only whitespace counts as empty, so the thread stops showing one.
          return {
            notesByThreadKey: note.trim() === "" ? rest : { ...rest, [threadKey]: note },
          };
        }),
      setMode: (mode) => set({ mode }),
      setSize: (size) => set({ size }),
    }),
    {
      name: THREAD_NOTES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => threadNotesStorage),
      partialize: (state) => ({
        notesByThreadKey: state.notesByThreadKey,
        mode: state.mode,
        size: state.size,
      }),
    },
  ),
);

/** Writes pending note edits to storage now. */
export function flushThreadNotes() {
  threadNotesStorage.flush();
}

export function useThreadNote(threadKey: string) {
  return useThreadNotesStore((state) => state.notesByThreadKey[threadKey] ?? "");
}
