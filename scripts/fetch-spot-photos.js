#!/usr/bin/env node
/*
 * 景點卡片的照片：從 Wikimedia Commons 抓取，存到 docs/assets/spots/<id>/（兩趟共用），並產生 credits.json。
 * 要抓哪幾張寫在 data/trips/<trip>/spots/<id>.json 的 photos（--trip 指定哪一趟，見 scripts/lib/trip.js）：
 *   [{ "id": "檔名", "label": "照片說明", "cat": ["Category:…"], "q": ["Commons 搜尋字串", …], "pick": "File:…" }]
 *   cat（Commons 分類）比 q（全文搜尋）準，兩者可以並用
 *
 *   node scripts/fetch-spot-photos.js <id> --candidates   依標準搜尋候選，寫入 scripts/.cache/spot-<id>-candidates.json 與 .html
 *   node scripts/fetch-spot-photos.js <id>                下載 pick 指定的照片（960px）並產生 credits.json
 *
 * 選圖標準與頁首照片相同（見 fetch-hero-photos.js，不要放寬）：
 *   1. 自由授權（CC0／PD／CC-BY／CC-BY-SA）
 *   2. EXIF 拍攝日期在 TAKEN_AFTER 之後（近五年）；上傳日期不算數
 *   3. 橫式。卡片裡是約 280px 寬的 4:3 小圖，原圖寬 ≥ 1920px 就夠（頁首是滿版橫幅才要 3000px）
 * 一定要用眼睛看過再填 pick：搜尋結果常混進同名的別處，或是拍到的根本不是那個地方。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');
const TRIP = require('./lib/trip').resolve();
const UA = 'tokyo-trip/1.0 (personal travel itinerary)';

/* Wikimedia 只對一組標準寬度產生縮圖（非標準寬度會被限流），960 是其中之一 */
const WIDTH = 960;
const MIN_WIDTH = 1920;
const TAKEN_AFTER = '2021-09-21';   // 同頁首照片：2026-09-21 往前推五年

const FREE = /^(cc0|cc[ -]by|pd|public[ -]domain|no restrictions)/i;
const isFree = (lic) => FREE.test(String(lic || '').trim());
const clean = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = 'https://commons.wikimedia.org/w/api.php?format=json&' + new URLSearchParams(params);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error('HTTP ' + res.status);
    await sleep(3000 * (i + 1));
  }
  throw new Error('Commons API 重試失敗');
}

/* EXIF 拍攝時間的寫法很雜，解析不出日期就當作不合格（同 fetch-hero-photos.js） */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];
function takenDate(raw) {
  const s = clean(raw);
  let m = s.match(/(\d{4})[-:/.](\d{1,2})[-:/.](\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && MONTHS.indexOf(m[2].toLowerCase()) !== -1) {
    return m[3] + '-' + String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }
  m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS.indexOf(m[1].toLowerCase()) !== -1) {
    return m[3] + '-' + String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0') + '-' + m[2].padStart(2, '0');
  }
  return '';
}

function describe(page) {
  const ii = page.imageinfo && page.imageinfo[0];
  if (!ii) return null;
  const em = ii.extmetadata || {};
  const cats = clean(em.Categories && em.Categories.value);
  return {
    title: page.title,
    width: ii.width,
    height: ii.height,
    taken: takenDate(em.DateTimeOriginal && em.DateTimeOriginal.value),
    takenRaw: clean(em.DateTimeOriginal && em.DateTimeOriginal.value).slice(0, 40),
    license: clean(em.LicenseShortName && em.LicenseShortName.value),
    licenseUrl: clean(em.LicenseUrl && em.LicenseUrl.value),
    artist: clean(em.Artist && em.Artist.value) || '未註明',
    descurl: ii.descriptionurl,
    thumburl: ii.thumburl,
    thumbwidth: ii.thumbwidth,
    thumbheight: ii.thumbheight,
    desc: clean(em.ImageDescription && em.ImageDescription.value).slice(0, 160),
    quality: /Quality images/i.test(cats) ? 'QI' : '',
    featured: /Featured pictures/i.test(cats) ? 'FP' : '',
    valued: /Valued images/i.test(cats) ? 'VI' : '',
  };
}

function reject(d) {
  if (!d) return '沒有圖片資訊';
  if (!isFree(d.license)) return '授權不符：' + (d.license || '未標示');
  if (!d.taken) return '沒有可解析的拍攝日期（' + (d.takenRaw || '空白') + '）';
  if (d.taken < TAKEN_AFTER) return '拍攝於 ' + d.taken + '，超過五年';
  if (d.width < MIN_WIDTH) return '原圖寬 ' + d.width + 'px，不到 ' + MIN_WIDTH;
  if (d.width <= d.height) return '直式照片';
  return '';
}

function loadSpot(id) {
  const file = path.join(TRIP.data, 'spots', id + '.json');
  if (!fs.existsSync(file)) throw new Error('找不到 ' + path.relative(ROOT, file));
  const spot = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(spot.photos) || !spot.photos.length) throw new Error(id + '.json 沒有 photos');
  return spot;
}

