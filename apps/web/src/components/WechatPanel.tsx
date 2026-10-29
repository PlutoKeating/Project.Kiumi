import { useEffect, useState } from 'react';
import * as api from '../api.ts';
import { useStore } from '../store.ts';

type Account={id:string;name:string;appId:string};
const field='w-full rounded border border-mist-200 px-3 py-2 text-sm';
const button='rounded border border-mist-200 px-3 py-2 text-sm hover:bg-mist-50 disabled:opacity-40';
export function WechatPanel() {
  const [open,setOpen]=useState(false),[accounts,setAccounts]=useState<Account[]>([]),[account,setAccount]=useState('');
  const [images,setImages]=useState<Awaited<ReturnType<typeof api.listUploads>>>([]),[cover,setCover]=useState('');
  const [name,setName]=useState(''),[appId,setAppId]=useState(''),[secret,setSecret]=useState('');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[owner,setOwner]=useState(false);
  const [requestId,setRequestId]=useState(crypto.randomUUID());
  const [result,setResult]=useState<{mediaId:string;verified:boolean;previewUrl?:string}|null>(null);
  const [adding,setAdding]=useState(false);
  const reload=async()=> {
    const [list,uploads,teams]=await Promise.all([api.request<Account[]>('/api/accounts'),api.listUploads(),api.listTeams()]);
    setAccounts(list);setImages(uploads);setOwner(teams.find(t=>t.id===api.teamId())?.role==='owner');
    setAccount(old=>list.some(a=>a.id===old)?old:list[0]?.id??'');
    if(!list.length)setAdding(true);
  };
  useEffect(()=>{if(open) {setNotice('');void reload().catch(e=>setNotice(e.message));}},[open]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn();}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}};
  return <>
    <button className={button} onClick={()=>setOpen(true)}>公众号草稿</button>
    {open&&<div className="fixed inset-0 z-50 bg-ink-900/50 flex items-center justify-center" onClick={()=>!busy&&setOpen(false)}><section className="w-[680px] max-h-[85vh] overflow-y-auto bg-white rounded-xl p-6" onClick={e=>e.stopPropagation()}>
      <div className="flex justify-between mb-5"><h2 className="font-semibold text-lg">同步到公众号草稿箱</h2><button disabled={busy} onClick={()=>setOpen(false)}>关闭</button></div>
      <p className="text-sm text-ink-600 mb-4">选择团队公众号和封面，正文图片会自动传到微信。正式发表在公众号后台完成。</p>
      {notice&&<p role="status" className="text-red-600 text-sm mb-4 break-words">{notice}</p>}
      {accounts.length>0&&<><label className="block text-sm mb-4">公众号<select className={field+' mt-1'} value={account} onChange={e=>{setAccount(e.target.value);setRequestId(crypto.randomUUID());setResult(null);}}>{accounts.map(a=><option value={a.id} key={a.id}>{a.name} · {a.appId}</option>)}</select></label>
        <label className="block text-sm mb-4">作者<input className={field+' mt-1'} maxLength={16} defaultValue={useStore.getState().doc.meta.author??''} onBlur={e=>{const state=useStore.getState();state.commit({...state.doc,meta:{...state.doc.meta,author:e.target.value}});}}/></label>
        <div className="text-sm mb-2">封面图片</div><div className="grid grid-cols-6 gap-2 mb-3 max-h-[200px] overflow-y-auto">{images.map(i=><button key={i.id} className={`rounded border-2 overflow-hidden ${cover===i.url?'border-accent-500':'border-transparent'}`} onClick={()=>{setCover(i.url);setResult(null);setRequestId(crypto.randomUUID());}}><img src={i.url} alt={i.name} className="w-full h-20 object-cover"/></button>)}</div>
        <label className={button+' inline-block cursor-pointer mb-5'}>上传封面<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void run(async()=>{const uploaded=await api.uploadImage(f);setCover(uploaded.url);await reload();});}}/></label>
        <div className="flex gap-2 mb-5"><button disabled={busy||!account||!cover||Boolean(result)} className={button+' bg-accent-500 text-white hover:bg-accent-400'} onClick={()=>void run(async()=>{
          const saved=useStore.getState();if(!await saved.save())throw new Error('文稿保存失败，请重试后再同步');const doc=useStore.getState().doc;
          if(doc.id.startsWith('local-'))throw new Error('请先保存稿件到当前团队');
          const value=await api.request<NonNullable<typeof result>>('/api/wechat/draft',{method:'POST',body:JSON.stringify({documentId:doc.id,accountId:account,cover,requestId})});
          setResult(value);
        })}>{busy?'正在处理图片与草稿…':'保存并同步草稿'}</button><a className={button} href="https://mp.weixin.qq.com" target="_blank" rel="noreferrer">打开公众号后台</a></div>
        {result&&<div className="rounded bg-green-50 text-green-800 p-4 mb-4 text-sm"><p>草稿已创建{result.verified?'，回读确认成功':'；请在公众号后台确认内容'}。</p><p className="mt-2 break-all">草稿编号：{result.mediaId}</p><button className={button+' mt-3'} onClick={()=>{setResult(null);setRequestId(crypto.randomUUID());}}>准备下一次同步</button></div>}
      </>}
      {owner&&<div className="border-t border-mist-200 pt-4"><button className={button} onClick={()=>setAdding(v=>!v)}>管理团队公众号</button>{adding&&<>
        {accounts.map(a=><div key={a.id} className="flex justify-between text-sm my-3"><span>{a.name}</span><button onClick={()=>{if(confirm(`解除「${a.name}」与团队的绑定？`))void run(async()=>{await api.request('/api/accounts/'+a.id,{method:'DELETE'});await reload();});}}>解除绑定</button></div>)}
        <form className="space-y-3 mt-4" onSubmit={e=>{e.preventDefault();void run(async()=>{await api.request('/api/accounts',{method:'POST',body:JSON.stringify({name,appId,secret})});setSecret('');setName('');setAppId('');await reload();setNotice('公众号已连接');});}}>
          <input className={field} placeholder="公众号名称" required value={name} onChange={e=>setName(e.target.value)}/><input className={field} placeholder="AppID" required value={appId} onChange={e=>setAppId(e.target.value)}/><input type="password" autoComplete="new-password" className={field} placeholder="AppSecret（仅用于服务端连接，不回显）" required value={secret} onChange={e=>setSecret(e.target.value)}/><button disabled={busy} className={button}>验证并绑定</button>
        </form>
      </>}</div>}
    </section></div>}
  </>;
}
