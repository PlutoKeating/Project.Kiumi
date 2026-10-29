import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createHmac } from 'node:crypto';

test('Worker teams isolate drafts and uploads; invitations allow sharing', async () => {
  const bundled=await build({entryPoints:[new URL('../src/index.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const key='local-test-key-never-used-in-production';
  let deliveries=0;
  let deliveredHtml='';
  const mf=new Miniflare({modules:true,script:bundled.outputFiles[0]!.text,compatibilityDate:'2026-01-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{KIUMI_DATA_KEY:key},serviceBindings:{KIUMI_DATA:async(req)=>{if(new URL(req.url).pathname==='/wechat'){const payload=await req.json() as any;if(payload.action==='draft'){deliveries++;deliveredHtml=payload.html;}return Response.json({ok:true,data:payload.action==='check'?{connected:true}:{mediaId:'test-draft',verified:true}});}if(new URL(req.url).pathname.includes('/catalog/templates/'))return Response.json({atomTplId:'test',html:'<h2>模板</h2>',matrix:[]});if(new URL(req.url).pathname.endsWith('.json'))return Response.json({});return new Response(req.method==='PUT'?'stored':'image');},ASSETS:async()=>new Response('app')}});
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
    const template=await mf.dispatchFetch('https://test.invalid/api/template?id=test&localAssets=true');
    assert.equal(template.status,200);
    assert.ok(template.headers.get('etag'));
    const unchanged=await mf.dispatchFetch('https://test.invalid/api/template?id=test&localAssets=true',{headers:{'if-none-match':template.headers.get('etag')!}});
    assert.equal(unchanged.status,304);
    const compressed=await mf.dispatchFetch('https://test.invalid/api/template?id=test&localAssets=true',{headers:{'if-none-match':'W/'+template.headers.get('etag')}});
    assert.equal(compressed.status,304,'Cloudflare compression weakens ETags; GET revalidation must still match');
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
    assert.equal((await call('bob','/api/accounts','POST',{name:'test',appId:'wx1234567890123456',secret:'test-secret'},team)).status,403);
    assert.equal((await call('alice','/api/accounts','POST',{name:'test',appId:'wx1234567890123456',secret:'test-secret'},team)).status,200);
    const account=(await call('alice','/api/accounts','GET',undefined,team)).data[0];
    assert.equal(account.secret,undefined);
    const stored=await db.prepare('SELECT secret FROM wechat_accounts').first<{secret:string}>();
    assert.ok(!stored!.secret.includes('test-secret'));
    const form=new FormData();form.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'cover.png',{type:'image/png'}));
    const encoded=new Request('https://test.invalid',{method:'POST',body:form});
    const uploaded=await mf.dispatchFetch('https://test.invalid/api/assets/upload',{method:'POST',headers:{cookie:cookie('alice'),'x-team-id':team,'content-type':encoded.headers.get('content-type')!},body:await encoded.arrayBuffer()});
    const upload=(await uploaded.json() as any).data;
    const repeatForm=new FormData();repeatForm.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10])],'same.png',{type:'image/png'}));
    const repeatEncoded=new Request('https://test.invalid',{method:'POST',body:repeatForm});
    const repeatUpload=await mf.dispatchFetch('https://test.invalid/api/assets/upload',{method:'POST',headers:{cookie:cookie('alice'),'x-team-id':team,'content-type':repeatEncoded.headers.get('content-type')!},body:await repeatEncoded.arrayBuffer()});
    assert.equal((await repeatUpload.json() as any).data.url,upload.url,'retry must reuse the stored image');
    assert.equal((await call('alice','/api/uploads','GET',undefined,team)).data.length,1);

    assert.equal(uploaded.status,201);
    assert.equal((await mf.dispatchFetch('https://test.invalid'+upload.url)).status,403);
    const exportDoc={version:1,id:'test-export',title:'导出',meta:{},blocks:[{kind:'library',id:'image',tplId:'imported:html',matrix:[],html:`<img src="${upload.url}">`}]};
    const editor=await call('alice','/api/render','POST',{document:exportDoc,localAssets:true},team);
    assert.equal(editor.data.issues.filter((i:any)=>i.rule==='relative-image').length,0);
    const exported=await call('alice','/api/render','POST',{document:exportDoc},team);
    assert.equal(exported.status,200);
    const signed=exported.data.html.match(/src="([^"]+)"/)[1];
    assert.equal((await mf.dispatchFetch(signed)).status,200,'exported images must be externally readable');
    exportDoc.blocks[0].html=exported.data.html;
    const repeated=await call('alice','/api/render','POST',{document:exportDoc},team);
    assert.equal(repeated.data.html,exported.data.html,'re-exporting signed image URLs must not duplicate origin or query');
    const importedBlocks=[
      {kind:'library',id:'import-heading',tplId:'imported:2 级标题',matrix:[],html:'<h2>导入标题</h2>'},
      {kind:'library',id:'import-body',tplId:'imported:段落',matrix:[],html:'<p>中文正文 😀</p>'},
      {kind:'library',id:'import-image',tplId:'imported:图片',matrix:[],html:`<p><img src="${upload.url}"></p>`},
      {kind:'library',id:'import-table',tplId:'imported:表格',matrix:[],html:'<table><tr><td colspan="2">合并表格</td></tr></table>'},
    ];
    assert.equal((await call('alice','/api/documents/'+document.id,'PATCH',{blocks:importedBlocks},team)).status,200);
    const reopened=(await call('alice','/api/documents/'+document.id,'GET',undefined,team)).data;
    assert.deepEqual(reopened.blocks,importedBlocks,'imported blocks must survive D1 save and reopen');
    const article=(await call('alice','/api/render','POST',{document:reopened},team)).data.html;
    assert.ok(article.indexOf('导入标题')<article.indexOf('中文正文'));
    assert.match(article, /colspan="2"/);
    assert.doesNotMatch(article,/blob:|data:image/);
    const articleImage=article.match(/src="([^"]+)"/)[1];
    assert.equal((await mf.dispatchFetch(articleImage)).status,200);
    const draft={documentId:document.id,accountId:account.id,cover:upload.url,requestId:'same-click'};
    const first=await call('bob','/api/wechat/draft','POST',draft,team);
    assert.equal(first.status,200,JSON.stringify(first));
    assert.equal((await call('bob','/api/wechat/draft','POST',draft,team)).data.mediaId,'test-draft');
    assert.equal(deliveries,1,'retries must not create duplicate drafts');
    assert.match(deliveredHtml, /导入标题/);
    assert.match(deliveredHtml, /中文正文 😀/);
    assert.match(deliveredHtml, /colspan="2"/);
    assert.doesNotMatch(deliveredHtml, /blob:/);
    await call('alice','/api/teams/members','DELETE' ,{userId:'bob'},team);
    assert.equal((await call('bob','/api/documents/'+document.id,'GET',undefined,team)).status,403);
    assert.equal((await call('alice','/api/nonexistent')).status,404);
  } finally {await mf.dispose();}
});
