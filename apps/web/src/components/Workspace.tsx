import { ConfirmAction } from './ConfirmAction.tsx';
import { Modal } from './Modal.tsx';
import { useEffect, useState } from 'react';
import * as api from '../api.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icon.tsx';
import { PanelState } from './PanelState.tsx';
import { SheetHeader } from './ui.tsx';

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
  const restoreGuest=()=>{try{const guest=JSON.parse(localStorage.getItem('kiumi.draft.guest.local')||'null');if(!guest?.blocks?.length){setNotice('没有登录前的本机稿件');return;}useStore.getState().loadDoc({...guest,id:`local-${crypto.randomUUID()}`});setOpen(false);}catch{setNotice('本机稿件无法读取');}};

  return <>
    <button type="button" className="team-button" aria-label={current?.name ?? '团队与文稿'} data-tip="团队、文稿与成员" onClick={()=>setOpen(true)}><span>{current?.name ?? '团队与文稿'}</span><Icon name="chevron" size={13} /></button>
    {open && <Modal onClose={()=>!busy&&setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="团队工作空间" aria-busy={busy} className="sheet sheet-lg workspace-dialog" onClick={e=>e.stopPropagation()}>
        <SheetHeader title="团队工作空间" detail="团队内共享文稿、图库和公众号，团队之间互相隔离。" disabled={busy} onClose={()=>setOpen(false)} />
        <div className="sheet-body">
          {notice && <p role="status" className="sheet-notice">{notice}</p>}
          {!user ? <div className="workspace-welcome">
            <PanelState icon="user" title="登录后开始协作" detail="创建或加入团队，一起编辑文稿、管理图库和公众号。未登录也能排版，文稿会保留在本机。" />
            <a className="btn btn-candy" href="/auth/login">登录 / 注册</a>
          </div> : <>
            <div className="workspace-top">
              <label className="field-label">当前团队
                <div className="select-pill is-field"><select id="workspace-team" aria-label="当前团队" disabled={busy} value={active} onChange={e=>select(e.target.value)}><option value="">选择团队</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><Icon name="chevron" size={14} /></div>
              </label>
              <form className="inline-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const t=await api.createTeam(name);setTeams(await api.listTeams());select(t.id);setName('');});}}><label className="field-label">新团队名称<input disabled={busy} className="field" placeholder="例如：内容编辑部" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={busy} className="btn btn-tint">创建团队</button></form>
              <form className="inline-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const t=await api.joinTeam(code);setTeams(await api.listTeams());select(t.id);setCode('');});}}><label className="field-label">团队邀请码<input disabled={busy} className="field" placeholder="邀请人提供的邀请码" required value={code} onChange={e=>setCode(e.target.value)}/></label><button disabled={busy} className="btn btn-tint">加入团队</button></form>
            </div>
            {active && <div className="workspace-columns">
              <section aria-label="团队文稿">
                <header className="section-head"><h3>团队文稿</h3><button type="button" className="btn btn-plain" onClick={restoreGuest}>恢复登录前稿件</button><button type="button" className="btn btn-tint" disabled={busy} onClick={()=>void run(async()=>{await useStore.getState().save();await refresh();})}>保存当前稿件</button></header>
                {!docs.length && <PanelState icon="filePlus" title="还没有云端文稿" detail="保存当前稿件后，团队成员都能打开。" />}
                <ul className="doc-list">{docs.map(d=><li key={d.id}>
                  <button type="button" disabled={busy} className="doc-open" onClick={()=>void run(async()=>{useStore.getState().loadDoc(await api.openDocument(d.id));setOpen(false);})}><strong>{d.title}</strong><span>{new Date(d.updatedAt).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })}</span></button>
                  <ConfirmAction label="删除" question={`删除「${d.title}」？团队成员将无法再打开此文稿。`} busy={busy} onConfirm={()=>run(async()=>{await api.deleteDocument(d.id);if(useStore.getState().doc.id===d.id)useStore.getState().newDoc();await refresh();})} />
                </li>)}</ul>
              </section>
              <section aria-label="团队成员">
                <header className="section-head"><h3>团队成员</h3><span>{members.length} 人</span></header>
                <ul className="member-list">{members.map(m=><li key={m.id}><span className="avatar">{m.name.slice(0,1).toUpperCase()}</span><span>{m.name}</span>{m.role==='owner'?<em>创建者</em>:current?.role==='owner'&&<button type="button" className="text-action is-danger" disabled={busy} onClick={()=>void run(async()=>{await api.request('/api/teams/members',{method:'DELETE',body:JSON.stringify({userId:m.id})});await refresh();})}>移除</button>}</li>)}</ul>
                {current?.role==='owner'&&<button type="button" className="btn btn-tint is-block" disabled={busy} onClick={()=>void run(async()=>{const v=await api.request<{code:string}>('/api/teams/invite',{method:'POST'});setNotice(`邀请码（7 天有效，生成新码后旧码失效）：${v.code}`);})}>生成邀请码</button>}
              </section>
            </div>}
          </>}
        </div>
      </section>
    </Modal>}
  </>;
}
