import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeBody, fetchPublicPage, xiumiArticle, xiumiDataUrl, xiumiShowInfo } from '../import.mjs';

const info={show_id:1,title:'秀米标题',show_data_url:'//sd.xiumius.cn/xmi/pd/u/abc/1.json?_ver=1'};
const pageFor=showInfo=>`<!DOCTYPE html><html><head><title>秀米标题</title><script id="__pre_data">
window.injectedData = window.injectedData || {};
injectedData.showInfo = JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(showInfo))}"));
</script></head><body><div class="tn-temporary-preview-prompt" ng-cloak>此为临时链接，仅供预览，将在短期内失效。</div><article ng-cloak></article></body></html>`;
const readerPage=pageFor(info);
const showData={title:'秀米标题',$appendix:{htmlForPreview:'<section style="color:red"><p>正文</p><img src="//img.xiumi.us/a.jpg"></section>'}};

test('reads the injected showInfo and resolves only Xiumi-hosted show data over https',()=>{
  assert.deepEqual(xiumiShowInfo(readerPage),info);
  assert.equal(xiumiShowInfo('<html><body>plain</body></html>'),null);
  assert.equal(xiumiShowInfo(pageFor({show_id:1,title:'无正文地址'})),null);
  assert.equal(xiumiDataUrl(info,'https://v.xiumius.cn/board/v5/x/1'),'https://sd.xiumius.cn/xmi/pd/u/abc/1.json?_ver=1');
  assert.equal(xiumiDataUrl({show_data_url:'https://evil.example/x.json'},'https://v.xiumius.cn/'),null);
  assert.equal(xiumiDataUrl({show_data_url:'http://sd.xiumius.cn/x.json'},'https://v.xiumius.cn/'),null);
});

test('builds a titled document from htmlForPreview and refuses empty show data',()=>{
  const html=xiumiArticle(showData,info);
  assert.match(html,/<title>秀米标题<\/title>/);
  assert.match(html,/<body><section style="color:red"><p>正文<\/p>/);
  assert.equal(xiumiArticle({$appendix:{htmlForPreview:'  '}},info),null);
  assert.equal(xiumiArticle({},info),null);
  assert.match(xiumiArticle({$appendix:{htmlForPreview:'<p>x</p>'}},{title:'<b>'}),/<title>&lt;b&gt;<\/title>/);
});

test('fetchPublicPage follows the show-data link for Xiumi pages and passes other pages through',async()=>{
  const calls=[];
  const fetcher=async(url)=>{
    calls.push(url);
    if(url.endsWith('.json?_ver=1'))return {bytes:Buffer.from(JSON.stringify(showData)),type:'application/json',url};
    return {bytes:Buffer.from(readerPage),type:'text/html',url};
  };
  const xiumi=await fetchPublicPage('https://v.xiumius.cn/board/v5/x/1?in_preview=true',fetcher);
  assert.deepEqual(calls,['https://v.xiumius.cn/board/v5/x/1?in_preview=true','https://sd.xiumius.cn/xmi/pd/u/abc/1.json?_ver=1']);
  assert.ok(!xiumi.html.includes('此为临时链接'));
  assert.ok(xiumi.html.includes('<p>正文</p>'));
  assert.equal(xiumi.url,'https://v.xiumius.cn/board/v5/x/1?in_preview=true');

  const plain=await fetchPublicPage('https://example.com/post',async url=>({bytes:Buffer.from('<p>普通网页</p>'),type:'text/html',url}));
  assert.equal(plain.html,'<p>普通网页</p>');

  await assert.rejects(fetchPublicPage('https://v.xiumius.cn/board/v5/x/1',async url=>({bytes:Buffer.from(url.endsWith('.json?_ver=1')?'{}':readerPage),type:'',url})),/没有可读取的正文/);
});

test('decodes gzip bodies that origins send unconditionally, within the size limit',()=>{
  assert.equal(decodeBody(gzipSync('{"ok":true}'),'gzip',1024).toString(),'{"ok":true}');
  assert.equal(decodeBody(Buffer.from('plain'),undefined,1024).toString(),'plain');
  assert.throws(()=>decodeBody(gzipSync('x'.repeat(4096)),'gzip',1024));
});
