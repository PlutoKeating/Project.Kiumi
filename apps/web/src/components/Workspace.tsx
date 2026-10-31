import { ConfirmAction } from './ConfirmAction.tsx';
import { Modal } from './Modal.tsx';
import { useEffect, useState } from 'react';
import * as api from '../api.ts';
import { useStore } from '../store.ts';

const button='px-3 py-2 rounded border border-mist-200 hover:bg-mist-50 text-sm';
const input='border border-mist-200 rounded px-3 py-2 text-sm w-full';

export function Workspace({session,onChange}:{session:api.SessionState|null;onChange:()=>void}) {
  const [teams,setTeams]=useState<api.Team[]>([]), [active,setActive]=useState('');
  const [open,setOpen]=useState(false),[name,setName]=useState(''),[code,setCode]=useState('');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [members,setMembers]=useState<{id:string;name:string;role:string}[]>([]);
  const [docs,setDocs]=useState<{id:string;title:string;updatedAt:string}[]>([]);
  const user=session?.user;
  const current=teams.find(t=>t.id===active);

  const select=(id:string) => {
    api.setWorkspace(user?.sub ?? 'guest',id);
    localStorage.setItem(`kiumi.team.${user?.sub}`,id);
    setActive(id); useStore.getState().restoreScope(); onChange();
  };
  const refresh=async()=> {
    if(!api.teamId()) {setDocs([]);setMembers([]);return;}
    const [documents,people]=await Promise.all([api.listDocuments(),api.request<typeof members>('/api/teams/members')]);
    setDocs(documents);setMembers(people);
  };
  useEffect(()=> {
    if(!session) return;
    let alive=true;
    if(!user) {api.setWorkspace('guest','');useStore.getState().restoreScope();setTeams([]);setActive('');return;}
    api.listTeams().then(list=>{
      if(!alive)return;setTeams(list);
      const saved=localStorage.getItem(`kiumi.team.${user.sub}`);
      select(list.find(t=>t.id===saved)?.id ?? list[0]?.id ?? '');
      if(!list.length)setOpen(true);
    }).catch(e=>setNotice(e.message));
    return()=>{alive=false;};
  },[user?.sub,session?.loginEnabled]);
  useEffect(()=>{if(open)void refresh().catch(e=>setNotice(e.message));},[open,active]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setNotice('');try{await fn();}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}};

  return <>
    <button className={button} onClick={()=>setOpen(true)}>{current?.name ?? '团队与文稿'}</button>
    {open && <Modal onClose={()=>!busy&&setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="团队工作空间" aria-busy={busy} className="workspace-dialog bg-white rounded-xl shadow-xl w-[900px] max-h-[85vh] overflow-y-auto p-6 text-ink-900" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5"><h2 className="text-lg font-semibold">团队工作空间</h2><button disabled={busy} className={button} onClick={()=>setOpen(false)}>关闭</button></div>
        {notice && <p role="status" className="mb-4 text-sm text-accent-500 break-all">{notice}</p>}
        {!user ? <div className="workspace-welcome"><p>登录后创建或加入团队，共享文稿、图库和公众号。</p><a className={button+' dialog-primary'} href="/auth/login">登录 / 注册</a></div> : <>
          <div className="workspace-switcher"><label htmlFor="workspace-team">当前团队</label><select id="workspace-team" disabled={busy} className={input+' max-w-[260px]'} value={active} onChange={e=>select(e.target.value)}><option value="">选择团队</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><span className="text-sm text-ink-600">团队内文稿和图库共享</span></div>
          <div className="workspace-join">
            <form className="workspace-team-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const t=await api.createTeam(name);setTeams(await api.listTeams());select(t.id);setName('');});}}><label>新团队名称<input disabled={busy} className={input} placeholder="例如：内容编辑部" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={busy} className={button+' shrink-0'}>创建团队</button></form>
            <form className="workspace-team-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const t=await api.joinTeam(code);setTeams(await api.listTeams());select(t.id);setCode('');});}}><label>团队邀请码<input disabled={busy} className={input} placeholder="输入邀请人提供的邀请码" required value={code} onChange={e=>setCode(e.target.value)}/></label><button disabled={busy} className={button+' shrink-0'}>加入团队</button></form>
          </div>
          {active && <div className="grid grid-cols-[1fr_240px] gap-6">
            <div><div className="flex justify-between items-center mb-3"><h3 className="font-medium">团队文稿</h3><button className={button} onClick={()=>{try{const guest=JSON.parse(localStorage.getItem('kiumi.draft.guest.local')||'null');if(!guest?.blocks?.length){setNotice('没有登录前的本机稿件');return;}useStore.getState().loadDoc({...guest,id:`local-${crypto.randomUUID()}`});setOpen(false);}catch{setNotice('本机稿件无法读取');}}}>恢复登录前稿件</button><button className={button} disabled={busy} onClick={()=>void run(async()=>{await useStore.getState().save();await refresh();})}>保存当前稿件</button></div>
              {!docs.length && <p className="text-sm text-ink-600 py-6">还没有云端文稿。保存当前稿件后，团队成员都能打开。</p>}
              {docs.map(d=><div key={d.id} className="flex items-center gap-3 py-3 border-b border-mist-100"><button disabled={busy} className="text-left flex-1 min-w-0 break-words" onClick={()=>void run(async()=>{useStore.getState().loadDoc(await api.openDocument(d.id));setOpen(false);})}><div>{d.title}</div><div className="text-xs text-ink-600 mt-1">{new Date(d.updatedAt).toLocaleString()}</div></button><ConfirmAction label="删除" question={`删除「${d.title}」？团队成员将无法再打开此文稿。`} busy={busy} onConfirm={()=>run(async()=>{await api.deleteDocument(d.id);if(useStore.getState().doc.id===d.id)useStore.getState().newDoc();await refresh();})} /></div>)}
            </div>
            <div><h3 className="font-medium mb-3">团队成员</h3>{members.map(m=><div className="text-sm py-2 flex gap-2" key={m.id}><span className="flex-1 truncate">{m.name}</span><span>{m.role==='owner'?'创建者':''}</span>{current?.role==='owner'&&m.role!=='owner'&&<button disabled={busy} onClick={()=>void run(async()=>{await api.request('/api/teams/members',{method:'DELETE',body:JSON.stringify({userId:m.id})});await refresh();})}>移除</button>}</div>)}
              {current?.role==='owner'&&<button className={button+' mt-3'} disabled={busy} onClick={()=>void run(async()=>{const v=await api.request<{code:string}>('/api/teams/invite',{method:'POST'});setNotice(`邀请码（7 天有效，生成新码后旧码失效）：${v.code}`);})}>生成邀请码</button>}
            </div>
          </div>}
        </>}
      </section>
    </Modal>}
  </>;
}
