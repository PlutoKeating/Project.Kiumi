import { Modal } from './Modal.tsx';
import { useEffect, useRef, useState } from 'react';
import * as api from '../api.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';
import { Segmented, Select, SheetHeader } from './ui.tsx';
import { preloadUploads, prepareClipboard, prepareFile, prepareText, prepareRichHtml, releasePreview, setHeading, uploadPreview, type ImportPreview } from '../lib/word-import/index.ts';
import { applyMatching, chooseOriginal } from '../lib/word-import/bundle.ts';
import { annotate, importSession, recognize, typesetPreview, type StyledResult } from '../lib/typeset-import.ts';
import { AGENT_MAX_MS, AGENT_MAX_STEPS, runLayoutAgent, type AgentResult, type AgentStep } from '../lib/layout-agent.ts';

type Mode = 'paste' | 'markdown' | 'html' | 'url';
const SOURCES = [{ value: 'paste', label: '粘贴 Word / WPS / 秀米' }, { value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' }, { value: 'url', label: '网页地址' }] as const;

export function ImportPanel() {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<Mode>('paste');
  const [value, setValue] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [destination, setDestination] = useState<'append' | 'after' | 'new'>('append');
  const [acknowledged, setAcknowledged] = useState(false), [dragging, setDragging] = useState(false);
  const current = useRef<ImportPreview | null>(null), scope = useRef('');
  // `base` owns the decoded images; `preview` is what the user sees (possibly poured into a style).
  const base = useRef<ImportPreview | null>(null);
  const [useStyle, setUseStyle] = useState(true), [styled, setStyled] = useState<StyledResult | null>(null), [outline, setOutline] = useState<string[]>([]);
  const styleTemplate = useStore(s => s.styleTemplate), rules = useStore(s => s.typesetRules), setStyleTemplate = useStore(s => s.setStyleTemplate);
  const importRequest = useStore(s => s.importRequest);
  useEffect(() => { if (importRequest) setOpen(true); }, [importRequest]);
  useEffect(() => { if (open) void useStore.getState().loadRules(); }, [open]);
  const cancellation = useRef<AbortController | null>(null);
  /** Background uploads started with the preview, so pictures are on the server by the time the AI is done. */
  const preload = useRef<AbortController | null>(null);
  /** The layout review loop: runs after the style is poured, while the user watches (and may stop or confirm). */
  const review = useRef<AbortController | null>(null);
  const [agent, setAgent] = useState<{ running: boolean; steps: AgentStep[]; status: string } | null>(null);
  const stopReview = () => { review.current?.abort(); review.current = null; };
  const selected = useStore(s => s.selected);
  const reset = () => { stopReview(); setAgent(null); preload.current?.abort(); preload.current = null; if (base.current) releasePreview(base.current); base.current = null; current.current = null; setPreview(null); setStyled(null); setOutline([]); setAcknowledged(false); setMessage(''); };
  useEffect(() => () => { cancellation.current?.abort(); preload.current?.abort(); review.current?.abort(); if (base.current) releasePreview(base.current); }, []);
  const close = () => { if (busy) return; reset(); setOpen(false); };

  const prepare = async (operation: () => Promise<ImportPreview>) => {
    if (busy) return;
    reset(); scope.current = api.workspaceKey(); setBusy(true); setMessage('正在解析，请稍候…');
    try {
      const result = await operation();
      if (scope.current !== api.workspaceKey()) { releasePreview(result); throw new Error('账号或团队已切换，请重新导入。'); }
      base.current = result; current.current = result; setPreview(result); setMessage('');
      if (api.teamId() && result.assets.length) { preload.current = new AbortController(); void preloadUploads(result, scope.current, preload.current.signal); }
      if (!result.items.length && !result.galleryOnly) setMessage('没有可导入的内容。');
      else if (!result.galleryOnly) await arrange(result, useStyle);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  /** Recognize structure and, when a style is chosen, pour the manuscript into it. */
  const arrange = async (source: ImportPreview, withStyle: boolean) => {
    stopReview(); setAgent(null);
    if (source.preserveLayout) { current.current = source; setPreview({ ...source }); setStyled(null); setOutline([]); return; }
    try {
      const first = recognize(source);
      setOutline(first.outline);
      if (withStyle && styleTemplate) {
        setMessage('AI 正在识别文章结构…');
        // The model reviews every paragraph's role, then plans the layout; rules stand in when it is unavailable.
        const session = importSession();
        const patches = await Promise.race([annotate(first.facts, first.classified, session), new Promise<undefined>(resolve => setTimeout(resolve, 30_000))]);
        setOutline(recognize(source, patches).outline);
        setMessage('AI 正在按风格编排版面…');
        const result = await typesetPreview(source, styleTemplate.id, rules, patches, { session });
        current.current = result.preview; setStyled(result); setPreview({ ...result.preview });
        setMessage(result.planStatus === 'model' ? '' : result.planStatus === 'rejected' ? '模型的排版方案未通过规范复核，已按规则排版。' : '未连接到排版模型，已按规则排版。');
        void polish(result, session);
      } else { current.current = source; setStyled(null); setPreview({ ...source }); setMessage(''); }
    } catch (error) { current.current = source; setStyled(null); setPreview({ ...source }); setMessage(`风格排版失败，已保留原文结构：${(error as Error).message}`); }
  };
  /** Let the model look at the rendered article and fix it step by step until it is satisfied. */
  const polish = async (result: StyledResult, session: string) => {
    const controller = new AbortController();
    review.current = controller;
    const steps: AgentStep[] = [];
    setAgent({ running: true, steps: [], status: 'AI 正在查看排好的版面…' });
    const show = (html: string) => {
      if (controller.signal.aborted) return;
      const next = { ...result.preview, items: result.preview.items.map((item, i) => (i === 0 ? { ...item, block: { ...item.block, html } } : item)) };
      result.preview = next; current.current = next; setPreview(next);
    };
    let outcome: AgentResult;
    try {
      outcome = await runLayoutAgent({
        template: result.template, manuscript: result.manuscript, rules, plan: result.plan, resolveImage: result.resolveImage,
        structure: result.structure, session, signal: controller.signal,
        onStep: (step, html) => { steps.push(step); show(html); setAgent({ running: true, steps: [...steps], status: `AI 精修中 · 第 ${step.n} 步：${step.action}` }); },
      });
    } catch (error) {
      if (!controller.signal.aborted) setAgent({ running: false, steps, status: `版面精修中断：${(error as Error).message}` });
      return;
    }
    if (review.current === controller) review.current = null;
    if (outcome.stop === 'cancelled') { setAgent(a => (a ? { ...a, running: false, status: `已停止精修，使用第 ${steps.length} 步的结果。` } : a)); return; }
    if (outcome.stop === 'unavailable') { setAgent({ running: false, steps: [], status: 'AI 版面精修未启用：没有可调用的模型。站点管理员可在账号菜单「模型配置」里为「版面精修」选择一个能读图片的模型。' }); return; }
    show(outcome.html);
    const status = {
      satisfied: `AI 精修完成（${steps.length} 步）：${outcome.summary}`,
      'accepted-with-issues': `AI 精修结束（${steps.length} 步），有问题留给人工核对。`,
      budget: `已达到精修上限（${AGENT_MAX_STEPS} 步 / ${AGENT_MAX_MS / 60_000} 分钟），使用当前结果。`,
      failed: `模型中途不可用，使用第 ${steps.length} 步的结果。`,
    }[outcome.stop];
    setAgent({ running: false, steps, status });
    // What the model could not fix goes to the human checklist.
    if (outcome.unresolved || outcome.findings.some(f => f.level === 'error')) {
      const issues = [...result.preview.issues, ...(outcome.unresolved ? [{ location: 'AI 精修', message: outcome.unresolved }] : []), ...outcome.findings.filter(f => f.level === 'error' && !outcome.unresolved).map(f => ({ location: 'AI 精修', message: f.message }))];
      const next = { ...result.preview, issues };
      result.preview = next; current.current = next; setPreview(next); setAcknowledged(false);
    }
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
    // Confirming takes the layout as it stands; a running review stops here.
    stopReview();
    const original = useStore.getState().doc;
    cancellation.current = new AbortController(); setBusy(true); setMessage('正在导入…');
    try {
      const blocks = await uploadPreview(preview, scope.current, setMessage, cancellation.current.signal);
      // The first body picture is the share cover, the same choice an editor makes by hand.
      const cover = styled ? blocks.flatMap(b => (b.kind === 'library' && b.html ? [...new DOMParser().parseFromString(b.html, 'text/html').querySelectorAll('img')].map(i => i.getAttribute('src') || '') : [])).find(src => src && !src.startsWith('/assets/') && !src.startsWith('blob:')) : undefined;
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
          state.commit({ version: 1, id: `local-${crypto.randomUUID()}`, title: preview.title, blocks, meta: { createdAt: now, updatedAt: now, ...(cover ? { cover } : {}) } });
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

  const show = (html: string) => Object.entries(preview?.replacements ?? {}).reduce((out, [from, to]) => out.split(from).join(to), html);
  const rematch = async (row: number, id: string) => {
    if (!base.current || busy) return;
    chooseOriginal(base.current, row, id || undefined);
    setBusy(true); try { await arrange(base.current, useStyle); } finally { setBusy(false); }
  };
  const failed = /失败|无法|错误|不支持|已切换|已变化|请先|取消/.test(message);
  return <>
    <button type="button" data-tone="lilac" aria-label="导入内容" onClick={() => setOpen(true)}><Icon name="fileIn" size={19} /><span>导入</span></button>
    {open && <Modal onClose={close}>
      <section role="dialog" aria-modal="true" aria-label="导入内容" className="sheet sheet-lg import-dialog" onClick={e => e.stopPropagation()}>
        <SheetHeader title={preview ? '确认导入预览' : '导入到文稿 / 图库'} detail={preview ? undefined : '先预览，确认后再写入画布。'} disabled={busy} onClose={close} />
        <div className="sheet-body">
        {!preview ? <>
          <label className="dropzone" data-dragging={dragging} data-busy={busy} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) void prepare(() => prepareFile(file, setMessage)); }}>
            <span className="dropzone-icon"><Icon name="fileIn" size={24} /></span>
            <strong>{busy ? '正在处理…' : '拖入文件，或点击选择'}</strong>
            <small>支持 .docx、图片 ZIP、Markdown、HTML、TXT。带图导入需先登录并选择团队，图片总量 ≤ 80 MB，单张 ≤ 10 MB。</small>
            <input aria-label="选择导入文件" type="file" accept=".docx,.zip,.md,.markdown,.html,.htm,.txt" disabled={busy} className="sr-only" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void prepare(() => prepareFile(file, setMessage)); }} />
          </label>
          <Segmented label="导入方式" value={mode} disabled={busy} options={SOURCES} onChange={next => { setMode(next); setValue(''); setMessage(''); }} />
          {mode === 'paste' ? <div role="textbox" aria-label="粘贴内容" className="field paste-box" contentEditable={!busy} suppressContentEditableWarning data-placeholder="在这里粘贴，先预览再导入。秀米等排版编辑器复制的内容会保留原排版；Word 若粘贴图片缺失，请改用 DOCX 文件。" onPaste={e => {
            e.preventDefault(); if (busy) return;
            const html = e.clipboardData.getData('text/html'), text = e.clipboardData.getData('text/plain');
            const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
            void prepare(() => prepareClipboard(html, text, files));
          }} /> : <textarea disabled={busy} aria-label="导入文本" className="field paste-box" placeholder={mode === 'url' ? 'https://…' : '粘贴内容'} value={value} onChange={e => setValue(e.target.value)} />}
          {mode !== 'paste' && <footer className="sheet-actions"><button type="button" className="btn btn-candy" disabled={busy || !value.trim()} onClick={() => void prepareValue()}>生成预览</button></footer>}
        </> : <>
          <p className="sheet-lead">{preview.galleryOnly ? `${preview.assets.length} 张图片将进入团队图库，不自动插入正文。` : `${preview.items.length} 个内容块 · ${preview.assets.length} 张待上传图片。${preview.preserveLayout ? '保留原排版与 SVG，图片上传到团队图库。' : '按公众号样式统一排版，不保留 Word 分页。'}`}</p>
          {!preview.galleryOnly && <div className="import-style" role="group" aria-label="排版风格">
            <div className="import-style-row">
              {styleTemplate ? <label className="tool-check"><input type="checkbox" disabled={busy} checked={useStyle} onChange={async e => { setUseStyle(e.target.checked); if (base.current) { setBusy(true); try { await arrange(base.current, e.target.checked); } finally { setBusy(false); } } }} />按风格「{styleTemplate.name}」自动排版</label> : <span className="import-style-hint">在左侧模板点「排入稿件」选一个风格，可自动排版。</span>}
              {styleTemplate && <button type="button" className="btn btn-plain" disabled={busy} onClick={() => { setStyleTemplate(null); setUseStyle(false); if (base.current) void arrange(base.current, false); }}>清除风格</button>}
            </div>
            {outline.length > 0 && <details className="import-outline"><summary>识别到的文章结构</summary><pre>{outline.join('\n')}</pre></details>}
          </div>}
          {agent && <div className="import-agent" role="group" aria-label="AI 版面精修" aria-busy={agent.running}>
            <div className="import-agent-head">
              <span role="status">{agent.status}</span>
              {agent.running && <button type="button" className="btn btn-plain" onClick={stopReview}>停止，用当前结果</button>}
            </div>
            {agent.steps.length > 0 && <ol className="import-agent-steps">{agent.steps.map(step => <li key={step.n} data-outcome={step.outcome}>
              <details><summary><b>{step.n}</b> {step.action}{step.outcome === 'rejected' ? ' · 被驳回' : ''}</summary>
                {step.thought && <p>{step.thought}</p>}{step.note && <p className="import-agent-note">{step.note.length > 400 ? `${step.note.slice(0, 400)}…` : step.note}</p>}
              </details>
            </li>)}</ol>}
          </div>}
          {preview.matching && <div className="import-matches" role="group" aria-label="原图匹配">
            <h3>原图匹配 · {preview.matching.rows.filter(r => r.originalId).length}/{preview.matching.rows.length} 张已找到原图</h3>
            <div className="match-grid">{preview.matching.rows.map((row, i) => {
              const picked = preview.matching!.originals.find(o => o.id === row.originalId);
              return <figure key={row.embedded.url} data-level={row.level}>
                <div className="match-pair"><img src={row.embedded.url} alt={`Word 内第 ${i + 1} 张图`} /><span aria-hidden="true">→</span>{picked ? <img src={picked.asset.url} alt={picked.name} /> : <em>未找到</em>}</div>
                <Select disabled={busy} label={`第 ${i + 1} 张图的原图`} value={row.originalId ?? ''} options={[{ value: '', label: '不替换（用 Word 内图）' }, ...preview.matching!.originals.map(o => ({ value: o.id, label: o.name }))]} onChange={id => void rematch(i, id)} />
                <figcaption>{row.level === 'high' ? '匹配可靠' : row.level === 'low' ? '请核对' : '未匹配'} · {Math.round(row.confidence * 100)}%</figcaption>
              </figure>;
            })}</div>
          </div>}
          <div className="import-preview">
            {preview.galleryOnly ? <div className="import-gallery">{preview.assets.map(asset => <figure key={asset.url}><img src={asset.url} alt={asset.file.name} /><figcaption>{asset.file.name}</figcaption></figure>)}</div> : preview.items.map((item, i) => <div key={item.block.id} className="import-item" data-import-block>
              <div className="import-item-head"><span>块 {i + 1} · {item.label}{item.candidate ? ' · 疑似标题' : ''}</span>
                {['段落', '1 级标题', '2 级标题', '3 级标题', '4 级标题', '5 级标题', '6 级标题'].includes(item.label) && <Select disabled={busy} label={`块 ${i + 1} 标题层级`} value={item.label === '段落' ? 0 : Number(item.label[0])} options={[{ value: 0, label: '正文' }, ...[1, 2, 3, 4, 5, 6].map(level => ({ value: level, label: `${level} 级标题` }))]} onChange={level => {
                  const next = { ...preview, items: preview.items.map((entry, j) => j === i ? setHeading(entry, level) : entry) }; current.current = next; setPreview(next); setAcknowledged(false);
                }} />}
              </div><div className="import-item-body" dangerouslySetInnerHTML={{ __html: show(item.block.html || '') }} />
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
