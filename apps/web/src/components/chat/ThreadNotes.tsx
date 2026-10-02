import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type PointerEvent as ReactPointerEvent, useState } from "react";
import { NotebookPenIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  flushThreadNotes,
  type ThreadNotesSize,
  useThreadNote,
  useThreadNotesStore,
} from "~/threadNotesStore";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const NOTE_TOOLTIP_PREVIEW_LENGTH = 80;

function noteTooltip(note: string) {
  const firstLine = note.trim().split("\n", 1)[0]?.trim() ?? "";
  if (firstLine === "") return "Thread notes";
  return firstLine.length > NOTE_TOOLTIP_PREVIEW_LENGTH
    ? `${firstLine.slice(0, NOTE_TOOLTIP_PREVIEW_LENGTH)}…`
    : firstLine;
}

/**
 * Opens the thread's notepad. Sits in the chat header and is highlighted while
 * the thread has a note.
 */
export function ThreadNotesButton({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const threadKey = scopedThreadKey(threadRef);
  const note = useThreadNote(threadKey);
  const [open, setOpen] = useState(false);
  const hasNote = note !== "";

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) flushThreadNotes();
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={hasNote ? "Thread notes (has notes)" : "Thread notes"}
                  size="icon-xs"
                  type="button"
                  variant="outline"
                />
              }
            />
          }
        >
          <span className="relative">
            <NotebookPenIcon className={cn(hasNote && "text-primary")} />
            {hasNote ? (
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipPopup>
          <p>{noteTooltip(note)}</p>
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup side="bottom" align="end" padding="compact">
        {/* Keyed so switching threads with the popover open starts from that thread's note. */}
        <ThreadNoteEditor
          key={threadKey}
          threadKey={threadKey}
          threadRef={threadRef}
          initialNote={note}
        />
      </PopoverPopup>
    </Popover>
  );
}

const DEFAULT_SIZE: ThreadNotesSize = { width: 512, height: 384 };
const MIN_SIZE: ThreadNotesSize = { width: 288, height: 160 };
// Room left for the popover's own chrome and the header above it.
const VIEWPORT_MARGIN = { width: 32, height: 128 };

function clampSize(size: ThreadNotesSize): ThreadNotesSize {
  return {
    width: Math.round(
      Math.max(MIN_SIZE.width, Math.min(size.width, window.innerWidth - VIEWPORT_MARGIN.width)),
    ),
    height: Math.round(
      Math.max(MIN_SIZE.height, Math.min(size.height, window.innerHeight - VIEWPORT_MARGIN.height)),
    ),
  };
}

// Keeps its own text so whitespace the store treats as "no note" stays in the
// box while typing.
function ThreadNoteEditor({
  threadKey,
  threadRef,
  initialNote,
}: {
  threadKey: string;
  threadRef: ScopedThreadRef;
  initialNote: string;
}) {
  const [text, setText] = useState(initialNote);
  const mode = useThreadNotesStore((state) => state.mode);
  const savedSize = useThreadNotesStore((state) => state.size);
  const [dragSize, setDragSize] = useState<ThreadNotesSize | null>(null);
  const size = clampSize(dragSize ?? savedSize ?? DEFAULT_SIZE);

  // The popover is anchored at its right edge, so the grip sits bottom left and
  // dragging left or down grows the box under the pointer.
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const grip = event.currentTarget;
    const start = { x: event.clientX, y: event.clientY, ...size };
    let latest = size;
    grip.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      latest = clampSize({
        width: start.width - (move.clientX - start.x),
        height: start.height + (move.clientY - start.y),
      });
      setDragSize(latest);
    };
    const onEnd = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onEnd);
      grip.removeEventListener("pointercancel", onEnd);
      useThreadNotesStore.getState().setSize(latest);
      setDragSize(null);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onEnd);
    grip.addEventListener("pointercancel", onEnd);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          Notes for this thread, saved on this device.
        </p>
        <ToggleGroup
          aria-label="Notes view"
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "edit" || next === "preview") {
              useThreadNotesStore.getState().setMode(next);
            }
          }}
        >
          <Toggle value="edit">Edit</Toggle>
          <Toggle value="preview">Preview</Toggle>
        </ToggleGroup>
      </div>
      <div
        className="relative overflow-hidden rounded-lg border border-input bg-background focus-within:border-ring dark:bg-input/32"
        style={{ width: size.width, height: size.height }}
      >
        {mode === "edit" ? (
          <textarea
            aria-label="Thread notes"
            autoFocus
            className="size-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setText(event.target.value);
              useThreadNotesStore.getState().setThreadNote(threadKey, event.target.value);
            }}
            placeholder="Write anything… Markdown shows formatted in Preview."
            value={text}
          />
        ) : (
          <div className="size-full overflow-auto px-3 py-2">
            {text.trim() === "" ? (
              <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
            ) : (
              <ChatMarkdown text={text} cwd={undefined} threadRef={threadRef} />
            )}
          </div>
        )}
        <div
          aria-hidden
          className="absolute bottom-0 left-0 size-4 cursor-nesw-resize touch-none"
          onPointerDown={startResize}
        >
          <span className="absolute bottom-1 left-1 size-2 rounded-bl-sm border-b-2 border-l-2 border-muted-foreground/50" />
        </div>
      </div>
    </div>
  );
}
