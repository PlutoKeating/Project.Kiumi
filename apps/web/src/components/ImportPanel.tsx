import { Modal } from './Modal.tsx';
import { useEffect, useRef, useState } from 'react';
import * as api from '../api.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';
import { Segmented, Select, SheetHeader } from './ui.tsx';
import { prepareFile, prepareText, prepareRichHtml, releasePreview, setHeading, uploadPreview, type ImportPreview } from '../lib/word-import/index.ts';

type Mode = 'paste' | 'markdown' | 'html' | 'url';
const SOURCES = [{ value: 'paste', label: '粘贴 Word / WPS / 飞书' }, { value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' }, { value: 'url', label: '网页地址' }] as const;

export function ImportPanel() {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<Mode>('paste');
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [destination, setDestination] = useState<'append' | 'after' | 'new'>('append');
  const [acknowledged, setAcknowledged] = useState(false), [dragging, setDragging] = useState(false);
  const current = useRef<ImportPreview | null>(null), scope = useRef('');
  const cancellation = useRef<AbortController | null>(null);
  const selected = useStore(s => s.selected);
  const reset = () => { if (current.current) releasePreview(current.current); current.current = null; setPreview(null); setAcknowledged(false); setMessage(''); };
  useEffect(() => () => { cancellation.current?.abort(); if (current.current) releasePreview(current.current); }, []);
  const close = () => { if (busy) return; reset(); setOpen(false); };

  const prepare = async (operation: () => Promise<ImportPreview>) => {
    if (busy) return;
    reset(); scope.current = api.workspaceKey(); setBusy(true); setMessage('正在解析，请稍候…');
    try {
      const result = await operation();
      if (scope.current !== api.workspaceKey()) { releasePreview(result); throw new Error('账号或团队已切换，请重新导入。'); }
      current.current = result; setPreview(result); setMessage('');
      if (!result.items.length && !result.galleryOnly) setMessage('没有可导入的内容。');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const prepareValue = () => prepare(async () => {
    if (mode === 'url') {
      const result = await api.request<{ html: string; url: string }>('/api/import/url', { method: 'POST', body: JSON.stringify({ url: value }) });
      return prepareRichHtml(result.html, result.url);
    }
    return mode === 'markdown' ? prepareText(value, 'markdown') : prepareRichHtml(value);
  });
  const confirm = async () => {
    if (!preview || busy) return;
    const original = useStore.getState().doc;
    cancellation.current = new AbortController(); setBusy(true); setMessage('正在导入…');
    try {
      const blocks = await uploadPreview(preview, scope.current, setMessage, cancellation.current.signal);
      if (api.workspaceKey() !== scope.current || useStore.getState().doc !== original) throw new Error('当前文稿或团队已变化，请重新预览后导入。');
      if (preview.galleryOnly) {
        useStore.setState({ message: `已将 ${preview.assets.length} 张图片导入团队图库，可从「我的图库」插入。` });
      } else {
        const state = useStore.getState();
        if (destination === 'new') {
          // Preserve the current team document before moving to a new one.
          if (original.blocks.length && api.teamId() && !await state.save()) throw new Error('当前文稿保存失败，未切换到新文稿，请重试。');
          if (api.workspaceKey() !== scope.current || cancellation.current.signal.aborted) throw new Error('导入已取消或团队已切换。');
          if (useStore.getState().doc.blocks !== original.blocks || useStore.getState().doc.title !== original.title) throw new Error('保存期间文稿已变化，请重新确认导入。');
          const now = new Date().toISOString();
          state.commit({ version: 1, id: `local-${crypto.randomUUID()}`, title: preview.title, blocks, meta: { createdAt: now, updatedAt: now } });
        } else {
          if (destination === 'after' && state.selected === null) throw new Error('请先选择一个画布块，或改为追加到末尾。');
          const at = destination === 'after' ? state.selected! + 1 : original.blocks.length;
          state.commit({ ...original, blocks: [...original.blocks.slice(0, at), ...blocks, ...original.blocks.slice(at)] });
        }
        useStore.setState({ selected: null, selectedIds: [], message: `已导入 ${blocks.length} 块，可一次撤销。` });
        void state.refresh();
      }
      reset(); setOpen(false); setValue('');
    } catch (error) { setMessage(`${(error as Error).message}${preview.assets.some(a => a.uploadedUrl) ? ' 已成功上传的图片保留在团队图库，重试不会重复上传这些图片。' : ''}`); }
    finally { cancellation.current = null; setBusy(false); }
  };

  const failed = /失败|无法|错误|不支持|已切换|已变化|请先|取消/.test(message);
  return <>
    <button type="button" data-tone="lilac" aria-label="导入内容" onClick={() => setOpen(true)}><Icon name="fileIn" size={19} /><span>导入</span></button>
    {open && <Modal onClose={close}>
      <section role="dialog" aria-modal="true" aria-label="导入内容" className="sheet sheet-lg import-dialog" onClick={e => e.stopPropagation()}>
        <SheetHeader title={preview ? '确认导入预览' : '导入到文稿 / 图库'} detail={preview ? undefined : '先预览，确认后再写入画布。'} disabled={busy} onClose={close} />
        <div className="sheet-body">
        {!preview ? <>
          <label className="dropzone" data-dragging={dragging} data-busy={busy} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) void prepare(() => prepareFile(file)); }}>
            <span className="dropzone-icon"><Icon name="fileIn" size={24} /></span>
            <strong>{busy ? '正在处理…' : '拖入文件，或点击选择'}</strong>
            <small>支持 .docx、图片 ZIP、Markdown、HTML、TXT。带图导入需先登录并选择团队，图片总量 ≤ 80 MB，单张 ≤ 10 MB。</small>
            <input aria-label="选择导入文件" type="file" accept=".docx,.zip,.md,.markdown,.html,.htm,.txt" disabled={busy} className="sr-only" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void prepare(() => prepareFile(file)); }} />
          </label>
          <Segmented label="导入方式" value={mode} disabled={busy} options={SOURCES} onChange={next => { setMode(next); setValue(''); setMessage(''); }} />
          {mode === 'paste' ? <div role="textbox" aria-label="粘贴内容" className="field paste-box" contentEditable={!busy} suppressContentEditableWarning data-placeholder="在这里粘贴，先预览再导入。若粘贴图片缺失，请改用 DOCX 文件。" onPaste={e => {
            e.preventDefault(); if (busy) return;
            const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
            const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
            void prepare(() => prepareText(html || text, html ? 'html' : 'text', files));
          }} /> : <textarea disabled={busy} aria-label="导入文本" className="field paste-box" placeholder={mode === 'url' ? 'https://…' : '粘贴内容'} value={value} onChange={e => setValue(e.target.value)} />}
          {mode !== 'paste' && <footer className="sheet-actions"><button type="button" className="btn btn-candy" disabled={busy || !value.trim()} onClick={() => void prepareValue()}>生成预览</button></footer>}
        </> : <>
          <p className="sheet-lead">{preview.galleryOnly ? `${preview.assets.length} 张图片将进入团队图库，不自动插入正文。` : `${preview.items.length} 个内容块 · ${preview.assets.length} 张待上传图片。按公众号样式统一排版，不保留 Word 分页。`}</p>
          <div className="import-preview">
            {preview.galleryOnly ? <div className="import-gallery">{preview.assets.map(asset => <figure key={asset.url}><img src={asset.url} alt={asset.file.name} /><figcaption>{asset.file.name}</figcaption></figure>)}</div> : preview.items.map((item, i) => <div key={item.block.id} className="import-item" data-import-block>
              <div className="import-item-head"><span>块 {i + 1} · {item.label}{item.candidate ? ' · 疑似标题' : ''}</span>
                {['段落', '1 级标题', '2 级标题', '3 级标题', '4 级标题', '5 级标题', '6 级标题'].includes(item.label) && <Select disabled={busy} label={`块 ${i + 1} 标题层级`} value={item.label === '段落' ? 0 : Number(item.label[0])} options={[{ value: 0, label: '正文' }, ...[1, 2, 3, 4, 5, 6].map(level => ({ value: level, label: `${level} 级标题` }))]} onChange={level => {
                  const next = { ...preview, items: preview.items.map((entry, j) => j === i ? setHeading(entry, level) : entry) }; current.current = next; setPreview(next); setAcknowledged(false);
                }} />}
              </div><div className="import-item-body" dangerouslySetInnerHTML={{ __html: item.block.html || '' }} />
            </div>)}
          </div>
          {preview.issues.length > 0 && <div className="import-issues"><h3><Icon name="alert" size={15} />有 {preview.issues.length} 项需要核对</h3><ul>{preview.issues.map((entry, i) => <li key={i}>{entry.location}：{entry.message}</li>)}</ul><label className="tool-check"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />我已核对以上问题，接受提示的转换结果和待补充标记</label></div>}
          <footer className="sheet-actions is-split">
            {!preview.galleryOnly ? <div className="inline-select">导入位置<Select label="导入位置" disabled={busy} value={destination} onChange={setDestination} options={[{ value: 'append', label: '追加到当前文稿末尾' }, { value: 'after', label: '插入选中块之后', disabled: selected === null }, { value: 'new', label: '创建新文稿' }]} /></div> : <span />}
            <div>
              {busy && cancellation.current && <button type="button" className="btn btn-plain" onClick={() => cancellation.current?.abort()}>取消导入</button>}
              <button type="button" className="btn btn-plain" disabled={busy} onClick={reset}>重新选择</button>
              <button type="button" className="btn btn-candy" disabled={busy || (!preview.galleryOnly && !preview.items.length) || (preview.issues.length > 0 && !acknowledged)} onClick={() => void confirm()}>{preview.galleryOnly ? '确认导入图库' : '确认导入画布'}</button>
            </div>
          </footer>
        </>}
        {message && <p role="status" className="sheet-notice" data-tone={failed ? 'error' : undefined}>{message}</p>}
        </div>
      </section>
    </Modal>}
  </>;
}
