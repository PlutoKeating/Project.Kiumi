import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createHmac } from 'node:crypto';

test('Worker teams isolate drafts and uploads; invitations allow sharing', async () => {
  const bundled=await build({entryPoints:[new URL('../src/index.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const key='local-test-key-never-used-in-production';
  const mf=new Miniflare({modules:true,script:bundled.outputFiles[0]!.text,compatibilityDate:'2026-01-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{KIUMI_DATA_KEY:key},serviceBindings:{KIUMI_DATA:async(req)=>new Response(req.method==='PUT'?'stored':'image'),ASSETS:async()=>new Response('app')}});
  try {
    const db=await mf.getD1Database('DB');
    const migration=await readFile(new URL('../migrations/0001_teams.sql',import.meta.url),'utf8');
    for(const statement of migration.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
    const cookie=(user:string)=>{
      const value=JSON.stringify({sub:user,name:user,exp:Math.floor(Date.now()/1000)+3600});
      return 'kiumi_session='+encodeURIComponent(value+'.'+createHmac('sha256',`session:${key}`).update(value).digest('base64url'));
    };
    const call=async(user:string,path:string,method='GET',payload?:unknown,team?:string)=>{
      const response=await mf.dispatchFetch('https://test.invalid'+path,{method,headers:{cookie:cookie(user),'content-type':'application/json',...(team?{'x-team-id':team}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});
      return {status:response.status,...await response.json() as any};
    };
    const team=(await call('alice','/api/teams','POST',{name:'编辑组'})).data.id;
    const document=(await call('alice','/api/documents','POST',{title:'草稿',blocks:[]},team)).data;
    assert.equal((await call('bob','/api/documents/'+document.id,'GET',undefined,team)).status,403);
    assert.equal((await call('bob','/api/uploads','GET',undefined,team)).status,403);
    const invitation=(await call('alice','/api/teams/invite','POST',{},team)).data.code;
    assert.equal((await call('bob','/api/teams/join','POST',{code:invitation})).status,200);
    assert.equal((await call('bob','/api/documents/'+document.id,'GET',undefined,team)).data.title,'草稿');
    assert.equal((await call('bob','/api/teams/invite','POST',{},team)).status,403);
    const changed=await call('bob','/api/documents/'+document.id,'PATCH',{meta:{digest:'摘要'},title:'共同编辑'},team);
    assert.equal(changed.data.meta.digest,'摘要');
    await call('alice','/api/teams/members','DELETE',{userId:'bob'},team);
    assert.equal((await call('bob','/api/documents/'+document.id,'GET',undefined,team)).status,403);
    assert.equal((await call('alice','/api/nonexistent')).status,404);
  } finally {await mf.dispose();}
});
