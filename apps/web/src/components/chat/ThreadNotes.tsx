import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";
import { NotebookPenIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { flushThreadNotes, useThreadNote, useThreadNotesStore } from "~/threadNotesStore";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
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
  const threadKey = scopedThreadKey(scopeThreadRef(environmentId, threadId));
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
      <PopoverPopup side="bottom" align="end" width="lg" padding="compact">
        {/* Keyed so switching threads with the popover open starts from that thread's note. */}
        <ThreadNoteEditor key={threadKey} threadKey={threadKey} initialNote={note} />
      </PopoverPopup>
    </Popover>
  );
}

// Keeps its own text so whitespace the store treats as "no note" stays in the
// box while typing.
function ThreadNoteEditor({ threadKey, initialNote }: { threadKey: string; initialNote: string }) {
  const [text, setText] = useState(initialNote);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-xs">Notes for this thread, saved on this device.</p>
      <Textarea
        aria-label="Thread notes"
        autoFocus
        onChange={(event) => {
          setText(event.target.value);
          useThreadNotesStore.getState().setThreadNote(threadKey, event.target.value);
        }}
        placeholder="Write anything…"
        size="sm"
        value={text}
      />
    </div>
  );
}
