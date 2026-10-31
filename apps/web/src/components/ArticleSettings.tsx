import { useState } from 'react';
import { uploadImage, type Document } from '../api.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';

const THEME_SWATCHES = [
  { color: '#6f9bd8', name: '晴空蓝' },
  { color: '#e58fb3', name: '樱花粉' },
  { color: '#9d8fd9', name: '丁香紫' },
  { color: '#67b8a2', name: '薄荷绿' },
  { color: '#e8a27c', name: '杏子橙' },
  { color: '#4a5470', name: '墨蓝' },
];

/** Everything that describes the article as a whole, kept off the page it describes. */
export function ArticleSettings() {
  const doc = useStore(s => s.doc);
  const issues = useStore(s => s.issues);
  const themeColor = useStore(s => s.themeColor);
  const applyTheme = useStore(s => s.applyTheme);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const update = (patch: Partial<Document['meta']>) => {
    const state = useStore.getState(); state.commit({ ...state.doc, meta: { ...state.doc.meta, ...patch } });
  };
  const digest = doc.meta.digest ?? '';
  const todos = [
    ...(!doc.title.trim() || doc.title === '未命名图文' ? ['写一个标题'] : []),
    ...(doc.blocks.length === 0 ? ['添加正文内容'] : []),
    ...(!doc.meta.cover ? ['添加分享封面'] : []),
    ...(!digest.trim() ? ['写一句分享摘要'] : []),
  ];
  const blocking = issues.filter(issue => issue.level !== 'info');
  const ready = todos.length === 0 && blocking.length === 0;
  return <section className="article-settings" aria-label="图文设置">
    <div className="cover-picker" data-filled={Boolean(doc.meta.cover)}>
      {doc.meta.cover && <img src={doc.meta.cover} alt="分享封面" />}
      <label>
        {!doc.meta.cover && <Icon name="image" size={22} />}
        <span>{busy ? '上传中…' : doc.meta.cover ? '更换封面' : '添加分享封面'}</span>
        <input type="file" aria-label="上传分享封面" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          setBusy(true); setNotice('');
          try { update({ cover: (await uploadImage(file)).url }); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
        }} />
      </label>
      {doc.meta.cover && <button type="button" className="cover-remove" aria-label="移除封面" onClick={() => update({ cover: '' })}><Icon name="close" size={14} /></button>}
    </div>
    {notice && <p role="status" className="field-error">{notice}</p>}

    <label className="field-label">分享摘要
      <textarea className="field" aria-label="分享摘要" value={digest} placeholder="用一句话介绍这篇文章" rows={3} maxLength={120} onChange={e => useStore.getState().setDigest(e.target.value)} />
      <small>{digest.length} / 120</small>
    </label>
    <div className="field-pair">
      <label className="field-label">作者<input className="field" aria-label="作者" value={doc.meta.author ?? ''} maxLength={16} onChange={e => update({ author: e.target.value })} /></label>
      <label className="field-label">标签<input className="field" aria-label="标签" placeholder="用逗号分隔" key={doc.id} defaultValue={doc.meta.tags?.join(', ') ?? ''} onBlur={e => update({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })} /></label>
    </div>

    <fieldset className="theme-picker">
      <legend>主题色<small>能换色的模板会一起变色</small></legend>
      <div>{THEME_SWATCHES.map(({ color, name }) => <button key={color} type="button" className="swatch" aria-label={`主题色 ${name}`} aria-pressed={themeColor.toLowerCase() === color} data-tip={name} style={{ background: color }} onClick={() => applyTheme(color)} />)}</div>
    </fieldset>

    <section className="preflight" aria-label="发布前检查" data-state={ready ? 'clean' : 'issues'}>
      <h3><Icon name={ready ? 'check' : 'alert'} size={15} />{ready ? '可以发布了' : `发布前还有 ${todos.length + blocking.length} 项`}</h3>
      {todos.map(todo => <p key={todo} data-level="todo">{todo}</p>)}
      {issues.slice(0, 12).map((issue, index) => <p key={`${issue.rule}-${index}`} data-level={issue.level}>{issue.message}</p>)}
    </section>
  </section>;
}
