import { ConfirmAction } from './ConfirmAction.tsx';
import { PanelState } from './PanelState.tsx';
import { Modal } from './Modal.tsx';
import { useEffect, useState } from 'react';
import * as api from '../api.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';
import { SheetHeader } from './ui.tsx';

type Account={id:string;name:string;appId:string};
export function WechatPanel() {
  const [open,setOpen]=useState(false),[accounts,setAccounts]=useState<Account[]>([]),[account,setAccount]=useState('');
  const [images,setImages]=useState<Awaited<ReturnType<typeof api.listUploads>>>([]),[cover,setCover]=useState('');
  const [name,setName]=useState(''),[appId,setAppId]=useState(''),[secret,setSecret]=useState('');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[owner,setOwner]=useState(false);
  const [requestId,setRequestId]=useState(crypto.randomUUID());
  const [result,setResult]=useState<{mediaId:string;verified:boolean;previewUrl?:string}|null>(null);
  const [adding,setAdding]=useState(false),[loading,setLoading]=useState(false);
  const reload=async()=> {
    const [list,uploads,teams]=await Promise.all([api.request<Account[]>('/api/accounts'),api.listUploads(),api.listTeams()]);
    setAccounts(list);setImages(uploads);setOwner(teams.find(t=>t.id===api.teamId())?.role==='owner');
    setAccount(old=>list.some(a=>a.id===old)?old:list[0]?.id??'');
    if(!list.length)setAdding(true);
  };
  useEffect(()=>{if(open) {setNotice('');setLoading(true);void reload().catch(e=>setNotice(e.message)).finally(()=>setLoading(false));}},[open]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn();}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}};
  const select=(run:()=>void)=>{run();setResult(null);setRequestId(crypto.randomUUID());};
  const sync=()=>void run(async()=>{
    const saved=useStore.getState();if(!await saved.save())throw new Error('文稿保存失败，请重试后再同步');const doc=useStore.getState().doc;
    if(doc.id.startsWith('local-'))throw new Error('请先保存稿件到当前团队');
    const value=await api.request<NonNullable<typeof result>>('/api/wechat/draft',{method:'POST',body:JSON.stringify({documentId:doc.id,accountId:account,cover,requestId})});
    setResult(value);
  });
  return <>
    <button type="button" className="btn btn-plain" onClick={()=>{setCover(useStore.getState().doc.meta.cover??'');setOpen(true);}}><Icon name="send" size={16} />公众号草稿</button>
    {open&&<Modal onClose={()=>!busy&&setOpen(false)}><section role="dialog" aria-modal="true" aria-label="公众号草稿" aria-busy={busy || loading} className="sheet sheet-md wechat-dialog" onClick={e=>e.stopPropagation()}>
      <SheetHeader title="同步到公众号草稿箱" detail="选择公众号和封面，正文图片会自动传到微信。正式发表在公众号后台完成。" disabled={busy} onClose={()=>setOpen(false)} />
      <div className="sheet-body">
        {notice&&<p role="status" className="sheet-notice" data-tone={notice==='公众号已连接'?'ok':'error'}>{notice}</p>}
        {loading && <PanelState title="正在读取团队公众号" loading />}
        {!loading && !notice && accounts.length === 0 && <PanelState icon="send" title="还没有连接公众号" detail={owner ? '在下方管理团队公众号，验证并绑定后即可同步草稿。' : '请先在左上角选择团队，并请创建者连接公众号。'} />}
        {!loading && accounts.length>0&&<fieldset disabled={busy} className="wechat-draft-fields">
          <div className="field-pair">
            <label className="field-label">公众号<div className="select-pill is-field"><select aria-label="公众号" value={account} onChange={e=>select(()=>setAccount(e.target.value))}>{accounts.map(a=><option value={a.id} key={a.id}>{a.name} · {a.appId}</option>)}</select><Icon name="chevron" size={14} /></div></label>
            <label className="field-label">作者<input className="field" aria-label="作者" maxLength={16} defaultValue={useStore.getState().doc.meta.author??''} onBlur={e=>{const state=useStore.getState();state.commit({...state.doc,meta:{...state.doc.meta,author:e.target.value}});}}/></label>
          </div>
          <div className="cover-section">
            <header className="section-head"><h3>封面图片</h3><label className="btn btn-plain cover-upload"><Icon name="upload" size={15} />上传封面<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="上传封面" className="sr-only" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run(async()=>{const uploaded=await api.uploadImage(f);setCover(uploaded.url);await reload();});}}/></label></header>
            {images.length>0?<div className="cover-grid">{images.map(i=><button type="button" key={i.id} aria-label={`选择封面：${i.name}`} aria-pressed={cover===i.url} onClick={()=>select(()=>setCover(i.url))}><img src={i.url} alt={i.name}/>{cover===i.url&&<span><Icon name="check" size={14} /></span>}</button>)}</div>:<p className="quiet-note">团队图库还没有图片，上传一张作为封面。</p>}
          </div>
          {result&&<div className="sync-result"><Icon name="check" size={18} /><div><p>草稿已创建{result.verified?'，回读确认成功':'；请在公众号后台确认内容'}。</p><small>草稿编号：{result.mediaId}</small></div><button type="button" className="btn btn-plain" onClick={()=>{setResult(null);setRequestId(crypto.randomUUID());}}>准备下一次同步</button></div>}
          <footer className="sheet-actions"><a className="btn btn-plain" href="https://mp.weixin.qq.com" target="_blank" rel="noreferrer"><Icon name="external" size={15} />打开公众号后台</a><button type="button" data-glint disabled={busy||!account||!cover||Boolean(result)} className="btn btn-candy" onClick={sync}>{busy?'正在处理图片与草稿…':'保存并同步草稿'}</button></footer>
        </fieldset>}
        {!loading && owner&&<div className="account-manage"><button type="button" disabled={busy} aria-expanded={adding} className="disclosure" onClick={()=>setAdding(v=>!v)}>管理团队公众号<Icon name="chevron" size={14} /></button>{adding&&<>
          {accounts.map(a=><div key={a.id} className="account-row"><span>{a.name}</span><ConfirmAction label="解除绑定" question={`解除「${a.name}」与团队的绑定？之后将无法从此团队同步到该公众号。`} busy={busy} onConfirm={()=>run(async()=>{await api.request('/api/accounts/'+a.id,{method:'DELETE'});await reload();})} /></div>)}
          <form className="account-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api.request('/api/accounts',{method:'POST',body:JSON.stringify({name,appId,secret})});setSecret('');setName('');setAppId('');await reload();setNotice('公众号已连接');});}}>
            <label className="field-label">公众号名称<input disabled={busy} className="field" placeholder="例如：周末编辑室" required value={name} onChange={e=>setName(e.target.value)}/></label>
            <label className="field-label">AppID<input disabled={busy} className="field" placeholder="公众号 AppID" required value={appId} onChange={e=>setAppId(e.target.value)}/></label>
            <label className="field-label">AppSecret<input disabled={busy} type="password" autoComplete="new-password" className="field" placeholder="仅用于服务端连接，不回显" required value={secret} onChange={e=>setSecret(e.target.value)}/></label>
            <button disabled={busy} className="btn btn-tint">验证并绑定</button>
          </form>
        </>}</div>}
      </div>
    </section></Modal>}
  </>;
}
