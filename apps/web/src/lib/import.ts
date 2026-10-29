import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { Block } from '../api.ts';

export function cleanHtml(html:string):string {
  return DOMPurify.sanitize(html,{ADD_TAGS:['animate','animateMotion','animateTransform','set'],ADD_ATTR:['attributeName','begin','dur','end','repeatCount','values','keyTimes','keySplines','calcMode','path','from','to','by','additive','accumulate','fill'],FORBID_TAGS:['script','iframe','object','embed','form','input','button','textarea','select','link','meta','base'],FORBID_ATTR:['srcdoc']});
}

/** Inline author styles in a script-free isolated document before discarding CSS. */
export async function importHtml(source:string,baseUrl?:string):Promise<Block[]> {
  const parsed=new DOMParser().parseFromString(source,'text/html');
  if(baseUrl)for(const element of parsed.querySelectorAll('[src],[href]'))for(const attr of ['src','href']) {
    const value=element.getAttribute(attr);if(value&&!value.startsWith('#'))try{element.setAttribute(attr,new URL(value,baseUrl).href);}catch{}
  }
  const styles=[...parsed.querySelectorAll('style')].map(s=>s.textContent||'').join('\n').replace(/@import[^;]+;/gi,'').replace(/<\/style/gi,'');
  const content=cleanHtml(parsed.body.innerHTML);
  const frame=document.createElement('iframe');frame.sandbox.add('allow-same-origin');
  frame.style.cssText='position:fixed;left:-10000px;width:677px;height:1000px;visibility:hidden';
  const loaded=new Promise<void>(resolve=>{frame.onload=()=>resolve();});
  frame.srcdoc=`<!doctype html><meta charset="utf-8"><style>body{margin:0;font-family:Arial,sans-serif;font-size:16px;line-height:1.75}img{max-width:100%}${styles}</style><body>${content}</body>`;
  document.body.append(frame);
  try {
    await Promise.race([loaded,new Promise<void>(resolve=>setTimeout(resolve,3000))]);
    const root=frame.contentDocument!.body, win=frame.contentWindow!;
    const props=['color','background-color','background-image','font-size','font-family','font-weight','font-style','text-align','text-decoration','line-height','letter-spacing','padding','margin','border','border-radius','width','max-width','height','display','vertical-align','white-space','list-style-type','overflow','position','top','left','right','bottom','transform'];
    const changes:[Element,string][]=[];
    for(const el of root.querySelectorAll('*')) {
      if(el.closest('svg'))continue;
      const computed=win.getComputedStyle(el);
      changes.push([el,props.map(p=>`${p}:${computed.getPropertyValue(p)}`).join(';')]);
    }
    for(const [el,style] of changes)el.setAttribute('style',style);
    return [{kind:'library',id:crypto.randomUUID(),tplId:'imported:html',matrix:[],html:cleanHtml(root.innerHTML)}];
  } finally {frame.remove();}
}
export async function importMarkdown(text:string):Promise<Block[]> {
  return importHtml(await marked.parse(text,{gfm:true,breaks:true}));
}
