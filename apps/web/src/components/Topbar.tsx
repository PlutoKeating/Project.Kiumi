import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../api.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';
import { IconButton, PopMenu } from './ui.tsx';
import { WechatPanel } from './WechatPanel.tsx';
import { Workspace } from './Workspace.tsx';

function userLabel(user: { sub: string; name?: string; email?: string }): string {
  if (user.name && user.name !== user.sub) return user.name;
  if (user.email) return user.email;
  return '已登录';
}

/** Identity on the left, delivery on the right; the article stays visible between them. */
export function Topbar({ session, workspaceVersion, onWorkspaceChange, onPreview, onCopy, onExport }: {
  session: SessionState | null;
  workspaceVersion: number;
  onWorkspaceChange: () => void;
  onPreview: () => void;
  onCopy: () => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const title = useStore((state) => state.doc.title);
  const doc = useStore((state) => state.doc);
  const save = useStore((state) => state.save);
  const newDoc = useStore((state) => state.newDoc);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const canUndo = useStore((state) => state.past.length > 0);
  const canRedo = useStore((state) => state.future.length > 0);
  const [saving, setSaving] = useState<'idle' | 'busy' | 'done'>('idle');
  const [copied, setCopied] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => setSaving('idle'), [doc]);

  const later = (run: () => void, delay: number) => { timers.current.push(setTimeout(run, delay)); };
  const report = (prefix: string, error: unknown) => useStore.setState({ message: `${prefix}：${(error as Error).message}` });
  const runSave = async () => {
    setSaving('busy');
    await save();
    setSaving('done');
    later(() => setSaving('idle'), 1800);
  };
  const runCopy = async () => {
    try {
      await onCopy();
      setCopied(true);
      later(() => setCopied(false), 1800);
    } catch (error) { report('复制失败', error); }
  };

  return (
    <header className="topbar">
      <div className="capsule capsule-identity">
        <span className="brand" aria-label="Kiumi">
          <svg className="brand-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
            <defs><linearGradient id="brand-drop" x1="4" y1="3" x2="24" y2="26" gradientUnits="userSpaceOnUse"><stop stopColor="#a8cbff" /><stop offset=".55" stopColor="#cdbfff" /><stop offset="1" stopColor="#ffb9d6" /></linearGradient></defs>
            <path d="M14 2.500c5.200 5.600 9.500 9.900 9.500 14.300a9.500 9.500 0 0 1-19 0C4.500 12.400 8.800 8.100 14 2.500Z" fill="url(#brand-drop)" />
          </svg>
          <b>Kiumi</b>
        </span>
        <span className="capsule-rule" />
        <Workspace session={session} onChange={onWorkspaceChange} />
      </div>

      <div className="capsule capsule-document">
        <span className="crumb-title" title={title}>{title || '未命名图文'}</span>
        <button type="button" className={`save-button is-${saving}`} aria-label="保存" disabled={saving === 'busy'} data-tip="保存 · Ctrl/⌘ S" onClick={() => void runSave()}>
          <Icon name={saving === 'done' ? 'check' : 'cloud'} size={16} />
          <span>保存</span>
        </button>
        <span className="capsule-rule" />
        <IconButton icon="undo" label="撤销" tip="撤销 · Ctrl/⌘ Z" disabled={!canUndo} onClick={undo} />
        <IconButton icon="redo" label="重做" tip="重做 · Ctrl/⌘ ⇧ Z" disabled={!canRedo} onClick={redo} />
      </div>

      <div className="capsule capsule-delivery">
        <button type="button" className="btn btn-plain" onClick={onPreview}><Icon name="eye" size={17} />预览</button>
        <WechatPanel key={workspaceVersion} />
        <button type="button" data-state={copied ? 'done' : undefined} className="btn btn-candy" onClick={() => void runCopy()}>
          <Icon name={copied ? 'check' : 'copy'} size={17} />
          <span aria-live="polite">{copied ? '已复制' : '复制到公众号'}</span>
        </button>
        <PopMenu label="更多文稿操作" trigger={<Icon name="more" size={20} />}>
          <button type="button" onClick={newDoc}><Icon name="filePlus" />新建文稿</button>
          <button type="button" onClick={() => void onExport().catch((error) => report('导出失败', error))}><Icon name="download" />导出 HTML</button>
        </PopMenu>
        {session && !session.unavailable && session.loginEnabled && (session.user ? (
          <PopMenu label={`账号：${userLabel(session.user)}`} trigger={<span className="avatar">{userLabel(session.user).slice(0, 1).toUpperCase()}</span>}>
            <p className="pop-note">{userLabel(session.user)}</p>
            <a href="/auth/logout"><Icon name="logout" />退出登录</a>
          </PopMenu>
        ) : (
          <a className="btn btn-tint" href={`/auth/login?next=${encodeURIComponent(window.location.pathname)}`}>登录</a>
        ))}
      </div>
    </header>
  );
}
