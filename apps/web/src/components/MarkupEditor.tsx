import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.ts';
import * as api from '../api.ts';
import { cleanHtml } from '../lib/import.ts';

const field='mt-1 w-full border border-mist-200 rounded px-2 py-1.5 text-xs';
const animationFields=['dur','begin','end','repeatCount','repeatDur','values','from','to','by','keyTimes','keySplines','calcMode','fill','type','path','keyPoints','rotate','additive','accumulate'];

/** Edit the actual recorded DOM so synthesized SVG needs no reverse compiler. */
export function MarkupEditor({index,html}:{index:number;html:string}) {
  const update=useStore(s=>s.updateHtml);
  const [uploads,setUploads]=useState<Awaited<ReturnType<typeof api.listUploads>>>([]);
  const [notice,setNotice]=useState('');
  useEffect(()=>{if(api.teamId())void api.listUploads().then(setUploads).catch(()=>{});},[]);
  const model=useMemo(()=>{
    const root=document.createElement('template');root.innerHTML=cleanHtml(html);
    const texts:Text[]=[];
    const walker=document.createTreeWalker(root.content,NodeFilter.SHOW_TEXT);
    for(let n=walker.nextNode();n;n=walker.nextNode())if(n.textContent?.trim()&&!n.parentElement?.closest('style,script'))texts.push(n as Text);
    const images=[...root.content.querySelectorAll('img,image')];
    const links=[...root.content.querySelectorAll('a[href]')];
    const animations=[...root.content.querySelectorAll('animate,animateTransform,animateMotion,set')];
    const colors=new Set<string>();
    for(const el of root.content.querySelectorAll('*'))for(const name of ['style','fill','stroke','color']) {
      for(const match of (el.getAttribute(name)||'').matchAll(/#[\da-f]{3,8}\b|rgba?\([^)]*\)/gi))colors.add(match[0]);
    }
    return {root,texts,images,links,animations,colors:[...colors]};
  },[html]);
  const save=()=>update(index,model.root.innerHTML);
  const setAttribute=(element:Element,name:string,value:string)=>{if(value.trim())element.setAttribute(name,value);else element.removeAttribute(name);save();};
  return <div className="space-y-4">{notice&&<p role="status" className="text-xs text-red-600">{notice}</p>}
    <details open><summary className="text-xs font-medium cursor-pointer">文字（{model.texts.length}）</summary><div className="space-y-2 mt-2">{model.texts.map((node,i)=><textarea key={`${index}-text-${i}-${node.textContent}`} className={field} rows={2} defaultValue={node.textContent||''} aria-label={`文字 ${i+1}`} onBlur={e=>{node.nodeValue=e.target.value;save();}}/>)}</div></details>
    {model.images.length>0&&<details open><summary className="text-xs font-medium cursor-pointer">图片（{model.images.length}）</summary>{model.images.map((node,i)=>{
      const attr=node.hasAttribute('src')?'src':node.hasAttribute('xlink:href')?'xlink:href':'href';
      return <label key={`${index}-image-${i}`} className="block text-xs mt-2">图片 {i+1}<input className={field} defaultValue={node.getAttribute(attr)||''} key={node.getAttribute(attr)} onBlur={e=>setAttribute(node,attr,e.target.value)}/>
        <select className={field} value="" onChange={e=>{if(e.target.value)setAttribute(node,attr,e.target.value);}}><option value="">从团队图库选择</option>{uploads.map(item=><option key={item.id} value={item.url}>{item.name}</option>)}</select>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className={field} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setNotice('');try{const item=await api.uploadImage(file);setAttribute(node,attr,item.url);setUploads(await api.listUploads());}catch(error){setNotice((error as Error).message);}}}/></label>;
    })}</details>}
    {model.links.length>0&&<details><summary className="text-xs cursor-pointer">链接（{model.links.length}）</summary>{model.links.map((node,i)=><label key={i} className="block text-xs mt-2">{node.textContent?.slice(0,30)||`链接 ${i+1}`}<input className={field} key={node.getAttribute('href')} defaultValue={node.getAttribute('href')||''} onBlur={e=>setAttribute(node,'href',e.target.value)}/></label>)}</details>}
    {model.colors.length>0&&<details open><summary className="text-xs font-medium cursor-pointer">颜色</summary><div className="grid grid-cols-2 gap-2 mt-2">{model.colors.map(color=><label key={color} className="text-[10px] flex items-center gap-1"><span style={{background:color}} className="w-4 h-4 shrink-0 border border-mist-200 rounded"/><input className={field} defaultValue={color} aria-label={`替换颜色 ${color}`} onBlur={e=>{const next=e.target.value;if(next===color||!CSS.supports('color',next))return;for(const el of model.root.content.querySelectorAll('*'))for(const attr of ['style','fill','stroke','color','values','from','to']){const value=el.getAttribute(attr);if(value?.includes(color))el.setAttribute(attr,value.split(color).join(next));}save();}}/></label>)}</div></details>}
    {model.animations.length>0&&<details open><summary className="text-xs font-medium cursor-pointer">动画（{model.animations.length}）</summary><p className="text-[11px] text-ink-600 my-2">时长使用 s/ms，重复次数可填 indefinite；触发器如 click 或 元素ID.click。</p>{model.animations.map((node,i)=><details key={`${index}-anim-${i}`} className="border border-mist-200 rounded p-2 mb-2"><summary className="text-xs cursor-pointer">{i+1} · {node.tagName} · {node.getAttribute('attributeName')||node.getAttribute('type')||'动画'}</summary>{animationFields.filter(attr=>['dur','begin','repeatCount'].includes(attr)||node.hasAttribute(attr)).map(attr=><label className="block text-[11px] mt-2" key={attr}>{attr}<input key={node.getAttribute(attr)} className={field} defaultValue={node.getAttribute(attr)||''} onBlur={e=>setAttribute(node,attr,e.target.value)}/></label>)}</details>)}</details>}
    <details><summary className="text-xs cursor-pointer">HTML / SVG 源码</summary><textarea className={field+' font-mono'} rows={12} key={html} defaultValue={html} onBlur={e=>update(index,cleanHtml(e.target.value))}/></details>
  </div>;
}
