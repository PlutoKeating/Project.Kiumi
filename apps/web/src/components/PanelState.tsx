/** A shared, actionable state for resource panels. */
export function PanelState({ title, detail, action, onAction, loading = false }: {
  title: string; detail?: string; action?: string; onAction?: () => void; loading?: boolean;
}) {
  return <div className="panel-state" role="status" aria-busy={loading}>
    {loading && <div className="panel-skeleton" aria-hidden="true"><i /><i /><i /></div>}
    <strong>{title}</strong>
    {detail && <p>{detail}</p>}
    {action && <button onClick={onAction}>{action}</button>}
  </div>;
}
