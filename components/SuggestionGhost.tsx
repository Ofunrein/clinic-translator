// Track C1. Greyed ghost-text overlay rendered above an empty <textarea>.
// Tab accepts (calls onAccept). Esc dismisses (calls onDismiss). When the
// underlying textarea has any user-typed content, we hide the ghost.
"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SuggestionGhostProps {
  /** Suggested draft text. Empty hides the ghost layer entirely. */
  suggestion: string;
  /** True while tokens are still streaming in. Used for animated cue. */
  isStreaming?: boolean;
  /** Current textarea value — when non-empty, ghost is hidden. */
  textareaValue: string;
  /** Called when user presses Tab (accepts the full draft). */
  onAccept: () => void;
  /** Called when user presses Esc (dismisses the draft without sending). */
  onDismiss: () => void;
  className?: string;
  /** Called when the user clicks "Insert" to accept via mouse. */
  insertable?: boolean;
}

/**
 * Render-only — the parent owns the textarea and is responsible for
 * positioning this layer absolutely on top of it. We attach our own
 * keydown listener to `document` while visible so Tab/Esc work even
 * when the textarea has focus.
 */
export function SuggestionGhost(props: SuggestionGhostProps): React.ReactElement | null {
  const {
    suggestion,
    isStreaming,
    textareaValue,
    onAccept,
    onDismiss,
    className,
    insertable = true,
  } = props;

  const visible = suggestion.length > 0 && textareaValue.length === 0;

  React.useEffect(() => {
    if (!visible) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Tab") {
        ev.preventDefault();
        onAccept();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible, onAccept, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-md px-3 py-2 text-sm",
        className,
      )}
      aria-hidden="true"
      data-testid="suggestion-ghost"
    >
      <span
        className={cn(
          "line-clamp-2 whitespace-pre-wrap text-muted-foreground/70",
          isStreaming && "animate-pulse",
        )}
      >
        {suggestion}
      </span>
      {insertable ? (
        <span className="ml-2 inline-flex items-center rounded border border-muted-foreground/40 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Tab to insert · Esc to dismiss
        </span>
      ) : null}
    </div>
  );
}
