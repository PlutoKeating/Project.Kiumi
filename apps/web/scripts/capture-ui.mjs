import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Development-only synthetic data. No real account, upload, or publishing call is made.
const output = fileURLToPath(new URL('../.impeccable/review/current/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
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
 if (path === '/api/render') return route.fulfill({json:{ok:true,data:{html:'<p>示例</p>',issues:[],bytes:12}}});
 if (path === '/api/wechat/draft') return route.fulfill({json:{ok:true,data:{mediaId:'demo-media-id-0001',verified:true}}});
 if (path.startsWith('/api/documents') && route.request().method() !== 'GET') return route.fulfill({json:{ok:true,data:{id:'demo-document',meta:{createdAt:'2026-10-30T00:00:00Z'}}}});
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
const contrastDir = process.env.KIUMI_CONTRAST_DIR;
// Records every visible string and icon, then a text-free frame: glass has no single background
// colour, so `audit-contrast.py` measures contrast against the pixels actually on screen.
async function recordContrast(name) {
 const items = await page.evaluate(() => {
  const out = [], skip = '[data-block-content],.import-item-body,.import-preview [data-import-block] > div:last-child,iframe';
  const alpha = el => { let a = 1; for (let n = el; n; n = n.parentElement) a *= Number(getComputedStyle(n).opacity); return a; };
  const shown = (el, r) => { if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false; if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true }) || alpha(el) < .05) return false; if (el.closest('.toast')) return true; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!hit) return false; const control = el.closest('button,summary,label,a,[role=textbox]'); return el.contains(hit) || (!!control && control.contains(hit)); };
  const push = (el, r, text, color, kind) => { const s = getComputedStyle(el); out.push({ text: text.slice(0, 40), kind, color, alpha: alpha(el), size: parseFloat(s.fontSize) * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1), weight: Number(s.fontWeight), disabled: !!el.closest(':disabled,[aria-disabled="true"]'), where: (el.closest('[class]')?.getAttribute('class') || el.tagName).split(' ').slice(0, 2).join('.'), rect: [r.left, r.top, r.right, r.bottom] }); };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
   const el = n.parentElement; if (!n.textContent.trim() || !el || el.closest(skip) || /^(SCRIPT|STYLE|TEXTAREA|OPTION)$/.test(el.tagName)) continue;
   const range = document.createRange(); range.selectNodeContents(n); const r = range.getBoundingClientRect();
   if (shown(el, r)) push(el, r, n.textContent.trim(), getComputedStyle(el).color, 'text');
  }
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=file]):not(.sr-only),textarea,[role=textbox]')) {
   if (el.closest(skip)) continue; const r = el.getBoundingClientRect(); if (!shown(el, r)) continue;
   const value = el.value ?? el.textContent; if (value) push(el, r, value, getComputedStyle(el).color, 'value');
   else { const ph = el.placeholder ?? el.dataset.placeholder; if (ph) push(el, r, ph, getComputedStyle(el, el.placeholder ? '::placeholder' : '::before').color, 'placeholder'); }
  }
  for (const el of document.querySelectorAll('svg')) {
   if (el.closest(skip) || el.closest('.empty-paper') || el.closest('.brand')) continue; const r = el.getBoundingClientRect(); if (shown(el, r)) push(el, r, 'icon', getComputedStyle(el).color, 'icon');
  }
  return out;
 });
 const veil = await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}*{color:transparent!important;-webkit-text-fill-color:transparent!important;caret-color:transparent!important}::placeholder,[data-placeholder]::before{color:transparent!important}svg{visibility:hidden!important}' });
 await page.waitForTimeout(60);
 await page.screenshot({ path: `${contrastDir}/${name}.png` });
 await veil.evaluate(node => node.remove());
 await writeFile(`${contrastDir}/${name}.json`, JSON.stringify(items));
}
async function capture(name) {
 await page.waitForTimeout(250);
 await page.screenshot({path:`${output}${name}.png`}); files.push(`${name}.png`); console.log(`Captured ${name}`);
 if (contrastDir) await recordContrast(name);
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
await page.getByRole('button',{name:'更多文稿操作',exact:true}).click();await capture('top-menu');await page.keyboard.press('Escape');await page.getByRole('combobox',{name:'模板分类'}).click();await capture('listbox-category');await page.keyboard.press('Escape');
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
// Interaction states and the worst case for translucent chrome: dark or vivid article under the glass.
await page.setViewportSize({width:1440,height:900});
await page.locator('[data-editor-block="review-body"]').click();
await page.getByRole('button',{name:'图文模板',exact:true}).click();await page.locator('.tpl').nth(1).hover();await capture('tile-hover');
for (const [tool,name] of [['插入分割线','dock-hover'],['插入间距','dock-hover-blush'],['插入图片','dock-hover-mint'],['插入正文','dock-hover-lilac']]) {
 await page.getByRole('button',{name:tool}).hover();await capture(name);
}
await bar.getByRole('button',{name:'收藏',exact:true}).click();await page.locator('.toast[data-visible="true"]').waitFor();await capture('toast-ok');
await bar.locator('summary[aria-label="变换组件"]').click();await bar.getByRole('button',{name:'从模板库换样式'}).click();await page.mouse.move(700,860);await capture('toolbar-notice');
await page.keyboard.press('Escape');await bar.getByRole('button',{name:'关闭提示'}).click();await page.mouse.move(700,860);
await page.locator('[data-editor-block="review-body"]').click({button:'right'});await page.locator('.canvas-context-menu').waitFor();await capture('context-menu');
await page.locator('.canvas-context-menu button[data-danger]').hover();await capture('context-menu-danger');await page.keyboard.press('Escape');
await page.getByRole('button',{name:'复制到公众号',exact:true}).click();await page.locator('.btn-candy[data-state="done"]').waitFor();await capture('copy-done');
await page.getByRole('button',{name:'收起资源面板'}).click();await capture('collapsed');await page.locator('.rail-collapse').hover();await page.waitForTimeout(600);await capture('tooltip-collapsed');await page.getByRole('button',{name:'展开资源面板'}).click();await page.mouse.move(700,860);
await page.getByRole('button',{name:'公众号草稿',exact:true}).click();let draft=page.getByRole('dialog',{name:'公众号草稿'});
await draft.getByRole('button',{name:/^选择封面/}).first().click();await draft.getByRole('button',{name:'保存并同步草稿'}).click();await draft.locator('.sync-result').waitFor();await capture('wechat-sync-success');
if(await draft.getByRole('button',{name:'管理团队公众号'}).getAttribute('aria-expanded')!=='true')await draft.getByRole('button',{name:'管理团队公众号'}).click();await draft.getByLabel('公众号名称',{exact:true}).fill('周末编辑室');await draft.getByLabel('AppID',{exact:true}).fill('demo');await draft.getByLabel('AppSecret',{exact:true}).fill('demo');await draft.getByRole('button',{name:'验证并绑定'}).click();await draft.getByText('公众号已连接',{exact:true}).waitFor();await capture('wechat-connected');await page.keyboard.press('Escape');
for (const [name,colors] of [['stress-vivid',['#ff5a3c','#ffd400','#00b386','#2a6bff']],['stress-dark',['#101a3c','#1d1d1f','#0d3b2e','#3b0d2a']]]) {
 await page.evaluate(async colors => {
  const {useStore}=await import('/src/store.ts');const s=useStore.getState();
  s.loadDoc({...s.doc,title:'压力测试（示例）',blocks:Array.from({length:12},(_,i)=>({kind:'library',id:`stress-${i}`,tplId:'review-0',matrix:[],html:`<section style="height:220px;padding:24px;background:${colors[i%colors.length]};color:#fff"><h2>玻璃下的内容 ${i+1}</h2><p>深色或高饱和的模板穿过玻璃时，上面的文字也要看得清。</p></section>`}))});
 }, colors);
 await page.waitForTimeout(300);await page.locator('.editor-canvas').evaluate(el=>{el.scrollTop=420;});await page.waitForTimeout(100);
 await page.locator('[data-editor-block="stress-3"]').click();await page.mouse.move(700,300);await capture(name);
}
await page.evaluate(async()=>{(await import('/src/store.ts')).useStore.setState({message:'保存失败：网络连接已中断，请重试'});});await page.locator('.toast[data-tone="error"][data-visible="true"]').waitFor();await capture('toast-error');
await page.getByRole('button',{name:'保存',exact:true}).hover();await page.waitForTimeout(600);await capture('tooltip-dark');await page.mouse.move(700,300);
await page.setViewportSize({width:1280,height:680});
await page.evaluate(async source => {const {useStore}=await import('/src/store.ts');const s=useStore.getState();s.loadDoc({...s.doc,title:'周末阅读计划（示例）',blocks:[{kind:'library',id:'review-body',tplId:'review-0',html:source,matrix:[]}]});},source);
await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(300);await page.locator('[data-editor-block="review-body"]').click({force:true});await bar.locator('summary[aria-label="间距"]').click();await capture('reduced-motion');await page.keyboard.press('Escape');await bar.locator('summary[aria-label="间距"]').click();
// Simulate the declared no-backdrop fallback material, without claiming native engine support testing.
await page.addStyleTag({content:'.capsule::before,.island::before,.dock::before,.block-toolbar::before,.toast::before,.glass-pop::before,.pop-menu::before,.tool-popover::before,.sheet::before{backdrop-filter:none!important;background:#f8f8fe!important}.modal-backdrop{backdrop-filter:none!important}'});
await page.getByRole('button',{name:'导入内容',exact:true}).click();await capture('simulated-no-backdrop');await page.keyboard.press('Escape');
signedOut=true;await page.reload();await page.getByRole('link',{name:'登录',exact:true}).waitFor();await page.getByRole('button',{name:'团队与文稿',exact:true}).click();await capture('signed-out-team');await page.keyboard.press('Escape');await page.getByRole('button',{name:'我的图库',exact:true}).click();await page.getByText('登录后查看团队图库',{exact:true}).waitFor();await capture('signed-out-gallery');
await writeFile(`${output}manifest.json`,JSON.stringify({fixture:'All data are synthetic; API requests intercepted',files},null,2));
await browser.close();
console.log(`Captured ${files.length} states in ${output}`);
