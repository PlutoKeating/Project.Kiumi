import { Icon, type IconName } from './Icon.tsx';

/** A shared, actionable state for resource panels. */
export function PanelState({ title, detail, action, onAction, loading = false, icon, tone }: {
  title: string; detail?: string; action?: string; onAction?: () => void; loading?: boolean; icon?: IconName; tone?: 'error';
}) {
  return <div className="panel-state" role="status" aria-busy={loading} data-tone={tone}>
    {loading && <div className="panel-skeleton" aria-hidden="true"><i /><i /><i /></div>}
    {icon && !loading && <span className="panel-state-icon"><Icon name={icon} size={22} /></span>}
    <strong>{title}</strong>
    {detail && <p>{detail}</p>}
    {action && <button type="button" className="btn btn-tint" onClick={onAction}>{action}</button>}
  </div>;
}
