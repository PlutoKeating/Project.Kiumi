import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Development-only synthetic data. No real account, upload, or publishing call is made.
const output = fileURLToPath(new URL('../.impeccable/review/current/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const source = '<section style="padding:20px;background:#edf3fc;border-radius:12px"><h2 style="font-size:22px;color:#355d9b">给生活留一点空白</h2><p>带一本喜欢的书，在午后的树荫下慢慢读。</p><img src="/assets/review-0.svg" style="width:100%;margin-top:12px;border-radius:10px"></section>';
const templates = ['清晨蓝调', '周末来信', '春日手记', '留白时刻'].map((displayName, i) => ({ atomTplId: `review-${i}`, displayName, room: 'demo:header', accessibility: 'Public', hasSvg: false, hasAnimation: false, byteSize: 200 }));
const uploads = [0,1,2].map(i => ({ id: `image-${i}`, name: `示例封面 ${i+1}`, url: `/assets/review-${i}.svg`, path: `review-${i}.svg`, bytes: 200 }));
await page.route('**/assets/review-*.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="#e4edfb"/><rect x="24" y="24" width="152" height="92" rx="12" fill="#f4dfe9"/><text x="100" y="76" text-anchor="middle" fill="#74536b" font-size="16">示例图片</text></svg>' }));
let resourceState = 'ready', signedOut = false;
await page.route('**/api/**', async route => {
 const path = new URL(route.request().url()).pathname;
 if (path === '/api/assets' && resourceState === 'loading') await new Promise(resolve => setTimeout(resolve, 1000));
 if (path === '/api/assets' && resourceState === 'error') return route.fulfill({status:503,json:{ok:false,error:{message:'素材暂时不可用'}}});
 if (path === '/api/uploads' && signedOut) return route.fulfill({status:401,json:{ok:false,error:{message:'请先登录'}}});
 if (path === '/api/me' && signedOut) return route.fulfill({json:{ok:true,data:{user:null,loginEnabled:true}}});
 if (path === '/api/import/url') { await new Promise(resolve => setTimeout(resolve, 1000)); return route.fulfill({status:503,json:{ok:false,error:{message:'网页暂时无法读取，请稍后重试'}}}); }
 const data = path === '/api/me' ? { user: { sub: 'reviewer', name: '示例编辑' }, loginEnabled: true }
  : path === '/api/teams' ? [{ id: 'review-team', name: '示例编辑部', role: 'owner' }]
  : path === '/api/teams/members' ? [{ id:'reviewer',name:'示例编辑',role:'owner' }]
  : path === '/api/accounts' ? [{id:'review-account',name:'示例公众号',appId:'demo'}]
  : path === '/api/documents' ? [{id:'demo-document',title:'示例团队文稿',updatedAt:'2026-10-30T00:00:00Z'}]
  : path === '/api/rooms' ? [{tag:'demo:header',name:'标题',count:4}]
  : path === '/api/templates' || path === '/api/catalog/index' ? templates
  : path === '/api/template' ? { atomTplId:'review-0', displayName:'示例模板',html:source,matrix:[] }
  : path === '/api/uploads' || path === '/api/assets' ? (resourceState === 'empty' ? [] : uploads) : [];
 return route.fulfill({json:{ok:true,data,meta:{total:resourceState === 'empty' ? 0 : 3}}});
});
await page.goto(process.env.KIUMI_UI_URL ?? 'http://127.0.0.1:5184');
await page.getByRole('button', {name:'示例编辑部',exact:true}).waitFor();
await page.evaluate(async ({source,templates}) => {
 const {useStore}=await import('/src/store.ts');const s=useStore.getState();
 const block={kind:'library',id:'review-body',tplId:'review-0',html:source,matrix:[]};
 s.loadDoc({...s.doc,title:'周末阅读计划（示例）',blocks:[block,{kind:'native',id:'review-text',node:{kind:'text',text:'把忙碌留在身后，记录值得分享的日常。'}}]});
 useStore.setState({templates,favoriteBlocks:[block],clipboard:[block]});
}, {source,templates});
const files=[];
async function capture(name) {
 await page.waitForTimeout(250);
 await page.screenshot({path:`${output}${name}.png`}); files.push(`${name}.png`); console.log(`Captured ${name}`);
}
for (const width of [1280,1440,1920]) {
 await page.setViewportSize({width,height:900}); await capture(`desktop-${width}`);
}
await page.setViewportSize({width:1440,height:900});
for (const [label,name] of [['图片素材','assets'],['图文收藏','favorites'],['剪贴板','clipboard'],['我的图库','gallery']]) {
 await page.getByRole('button',{name:label,exact:true}).click(); await capture(name);
}
await page.getByRole('button',{name:'图文模板',exact:true}).click();
await page.locator('[data-editor-block="review-body"]').click(); await capture('selected');
await page.getByRole('button',{name:'大纲',exact:true}).click(); await capture('inspector-outline');
await page.getByRole('button',{name:'图文',exact:true}).click(); await capture('inspector-article');
await page.getByRole('button',{name:'内容',exact:true}).click();
const bar=page.getByRole('toolbar',{name:'内容块工具栏'});
for (const summary of await bar.locator('summary').all()) {
 const label=await summary.getAttribute('aria-label');await summary.click();await capture(`tools-${label}`);await summary.click();
}
await page.getByRole('button',{name:'更多文稿操作',exact:true}).click();await capture('top-menu');await page.keyboard.press('Escape');
for (const [label,name] of [['导入内容','import'],['示例编辑部','team'],['公众号草稿','wechat'],['预览','preview']]) {
 await page.getByRole('button',{name:label,exact:true}).click(); await page.getByRole('dialog').waitFor(); await capture(name); await page.keyboard.press('Escape');
}
await page.setViewportSize({width:1280,height:680});
await page.getByRole('button',{name:'公众号草稿',exact:true}).click();await page.getByRole('button',{name:'管理团队公众号'}).click();await capture('wechat-low-height');
await page.getByLabel('AppSecret',{exact:true}).focus();await capture('wechat-account-fields');await page.keyboard.press('Escape');
await page.getByRole('button',{name:'导入内容',exact:true}).click();await capture('import-low-height');
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'预览',exact:true}).click();await capture('preview-low-height');await page.keyboard.press('Escape');
await page.locator('[data-editor-block="review-body"]').click();await bar.locator('summary[aria-label="更多"]').click();await capture('toolbar-low-height');await bar.locator('summary[aria-label="更多"]').click();
await page.getByRole('button',{name:'示例编辑部',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'删除',exact:true}).click();await capture('delete-confirmation');await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
for (const state of ['loading','error','empty']) {
 resourceState=state;await page.getByRole('button',{name:'图文模板',exact:true}).click();await page.getByRole('button',{name:'图片素材',exact:true}).click();
 if(state==='loading') await page.getByText('正在加载素材',{exact:true}).waitFor();
 if(state==='error') await page.getByText('素材加载失败',{exact:true}).waitFor();
 if(state==='empty') await page.getByText('素材库还没有图片',{exact:true}).waitFor();
 await capture(`assets-${state}`);
}
resourceState='ready';
await page.getByRole('button',{name:'导入内容',exact:true}).click();
await page.getByLabel('粘贴内容').evaluate(el=>{
 const data=new DataTransfer();data.setData('text/html','<p style="mso-outline-level:1">示例标题</p><p>图片需补充<img src="file:///missing.png"></p>');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));
});
await page.getByText('确认导入预览',{exact:true}).waitFor();await capture('import-issues');await page.keyboard.press('Escape');
await page.getByRole('button',{name:'导入内容',exact:true}).click();await page.getByRole('button',{name:'网页地址',exact:true}).click();await page.getByLabel('导入文本').fill('https://example.com/demo');await page.getByRole('button',{name:'生成预览',exact:true}).click();await page.getByText('正在解析，请稍候…',{exact:true}).waitFor();await capture('import-processing');await page.getByText('网页暂时无法读取，请稍后重试',{exact:true}).waitFor({timeout:30000});await capture('import-error');await page.keyboard.press('Escape');
await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-editor-block="review-body"]').click();await bar.locator('summary[aria-label="间距"]').click();await capture('reduced-motion');await bar.locator('summary[aria-label="间距"]').click();
// Simulate the declared no-backdrop fallback material, without claiming native engine support testing.
await page.addStyleTag({content:'.capsule::before,.island::before,.dock::before,.block-toolbar::before,.toast::before,.glass-pop::before,.pop-menu::before,.tool-popover::before,.sheet::before{backdrop-filter:none!important;background:#f8f8fe!important}.modal-backdrop{backdrop-filter:none!important}'});
await page.getByRole('button',{name:'导入内容',exact:true}).click();await capture('simulated-no-backdrop');await page.keyboard.press('Escape');
signedOut=true;await page.reload();await page.getByRole('link',{name:'登录',exact:true}).waitFor();await page.getByRole('button',{name:'团队与文稿',exact:true}).click();await capture('signed-out-team');await page.keyboard.press('Escape');await page.getByRole('button',{name:'我的图库',exact:true}).click();await page.getByText('图库暂时无法读取',{exact:true}).waitFor();await capture('signed-out-gallery');
await writeFile(`${output}manifest.json`,JSON.stringify({fixture:'All data are synthetic; API requests intercepted',files},null,2));
await browser.close();
console.log(`Captured ${files.length} states in ${output}`);
