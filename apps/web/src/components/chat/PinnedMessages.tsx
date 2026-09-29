import { memo, type RefObject, useMemo, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { PinIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  type PinnedMessage,
  useIsMessagePinned,
  usePinnedMessagesStore,
  useThreadPinnedMessages,
} from "~/pinnedMessagesStore";
import type { ChatMessage } from "~/types";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { MessagesTimelineRow } from "./MessagesTimeline.logic";

/** Pins or unpins a message. Sits beside the message's copy button. */
export const PinMessageButton = memo(function PinMessageButton({
  threadKey,
  message,
}: {
  threadKey: string;
  message: ChatMessage;
}) {
  const pinned = useIsMessagePinned(threadKey, message.id);
  if (message.role !== "user" && message.role !== "assistant") return null;
  const role = message.role;
  const label = pinned ? "Unpin message" : "Pin message";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={pinned}
            onClick={() => {
              const store = usePinnedMessagesStore.getState();
              if (pinned) {
                store.unpinMessage(threadKey, message.id);
              } else {
                store.pinMessage(threadKey, {
                  messageId: message.id,
                  role,
                  createdAt: message.createdAt,
                  text: message.text,
                });
              }
            }}
            size="xs"
            type="button"
            variant="ghost-muted"
          />
        }
      >
        <PinIcon className={cn("size-3", pinned && "fill-current text-primary")} />
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});

const PINNED_MESSAGE_TOP_OFFSET = 24;
const MAX_SCROLL_CORRECTIONS = 10;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Scrolls a row to the top of the timeline. Index scrolling lands on row size
 * estimates, which are far off across unmeasured history, so this corrects
 * from the mounted row until it holds still.
 */
async function scrollToRow(list: LegendListRef, rowKey: string) {
  const startIndex = list.getState().indexByKey(rowKey);
  if (startIndex === undefined) return;
  await list.scrollToIndex({
    index: startIndex,
    animated: false,
    viewOffset: PINNED_MESSAGE_TOP_OFFSET,
  });
  for (let attempt = 0; attempt < MAX_SCROLL_CORRECTIONS; attempt += 1) {
    await nextFrame();
    const state = list.getState();
    const index = state.indexByKey(rowKey);
    const row: unknown = index === undefined ? undefined : state.elementAtIndex(index);
    const scrollNode = list.getScrollableNode();
    if (!(row instanceof Element) || !(scrollNode instanceof Element)) continue;
    const offset = Math.max(
      0,
      Math.min(
        scrollNode.scrollHeight - scrollNode.clientHeight,
        scrollNode.scrollTop +
          row.getBoundingClientRect().top -
          scrollNode.getBoundingClientRect().top -
          PINNED_MESSAGE_TOP_OFFSET,
      ),
    );
    if (Math.abs(offset - scrollNode.scrollTop) <= 1) return;
    await list.scrollToOffset({ offset, animated: false });
  }
}

/**
 * The thread's pinned messages, in the top left of the timeline. Choosing one
 * scrolls to it. Renders nothing while the thread has no pins.
 */
export function PinnedMessages({
  threadKey,
  rows,
  hasEarlierMessages,
  listRef,
  onNavigate,
}: {
  threadKey: string;
  rows: ReadonlyArray<MessagesTimelineRow>;
  /** Whether older turns exist beyond the loaded rows. */
  hasEarlierMessages: boolean;
  listRef: RefObject<LegendListRef | null>;
  /** Called before scrolling, so the timeline stops following new output. */
  onNavigate: () => void;
}) {
  const pins = useThreadPinnedMessages(threadKey);
  const [open, setOpen] = useState(false);
  if (pins.length === 0) return null;

  return (
    <div className="absolute top-3 left-3 z-40">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              aria-label={`${pins.length} pinned ${pins.length === 1 ? "message" : "messages"}`}
              size="xs"
              type="button"
              variant="ghost-muted"
            />
          }
        >
          <PinIcon />
          <span className="tabular-nums">{pins.length}</span>
        </PopoverTrigger>
        <PopoverPopup side="bottom" align="start" width="md" padding="compact">
          <PinnedMessageList
            threadKey={threadKey}
            pins={pins}
            rows={rows}
            hasEarlierMessages={hasEarlierMessages}
            onSelect={(rowKey) => {
              setOpen(false);
              const list = listRef.current;
              if (!list) return;
              onNavigate();
              void scrollToRow(list, rowKey);
            }}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
}

// Mounted only while the popover is open, so streaming rows do not rebuild
// the lookup.
function PinnedMessageList({
  threadKey,
  pins,
  rows,
  hasEarlierMessages,
  onSelect,
}: {
  threadKey: string;
  pins: ReadonlyArray<PinnedMessage>;
  rows: ReadonlyArray<MessagesTimelineRow>;
  hasEarlierMessages: boolean;
  onSelect: (rowKey: string) => void;
}) {
  const rowKeyByMessageId = useMemo(() => {
    const keys = new Map<string, string>();
    for (const row of rows) {
      if (row.kind === "message") keys.set(row.message.id, row.id);
    }
    return keys;
  }, [rows]);

  return (
    <ul className="flex flex-col gap-0.5">
      {pins.map((pin) => {
        const rowKey = rowKeyByMessageId.get(pin.messageId);
        return (
          <li className="flex items-start gap-1" key={pin.messageId}>
            <button
              className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left not-disabled:hover:bg-accent disabled:cursor-default"
              disabled={rowKey === undefined}
              onClick={() => {
                if (rowKey !== undefined) onSelect(rowKey);
              }}
              type="button"
            >
              <span className="block text-muted-foreground text-xs">
                {pin.role === "user" ? "You" : "T3 Code"}
              </span>
              <span
                className={cn(
                  "line-clamp-2 text-sm [overflow-wrap:anywhere]",
                  rowKey === undefined && "text-muted-foreground",
                )}
              >
                {pin.preview || "(empty message)"}
              </span>
              {rowKey === undefined ? (
                <span className="mt-0.5 block text-muted-foreground text-xs">
                  {hasEarlierMessages
                    ? "Scroll up to load earlier messages, then jump here."
                    : "No longer in this thread."}
                </span>
              ) : null}
            </button>
            <Button
              aria-label="Unpin message"
              onClick={() =>
                usePinnedMessagesStore.getState().unpinMessage(threadKey, pin.messageId)
              }
              size="icon-micro"
              type="button"
              variant="ghost-muted"
            >
              <XIcon />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