async function candidates(id) {
  const spot = loadSpot(id);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = [];
  for (const p of spot.photos) {
    const seen = new Map();
    /* 分類比全文搜尋準：單一城門、庭園這種小地點，全文搜尋常常只找到一兩張，還混進同名的學校 */
    for (const cat of p.cat || []) {
      let cont = {};
      for (let page = 0; page < 4; page++) {
        const j = await api({
          action: 'query', generator: 'categorymembers', gcmtitle: cat, gcmtype: 'file', gcmlimit: '50',
          prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '330', ...cont,
        });
        for (const pg of j.query && j.query.pages ? Object.values(j.query.pages) : []) {
          const d = describe(pg);
          if (d && !seen.has(d.title) && !reject(d)) seen.set(d.title, d);
        }
        await sleep(800);
        if (!j.continue || !j.continue.gcmcontinue) break;
        cont = { gcmcontinue: j.continue.gcmcontinue };
      }
    }
    for (const q of p.q || []) {
      const j = await api({
        action: 'query', generator: 'search',
        gsrsearch: 'filetype:bitmap filew:>' + (MIN_WIDTH - 1) + ' ' + q,
        gsrnamespace: '6', gsrlimit: '50',
        prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '330',
      });
      for (const page of j.query && j.query.pages ? Object.values(j.query.pages) : []) {
        const d = describe(page);
        if (d && !seen.has(d.title) && !reject(d)) seen.set(d.title, d);
      }
      await sleep(800);
    }
    const list = [...seen.values()].sort((a, b) =>
      (!!(b.featured || b.quality || b.valued) - !!(a.featured || a.quality || a.valued))
      || (b.taken > a.taken ? 1 : b.taken < a.taken ? -1 : 0)).slice(0, 16);
    out.push({ id: p.id, label: p.label, list });
    console.log((list.length ? '✓ ' : '✗ ') + p.id.padEnd(20) + list.length + ' 張合格');
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'spot-' + id + '-candidates.json'), JSON.stringify(out, null, 2), 'utf8');

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html = '<!doctype html><meta charset="utf-8"><title>' + esc(id) + ' 候選</title>'
    + '<style>body{font:13px system-ui;margin:12px;background:#222;color:#eee}h2{margin:18px 0 6px;font-size:15px}'
    + '.row{display:flex;flex-wrap:wrap;gap:8px}.c{width:250px}.c img{width:250px;height:188px;object-fit:cover;display:block;border-radius:4px}'
    + '.c small{display:block;line-height:1.35;color:#bbb;word-break:break-all}.b{color:#fc6;font-weight:700}</style>'
    + out.map((g) => '<h2>' + esc(g.id) + '｜' + esc(g.label) + '（' + g.list.length + '）</h2><div class="row">'
      + g.list.map((d, i) => '<div class="c"><img src="' + esc(d.thumburl) + '" loading="lazy">'
        + '<small><b>#' + i + '</b> ' + esc(d.taken) + '｜' + d.width + '×' + d.height
        + ' <span class="b">' + [d.featured, d.quality, d.valued].filter(Boolean).join(' ') + '</span><br>'
        + esc(d.title.replace(/^File:/, '')) + '</small></div>').join('') + '</div>').join('');
  fs.writeFileSync(path.join(CACHE_DIR, 'spot-' + id + '-candidates.html'), html, 'utf8');
  console.log('\n預覽：' + path.join(CACHE_DIR, 'spot-' + id + '-candidates.html'));
}

async function download(id) {
  const spot = loadSpot(id);
  const outDir = path.join(ROOT, 'docs', 'assets', 'spots', id);
  fs.mkdirSync(outDir, { recursive: true });
  const credits = [];
  for (const p of spot.photos) {
    if (!p.pick) { console.log('⚠ ' + p.id + ' 還沒有 pick，略過'); continue; }
    const j = await api({
      action: 'query', titles: p.pick, prop: 'imageinfo',
      iiprop: 'url|extmetadata|size', iiurlwidth: String(WIDTH),
    });
    const page = j.query && j.query.pages ? Object.values(j.query.pages)[0] : null;
    const d = page && page.missing === undefined ? describe(page) : null;
    const why = reject(d);
    if (why) { console.log('✗ ' + p.id + '  ' + why + '：' + p.pick); continue; }

    const res = await fetch(d.thumburl, { headers: { 'User-Agent': UA } });
    if (!res.ok) { console.log('✗ ' + p.id + '  下載失敗 HTTP ' + res.status); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(outDir, p.id + '.jpg'), buf);
    credits.push({
      id: p.id, label: p.label, file: d.title.replace(/^File:/, ''),
      author: d.artist, license: d.license, licenseUrl: d.licenseUrl,
      taken: d.taken, source: d.descurl,
      width: d.thumbwidth, height: d.thumbheight, bytes: buf.length,
    });
    console.log('✓ ' + p.id.padEnd(20) + (buf.length / 1024).toFixed(0).padStart(5) + ' KB  '
      + d.taken + '  ' + d.width + '×' + d.height + '  ' + d.license + '  ' + d.artist);
    await sleep(500);
  }

  /* 一張都沒成功就不要動既有的照片與清單 */
  if (!credits.length) {
    console.log('✗ 沒有任何照片下載成功，保留原本的照片不動');
    process.exit(1);
  }
  const keep = new Set(credits.map((c) => c.id + '.jpg'));
  for (const f of fs.readdirSync(outDir)) {
    if (f.endsWith('.jpg') && !keep.has(f)) {
      fs.unlinkSync(path.join(outDir, f));
      console.log('  − 移除舊照片 ' + f);
    }
  }
  fs.writeFileSync(path.join(outDir, 'credits.json'), JSON.stringify(credits, null, 2) + '\n', 'utf8');
  const total = credits.reduce((s, c) => s + c.bytes, 0);
  console.log('\n成功 ' + credits.length + ' 張，合計 ' + (total / 1024).toFixed(0) + ' KB，已寫入 credits.json');
}

const id = TRIP.argv.find((a) => !a.startsWith('--'));
if (!id) {
  console.error('用法：node scripts/fetch-spot-photos.js <景點 id> [--candidates]');
  process.exit(1);
}
(process.argv.includes('--candidates') ? candidates(id) : download(id)).catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
