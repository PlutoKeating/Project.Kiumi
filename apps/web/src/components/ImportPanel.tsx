import { Modal } from './Modal.tsx';
import { useEffect, useRef, useState } from 'react';
import * as api from '../api.ts';
import { useStore } from '../store.ts';
import { prepareFile, prepareText, prepareRichHtml, releasePreview, setHeading, uploadPreview, type ImportPreview } from '../lib/word-import/index.ts';

type Mode = 'paste' | 'markdown' | 'html' | 'url';
const button = 'text-sm px-3 py-2 rounded border border-mist-200 disabled:opacity-40';

export function ImportPanel() {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<Mode>('paste');
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [destination, setDestination] = useState<'append' | 'after' | 'new'>('append');
  const [acknowledged, setAcknowledged] = useState(false);
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

  return <>
    <button className="text-xs px-3 py-1.5 rounded border border-mist-200" onClick={() => setOpen(true)}>导入内容</button>
    {open && <Modal onClose={close}>
      <section role="dialog" aria-modal="true" aria-label="导入内容" className="bg-white rounded-xl w-[900px] max-h-[90vh] overflow-y-auto p-6 whitespace-normal text-ink-900" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between mb-4"><h2 className="text-lg font-semibold">{preview ? '确认导入预览' : '导入到文稿 / 图库'}</h2><button disabled={busy} onClick={close}>关闭</button></div>
        {!preview ? <>
          <p className="text-sm text-ink-600 mb-3">Word/WPS 请直接选择 .docx。图片 ZIP 批量进入图库。带图导入需先登录并选择团队；图片总量 ≤ 80 MB，单张 ≤ 10 MB。</p>
          <label className={button + ' inline-block mb-4'}>选择文件<input aria-label="选择导入文件" type="file" accept=".docx,.zip,.md,.markdown,.html,.htm,.txt" disabled={busy} className="block mt-2" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void prepare(() => prepareFile(file)); }} /></label>
          <div className="flex gap-2 mb-4">{([['paste','粘贴 Word / WPS / 飞书'],['markdown','Markdown'],['html','HTML'],['url','网页地址']] as const).map(([key,label]) => <button disabled={busy} className={`${button} ${mode === key ? 'bg-accent-500 text-white' : 'bg-mist-100'}`} onClick={() => { setMode(key); setValue(''); setMessage(''); }} key={key}>{label}</button>)}</div>
          {mode === 'paste' ? <div role="textbox" aria-label="粘贴内容" className="border border-mist-200 rounded p-4 h-48 overflow-y-auto text-sm" contentEditable={!busy} suppressContentEditableWarning onPaste={e => {
            e.preventDefault(); if (busy) return;
            const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
            const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
            void prepare(() => prepareText(html || text, html ? 'html' : 'text', files));
          }}>在这里粘贴，先预览再导入。若粘贴图片缺失，请改用 DOCX 文件。</div> : <textarea disabled={busy} aria-label="导入文本" className="border border-mist-200 rounded p-3 w-full h-48 text-sm" placeholder={mode === 'url' ? 'https://…' : '粘贴内容'} value={value} onChange={e => setValue(e.target.value)} />}
          {mode !== 'paste' && <button className={button + ' mt-3'} disabled={busy || !value.trim()} onClick={() => void prepareValue()}>生成预览</button>}
        </> : <>
          <p className="text-sm mb-3">{preview.galleryOnly ? `${preview.assets.length} 张图片将进入团队图库，不自动插入正文。` : `${preview.items.length} 个内容块 · ${preview.assets.length} 张待上传图片。按公众号样式统一排版，不保留 Word 分页。`}</p>
          <div className="max-h-[42vh] overflow-y-auto rounded border border-mist-200 p-4">
            {preview.galleryOnly ? <div className="grid grid-cols-4 gap-3">{preview.assets.map(asset => <figure key={asset.url}><img className="max-h-32 max-w-full" src={asset.url} alt={asset.file.name} /><figcaption className="text-xs break-all">{asset.file.name}</figcaption></figure>)}</div> : preview.items.map((item, i) => <div key={item.block.id} className="border-b border-mist-200 py-3" data-import-block>
              <div className="flex gap-3 items-center text-xs text-ink-600 mb-2"><span>块 {i + 1} · {item.label}{item.candidate ? ' · 疑似标题' : ''}</span>
                {['段落', '1 级标题', '2 级标题', '3 级标题', '4 级标题', '5 级标题', '6 级标题'].includes(item.label) && <select disabled={busy} aria-label={`块 ${i + 1} 标题层级`} value={item.label === '段落' ? 0 : Number(item.label[0])} onChange={e => {
                  const next = { ...preview, items: preview.items.map((entry, j) => j === i ? setHeading(entry, Number(e.target.value)) : entry) }; current.current = next; setPreview(next); setAcknowledged(false);
                }}><option value={0}>正文</option>{[1,2,3,4,5,6].map(level => <option value={level} key={level}>{level} 级标题</option>)}</select>}
              </div><div className="max-w-[420px] mx-auto break-words" dangerouslySetInnerHTML={{ __html: item.block.html || '' }} />
            </div>)}
          </div>
          {preview.issues.length > 0 && <div className="bg-amber-50 rounded p-3 mt-3 text-sm"><p className="font-medium">有 {preview.issues.length} 项需要核对</p><ul className="max-h-32 overflow-y-auto list-disc pl-5">{preview.issues.map((entry, i) => <li key={i}>{entry.location}：{entry.message}</li>)}</ul><label className="block mt-2"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> 我已核对以上问题，接受提示的转换结果和待补充标记</label></div>}
          {!preview.galleryOnly && <label className="block text-sm mt-3">导入位置 <select disabled={busy} className={button} value={destination} onChange={e => setDestination(e.target.value as typeof destination)}><option value="append">追加到当前文稿末尾</option><option value="after" disabled={selected === null}>插入选中块之后</option><option value="new">创建新文稿</option></select></label>}
          <div className="flex gap-3 mt-4"><button disabled={busy} className={button} onClick={reset}>重新选择</button><button className={button + ' bg-accent-500 text-white'} disabled={busy || (!preview.galleryOnly && !preview.items.length) || (preview.issues.length > 0 && !acknowledged)} onClick={() => void confirm()}>{preview.galleryOnly ? '确认导入图库' : '确认导入画布'}</button>{busy && cancellation.current && <button className={button} onClick={() => cancellation.current?.abort()}>取消导入</button>}</div>
        </>}
        {message && <p role="status" className="text-sm mt-3 whitespace-pre-wrap">{message}</p>}
      </section>
    </Modal>}
  </>;
}
