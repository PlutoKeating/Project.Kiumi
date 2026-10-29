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
    {open && <div className="fixed inset-0 z-50 bg-ink-900/50 flex items-center justify-center" onClick={()=>setOpen(false)}>
      <section className="bg-white rounded-xl shadow-xl w-[900px] max-h-[85vh] overflow-y-auto p-6 text-ink-900" onClick={e=>e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5"><h2 className="text-lg font-semibold">团队工作空间</h2><button className={button} onClick={()=>setOpen(false)}>关闭</button></div>
        {notice && <p role="status" className="mb-4 text-sm text-accent-500 break-all">{notice}</p>}
        {!user ? <div className="space-y-4"><p>登录后创建或加入团队，共享文稿、图库和公众号。</p><a className={button} href="/auth/login">登录 / 注册</a></div> : <>
          <div className="flex gap-3 mb-5 items-center"><label>当前团队</label><select className={input+' max-w-[260px]'} value={active} onChange={e=>select(e.target.value)}><option value="">选择团队</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><span className="text-sm text-ink-600">团队内文稿和图库共享</span></div>
          <div className="grid grid-cols-2 gap-5 mb-6">
            <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void run(async()=>{const t=await api.createTeam(name);setTeams(await api.listTeams());select(t.id);setName('');});}}><input className={input} placeholder="新团队名称" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/><button disabled={busy} className={button+' shrink-0'}>创建团队</button></form>
            <form className="flex gap-2" onSubmit={e=>{e.preventDefault();void run(async()=>{const t=await api.joinTeam(code);setTeams(await api.listTeams());select(t.id);setCode('');});}}><input className={input} placeholder="输入团队邀请码" required value={code} onChange={e=>setCode(e.target.value)}/><button disabled={busy} className={button+' shrink-0'}>加入团队</button></form>
          </div>
          {active && <div className="grid grid-cols-[1fr_240px] gap-6">
            <div><div className="flex justify-between items-center mb-3"><h3 className="font-medium">团队文稿</h3><button className={button} disabled={busy} onClick={()=>void run(async()=>{await useStore.getState().save();await refresh();})}>保存当前稿件</button></div>
              {!docs.length && <p className="text-sm text-ink-600 py-6">还没有云端文稿。保存当前稿件后，团队成员都能打开。</p>}
              {docs.map(d=><div key={d.id} className="flex items-center gap-3 py-3 border-b border-mist-100"><button className="text-left flex-1" onClick={()=>void run(async()=>{useStore.getState().loadDoc(await api.openDocument(d.id));setOpen(false);})}><div>{d.title}</div><div className="text-xs text-ink-600 mt-1">{new Date(d.updatedAt).toLocaleString()}</div></button><button className="text-xs text-ink-600" onClick={()=>{if(confirm(`删除「${d.title}」？`))void run(async()=>{await api.deleteDocument(d.id);if(useStore.getState().doc.id===d.id)useStore.getState().newDoc();await refresh();});}}>删除</button></div>)}
            </div>
            <div><h3 className="font-medium mb-3">团队成员</h3>{members.map(m=><div className="text-sm py-2 flex gap-2" key={m.id}><span className="flex-1 truncate">{m.name}</span><span>{m.role==='owner'?'创建者':''}</span>{current?.role==='owner'&&m.role!=='owner'&&<button onClick={()=>void run(async()=>{await api.request('/api/teams/members',{method:'DELETE',body:JSON.stringify({userId:m.id})});await refresh();})}>移除</button>}</div>)}
              {current?.role==='owner'&&<button className={button+' mt-3'} disabled={busy} onClick={()=>void run(async()=>{const v=await api.request<{code:string}>('/api/teams/invite',{method:'POST'});setNotice(`邀请码（7 天有效，生成新码后旧码失效）：${v.code}`);})}>生成邀请码</button>}
            </div>
          </div>}
        </>}
      </section>
    </div>}
  </>;
}
