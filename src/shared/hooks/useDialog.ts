"use client";

import { useEffect, useRef } from "react";

const focusable = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useDialog<T extends HTMLElement>(
  open: boolean,
  close: () => void,
  blocked = false,
) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(close);
  const blockedRef = useRef(blocked);
  useEffect(() => {
    closeRef.current = close;
    blockedRef.current = blocked;
  }, [blocked, close]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(focusable);
    const focusFrame = window.requestAnimationFrame(() =>
      (first || dialog)?.focus(),
    );

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !blockedRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusable));
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open]);

  return dialogRef;
}
