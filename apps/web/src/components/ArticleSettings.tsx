import { useState } from 'react';
import { uploadImage, type Document } from '../api.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';

export function ArticleSettings() {
  const doc = useStore(s => s.doc);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const update = (patch: Partial<Document['meta']>) => {
    const state = useStore.getState(); state.commit({ ...state.doc, meta: { ...state.doc.meta, ...patch } });
  };
  return <section className="article-settings" aria-label="图文设置">
    <div className="settings-heading"><h2>图文设置</h2><span>让每一次分享都恰到好处</span></div>
    <div className="settings-main">
      <label className="cover-picker" title="上传分享封面">
        {doc.meta.cover ? <img src={doc.meta.cover} alt="分享封面" /> : <Icon name="image" size={28} />}
        <span>{busy ? '上传中…' : doc.meta.cover ? '更换封面' : '添加封面'}</span>
        <input type="file" aria-label="上传分享封面" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
          setBusy(true); setNotice('');
          try { update({ cover: (await uploadImage(file)).url }); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
        }} />
      </label>
      <div className="settings-fields"><label>文章标题<input aria-label="文章标题" value={doc.title} placeholder="写一个让人想读的标题" onChange={e => useStore.getState().setTitle(e.target.value)} /></label>
      <label>分享摘要<textarea aria-label="分享摘要" value={doc.meta.digest ?? ''} placeholder="用一句话介绍这篇文章…" rows={2} onChange={e => useStore.getState().setDigest(e.target.value)} /></label></div>
    </div>
    <details className="settings-details"><summary>更多设置 <Icon name="chevron" size={14} /></summary><div className="settings-extra">
      <label>作者<input value={doc.meta.author ?? ''} maxLength={16} onChange={e => update({ author: e.target.value })} /></label>
      <label>标签<input placeholder="用逗号分隔标签" key={doc.id} defaultValue={doc.meta.tags?.join(', ') ?? ''} onBlur={e => update({ tags: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })} /></label>
      {doc.meta.cover && <button onClick={() => update({ cover: '' })}>移除封面</button>}
    </div></details>
    {notice && <p role="status" className="field-error">{notice}</p>}
  </section>;
}
