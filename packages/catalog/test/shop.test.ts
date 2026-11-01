import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteAssetUrlsStrict, shopImageProxyUrl } from '../src/assets.ts';
import {
  htmlFromShowData,
  normalizeShopRecord,
  normalizeRemoteProtocols,
  parseShowInfo,
  shopListUrl,
  SHOP_PAGE_SIZE,
  type ShopGoods,
  type ShopShowData,
} from '../src/shop.ts';

const good: ShopGoods = {
  show_goods_id: 42,
  show_id: 9001,
  price: 10,
  created_at: '2026-10-30T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  show: {
    show_id: 9001,
    title: '测试风格排版',
    desc: 'desc',
    cover: '//img.xiumi.us/xmi/cover.png',
    type: 2,
    type_text: 'paper',
    version: 5,
    show_url: 'https://v.xiumius.cn/board/v5/3FOLa/9001',
  },
  seller: { user_sid: 'abc', nickname: '设计师', userpage_url: 'https://v.xiumius.cn/u/abc' },
};

const data: ShopShowData = {
  title: good.show.title,
  cover: good.show.cover,
  cubes: [
    {
      pages: [
        {
          layers: [
            {
              _comp: {
                _$raHTML:
                  '<section><p>正文</p><img src="//img.xiumi.us/xmi/a.png"><img src="https://img.xiumi.us/xmi/b.png"></section>',
              },
            },
          ],
        },
      ],
    },
  ],
};

test('shopListUrl keeps the studio filter contract', () => {
  const url = new URL(shopListUrl('https://xiumi.us', 3, { priceScope: 'free', showType: 'paper' }));
  assert.equal(url.pathname, '/api/show_goods/goodses');
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.get('limit'), String(SHOP_PAGE_SIZE));
  assert.equal(url.searchParams.get('price_scope'), 'free');
  assert.equal(url.searchParams.get('show_type'), 'paper');
  assert.equal(url.searchParams.get('showgoods_type'), 'paper');
});

test('parseShowInfo decodes the injected shop blob', () => {
  const info = { show_id: 9001, show_data_url: '//sd.xiumius.cn/xmi/pd/a.json', title: 't' };
  const html = `<script>injectedData.showInfo = JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(info))}"));</script>`;
  assert.deepEqual(parseShowInfo(html), info);
  assert.equal(parseShowInfo('<html></html>'), null);
});

test('htmlFromShowData concatenates layers and falls back to preview', () => {
  assert.match(htmlFromShowData(data), /<p>正文<\/p>/);
  assert.equal(htmlFromShowData({ $appendix: { htmlForPreview: '<p>preview</p>' } }), '<p>preview</p>');
});

test('normalizeShopRecord maps price, provenance and assets', () => {
  const record = normalizeShopRecord(good, data, {
    origin: 'https://xiumi.us',
    cookie: '',
    limiter: {} as never,
    fetchedAt: '2026-11-01T00:00:00.000Z',
    rights: 'operator-confirmed',
  });
  assert.equal(record.atomTplId, 'shop:paper/42');
  assert.equal(record.displayName, '测试风格排版');
  assert.equal(record.room, '风格排版');
  assert.equal(record.accessibility, 'Paid');
  assert.equal(record.shop?.showGoodsId, 42);
  assert.equal(record.shop?.seller, '设计师');
  assert.equal(record.shop?.rights, 'operator-confirmed');
  assert.ok(record.assetUrls.includes('https://img.xiumi.us/xmi/a.png'));
  assert.ok(record.assetUrls.includes('https://img.xiumi.us/xmi/b.png'));
  assert.ok(record.assetUrls.includes('https://img.xiumi.us/xmi/cover.png'));
  assert.match(record.html, /src="https:\/\/img\.xiumi\.us\/xmi\/a\.png"/);
  assert.ok(record.byteSize > 0);
});

test('normalizeRemoteProtocols upgrades protocol-relative CDN URLs', () => {
  const html = '<img src="//img.xiumi.us/a.png"><div style="background:url(//statics.xiumi.us/b.png)"></div>';
  const out = normalizeRemoteProtocols(html);
  assert.match(out, /src="https:\/\/img\.xiumi\.us\/a\.png"/);
  assert.match(out, /url\(https:\/\/statics\.xiumi\.us\/b\.png\)/);
});

test('rewriteAssetUrlsStrict uses the fallback for unmirrored shop images', () => {
  const html = '<img src="https://img.xiumi.us/a.png"><img src="https://example.com/b.png">';
  const out = rewriteAssetUrlsStrict(html, {}, {
    strict: true,
    fallback: (url) => (url.includes('xiumi.us') ? shopImageProxyUrl(url) : null),
  });
  assert.match(out.html, /src="\/api\/shop-image\?url=https%3A%2F%2Fimg\.xiumi\.us%2Fa\.png"/);
  assert.match(out.html, /__missing\.svg/);
  assert.deepEqual(out.missing, ['https://example.com/b.png']);
});
