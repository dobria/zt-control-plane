interface SaveBarProps {
  busy: boolean;
  target: string;
  onReset(): void;
  onSave(): void;
}

export function SaveBar({
  busy,
  target,
  onReset,
  onSave,
}: SaveBarProps) {
  return (
    <div className="sticky-actions">
      <span>
        Unsaved changes · target <strong>{target}</strong>
      </span>
      <button className="button" onClick={onReset}>
        Reset
      </button>
      <button className="button primary" disabled={busy} onClick={onSave}>
        {busy ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
