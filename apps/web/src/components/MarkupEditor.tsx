import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.ts';
import * as api from '../api.ts';
import { cleanHtml } from '../lib/import.ts';
import { Icon } from './Icon.tsx';
import { Select } from './ui.tsx';

const animationFields=['dur','begin','end','repeatCount','repeatDur','values','from','to','by','keyTimes','keySplines','calcMode','fill','type','path','keyPoints','rotate','additive','accumulate'];

const toHex = (color: string) => {
  const parts = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*[,/)]/);
  return parts ? `#${parts.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}` : color;
};

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
  return <div className="markup-editor">{notice&&<p role="status" className="field-error">{notice}</p>}
    <details open><summary>文字<em>{model.texts.length}</em><Icon name="chevron" size={14} /></summary><div className="field-stack">{model.texts.map((node,i)=><textarea key={`${index}-text-${i}-${node.textContent}`} className="field" rows={1} defaultValue={node.textContent||''} aria-label={`文字 ${i+1}`} onBlur={e=>{node.nodeValue=e.target.value;save();}}/>)}</div></details>
    {model.images.length>0&&<details open><summary>图片<em>{model.images.length}</em><Icon name="chevron" size={14} /></summary><div className="field-stack">{model.images.map((node,i)=>{
      const attr=node.hasAttribute('src')?'src':node.hasAttribute('xlink:href')?'xlink:href':'href';
      const current=node.getAttribute(attr)||'';
      return <div key={`${index}-image-${i}`} className="image-field">
        <div className="image-field-row">
          <span className="image-thumb"><img src={current} alt="" /></span>
          <label className="btn btn-tint"><Icon name="upload" size={15} />上传替换<input type="file" aria-label={`上传替换图片 ${i+1}`} accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setNotice('');try{const item=await api.uploadImage(file);setAttribute(node,attr,item.url);setUploads(await api.listUploads());}catch(error){setNotice((error as Error).message);}}}/></label>
        </div>
        {uploads.length>0&&<Select variant="field" label={`从团队图库选择图片 ${i+1}`} value="" onChange={value=>{if(value)setAttribute(node,attr,value);}} options={[{value:'',label:'从团队图库选择'},...uploads.map(item=>({value:item.url,label:item.name}))]}/>}
        <input className="field" aria-label={`图片 ${i+1} 地址`} defaultValue={current} key={current} onBlur={e=>setAttribute(node,attr,e.target.value)}/>
      </div>;
    })}</div></details>}
    {model.colors.length>0&&<details open><summary>颜色<em>{model.colors.length}</em><Icon name="chevron" size={14} /></summary><div className="color-grid">{model.colors.map(color=><label key={color} className="color-field"><span style={{background:color}}/><input defaultValue={toHex(color)} aria-label={`替换颜色 ${color}`} onBlur={e=>{const next=e.target.value;if(next===toHex(color)||!CSS.supports('color',next))return;for(const el of model.root.content.querySelectorAll('*'))for(const attr of ['style','fill','stroke','color','values','from','to']){const value=el.getAttribute(attr);if(value?.includes(color))el.setAttribute(attr,value.split(color).join(next));}save();}}/></label>)}</div></details>}
    {model.links.length>0&&<details><summary>链接<em>{model.links.length}</em><Icon name="chevron" size={14} /></summary><div className="field-stack">{model.links.map((node,i)=><label key={i} className="field-label">{node.textContent?.slice(0,30)||`链接 ${i+1}`}<input className="field" key={node.getAttribute('href')} defaultValue={node.getAttribute('href')||''} onBlur={e=>setAttribute(node,'href',e.target.value)}/></label>)}</div></details>}
    {model.animations.length>0&&<details><summary>动画<em>{model.animations.length}</em><Icon name="chevron" size={14} /></summary><p className="quiet-note">时长使用 s/ms，重复次数可填 indefinite；触发器如 click 或 元素ID.click。</p><div className="field-stack">{model.animations.map((node,i)=><details key={`${index}-anim-${i}`} className="nested-details"><summary>{i+1} · {node.tagName} · {node.getAttribute('attributeName')||node.getAttribute('type')||'动画'}<Icon name="chevron" size={14} /></summary><div className="field-stack">{animationFields.filter(attr=>['dur','begin','repeatCount'].includes(attr)||node.hasAttribute(attr)).map(attr=><label className="field-label" key={attr}>{attr}<input key={node.getAttribute(attr)} className="field" defaultValue={node.getAttribute(attr)||''} onBlur={e=>setAttribute(node,attr,e.target.value)}/></label>)}</div></details>)}</div></details>}
    <details><summary>HTML / SVG 源码<Icon name="chevron" size={14} /></summary><textarea className="field is-code" aria-label="HTML / SVG 源码" rows={12} key={html} defaultValue={html} onBlur={e=>update(index,cleanHtml(e.target.value))}/></details>
  </div>;
}
