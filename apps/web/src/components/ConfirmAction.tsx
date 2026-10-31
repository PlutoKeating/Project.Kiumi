import { useRef, useState } from 'react';

/** Inline confirmation keeps the affected item and its consequence in view. */
export function ConfirmAction({ label, question, busy, onConfirm }: {
  label: string; question: string; busy: boolean; onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  if (!confirming) return <button ref={trigger} disabled={busy} className="danger-link" onClick={() => setConfirming(true)}>{label}</button>;
  return <div className="inline-confirmation" data-confirmation role="group" aria-label={question} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) cancel(); }
  }}>
    <p>{question}</p>
    <div><button autoFocus disabled={busy} onClick={cancel}>取消</button><button className="confirm-destructive" disabled={busy} onClick={async () => { await onConfirm(); cancel(); }}>{busy ? '处理中…' : `确认${label}`}</button></div>
  </div>;
}
