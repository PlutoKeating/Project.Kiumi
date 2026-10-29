import { useState } from 'react';
import { importHtml, importMarkdown } from '../lib/import.ts';
import { request } from '../api.ts';
import { useStore } from '../store.ts';

export function ImportPanel() {
  const [open,setOpen]=useState(false),[mode,setMode]=useState<'paste'|'markdown'|'html'|'url'>('paste');
  const [value,setValue]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const append=async(source:string,kind=mode)=>{
    setBusy(true);setMessage('');
    try {
      let base:string|undefined;
      if(kind==='url'){const result=await request<{html:string;url:string}>('/api/import/url',{method:'POST',body:JSON.stringify({url:source})});source=result.html;base=result.url;}
      const blocks=kind==='markdown'?await importMarkdown(source):await importHtml(source,base);
      const state=useStore.getState();state.commit({...state.doc,blocks:[...state.doc.blocks,...blocks]});await state.refresh();setOpen(false);setValue('');
    } catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  };
  return <><button className="text-xs px-3 py-1.5 rounded border border-mist-200" onClick={()=>setOpen(true)}>导入内容</button>
    {open&&<div className="fixed inset-0 z-50 bg-ink-900/50 flex items-center justify-center" onClick={()=>!busy&&setOpen(false)}><section className="bg-white rounded-xl w-[760px] p-6" onClick={e=>e.stopPropagation()}>
      <div className="flex justify-between mb-5"><h2 className="text-lg font-semibold">导入到当前文稿</h2><button onClick={()=>setOpen(false)}>关闭</button></div>
      <div className="flex gap-2 mb-4">{([['paste','粘贴 Word / 飞书 / 公众号'],['markdown','Markdown'],['html','HTML'],['url','网页地址']] as const).map(([key,label])=><button className={`text-sm px-3 py-2 rounded ${mode===key?'bg-accent-500 text-white':'bg-mist-100'}`} onClick={()=>{setMode(key);setValue('');setMessage('');}} key={key}>{label}</button>)}</div>
      {mode==='paste'?<div className="border border-mist-200 rounded p-4 h-64 overflow-y-auto text-sm" contentEditable suppressContentEditableWarning onPaste={e=>{e.preventDefault();const html=e.clipboardData.getData('text/html');const text=e.clipboardData.getData('text/plain');if(html)void append(html,'html');else void append(text,'markdown');}}>在这里粘贴已复制的内容，保留文字、图片和排版。</div>:<textarea className="border border-mist-200 rounded p-3 w-full h-64 text-sm" placeholder={mode==='url'?'https://…':'粘贴内容或选择文件'} value={value} onChange={e=>setValue(e.target.value)}/>}
      {message&&<p className="text-sm text-red-600 mt-3">{message}</p>}
      <div className="flex gap-3 mt-4 items-center"><input type="file" accept=".md,.markdown,.html,.htm,.txt" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void file.text().then(text=>append(text,/\.html?$/i.test(file.name)?'html':'markdown'));}}/><button className="ml-auto rounded bg-accent-500 text-white px-4 py-2 text-sm disabled:opacity-40" disabled={busy||!value.trim()} onClick={()=>void append(value)}>{busy?'正在导入…':'追加到文稿'}</button></div>
    </section></div>}
  </>;
}
