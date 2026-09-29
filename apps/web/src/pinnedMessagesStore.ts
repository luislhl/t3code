/**
 * Messages the user pinned in each thread, keyed by scoped thread key.
 *
 * Pins live in this browser only. They are a reading aid, so they stay out
 * of the server's event log and do not sync across clients.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const PINNED_MESSAGES_STORAGE_KEY = "t3code:pinned-messages:v1";
const PINNED_MESSAGE_PREVIEW_LENGTH = 200;

export interface PinnedMessage {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  /** When the message was sent. Pins are listed in thread order. */
  readonly createdAt: string;
  /** Kept with the pin so pins of messages that are not loaded still read as something. */
  readonly preview: string;
}

interface PinnedMessagesStoreState {
  pinnedMessagesByThreadKey: Record<string, ReadonlyArray<PinnedMessage>>;
  pinMessage: (
    threadKey: string,
    message: Omit<PinnedMessage, "preview"> & { readonly text: string },
  ) => void;
  unpinMessage: (threadKey: string, messageId: string) => void;
}

const EMPTY_PINNED_MESSAGES: ReadonlyArray<PinnedMessage> = [];

// Drops bold and code markers, which read as noise in a one-line preview.
function pinnedMessagePreview(text: string) {
  return text
    .replace(/\*\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PINNED_MESSAGE_PREVIEW_LENGTH);
}

export const usePinnedMessagesStore = create<PinnedMessagesStoreState>()(
  persist(
    (set) => ({
      pinnedMessagesByThreadKey: {},
      pinMessage: (threadKey, { text, ...message }) =>
        set((state) => {
          const pins = state.pinnedMessagesByThreadKey[threadKey] ?? EMPTY_PINNED_MESSAGES;
          if (pins.some((pin) => pin.messageId === message.messageId)) return state;
          const nextPins = [...pins, { ...message, preview: pinnedMessagePreview(text) }].toSorted(
            (left, right) => left.createdAt.localeCompare(right.createdAt),
          );
          return {
            pinnedMessagesByThreadKey: {
              ...state.pinnedMessagesByThreadKey,
              [threadKey]: nextPins,
            },
          };
        }),
      unpinMessage: (threadKey, messageId) =>
        set((state) => {
          const pins = state.pinnedMessagesByThreadKey[threadKey];
          if (!pins?.some((pin) => pin.messageId === messageId)) return state;
          const { [threadKey]: _removed, ...rest } = state.pinnedMessagesByThreadKey;
          const nextPins = pins.filter((pin) => pin.messageId !== messageId);
          return {
            pinnedMessagesByThreadKey:
              nextPins.length === 0 ? rest : { ...rest, [threadKey]: nextPins },
          };
        }),
    }),
    {
      name: PINNED_MESSAGES_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ pinnedMessagesByThreadKey: state.pinnedMessagesByThreadKey }),
    },
  ),
);

export function useThreadPinnedMessages(threadKey: string) {
  return usePinnedMessagesStore(
    (state) => state.pinnedMessagesByThreadKey[threadKey] ?? EMPTY_PINNED_MESSAGES,
  );
}

export function useIsMessagePinned(threadKey: string, messageId: string) {
  return usePinnedMessagesStore(
    (state) =>
      state.pinnedMessagesByThreadKey[threadKey]?.some((pin) => pin.messageId === messageId) ??
      false,
  );
}
