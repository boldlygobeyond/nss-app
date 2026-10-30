"use client";

// NSS's own "Send all pending" has no confirmation at all today — this is
// new for NRS, since the spec requires showing a recipient count before a
// bulk send/remind goes out. A plain hand-rolled overlay, matching this
// codebase's general preference for no new UI-kit dependency; the
// single-recipient resend flow elsewhere keeps the lighter existing
// window.confirm() pattern, this is only for the two bulk actions.
export default function BulkSendConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-card border border-border/50 rounded-2xl p-6 w-full max-w-sm shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-base font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-5">{description}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-9 px-4 text-sm font-medium border border-border/50 rounded-lg hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="h-9 px-4 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
