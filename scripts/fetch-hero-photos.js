#!/usr/bin/env node
/*
 * 從 Wikimedia Commons 抓取行程相關地標的照片，存到 docs/assets/hero/
 * 並產生 docs/assets/hero/credits.json（含作者與授權，供頁面標示出處）與 hero.js。
 *
 *   node scripts/fetch-hero-photos.js --candidates   依條件搜尋候選照片，產生預覽頁供挑選
 *   node scripts/fetch-hero-photos.js                下載 WANTED 裡 pick 指定的照片
 *
 * 選圖標準（2026-09-21 起，不要放寬）：
 *   1. 授權：只收明確標示自由授權的圖（CC0 / PD / CC-BY / CC-BY-SA）
 *   2. 拍攝日期：EXIF 拍攝時間在 TAKEN_AFTER 之後（近五年）。
 *      上傳日期不算數 —— 很多舊照片是好幾年後才上傳的
 *   3. 畫質：原圖寬度 ≥ MIN_WIDTH，且必須是橫式。
 *      頁首是滿版但只有約 200～250px 高的橫幅，直式照片會被裁成一條細縫
 *
 * 流程：先跑 --candidates，開 scripts/.cache/hero-candidates.html 用眼睛挑，
 * 把選中的檔名填進 WANTED 的 pick，再跑一次不帶參數的版本下載。
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join('docs', 'assets', 'hero');
const CACHE_DIR = path.join('scripts', '.cache');
const UA = 'osaka-kyoto-trip/1.0 (personal travel itinerary; https://github.com/threshadow98171314/osaka-kyoto-trip)';

/* Wikimedia 只對一組標準寬度產生縮圖（非標準寬度會被限流），1920 是其中之一。
   頁首在桌機是滿版寬度，1920 在 1080p 螢幕上不必放大；手機多下載一點但畫面銳利 */
const WIDTH = 1920;
const MIN_WIDTH = 3000;
const TAKEN_AFTER = '2021-11-07';   // 2026-11-07 往前推五年

/* 24 個地標（東京行程 2026/11/14～22），全部是行程會經過的地方。
   q：Commons 搜尋字串（Commons 的索引以英文為主，用中文幾乎搜不到）
   pick：在預覽頁挑定的檔名；下載時只用這個，確保每次重跑結果一致 */
const WANTED = [
  /* ---- 東京市區 ---- */
  { slug: 'tokyo-station',  caption: '東京駅 丸の内',        q: ['Tokyo Station Marunouchi', 'Tokyo Station red brick'],
    pick: 'File:KITTE Garden, Tokyo; September 2022 (09).jpg' },
  // 搜不到池袋 Sunshine 60 的合格照片，改用站前的西武百貨
  { slug: 'ikebukuro',      caption: '池袋站 西武百貨',      q: ['Ikebukuro Sunshine 60', 'Ikebukuro station'],
    pick: 'File:Ikebukuro-STA East.jpg' },
  { slug: 'meiji-jingu',    caption: '明治神宮 大鳥居',      q: ['Meiji Jingu', 'Meiji Shrine torii'],
    pick: 'File:Courtyard of Meiji Shrine 20220814a.jpg' },
  { slug: 'gaien-ginkgo',   caption: '神宮外苑 銀杏並木',     q: ['Meiji Jingu Gaien ginkgo', 'Icho Namiki Tokyo'],
    pick: 'File:Meiji Jingu Gaien Ginkgo Festival (53442107390).jpg' },
  // 近五年沒有秋天的新宿御苑照片，挑夏天的池畔景色
  { slug: 'shinjuku-gyoen', caption: '新宿御苑',             q: ['Shinjuku Gyoen autumn', 'Shinjuku Gyoen'],
    pick: 'File:Upper Pond, Shinjuku Gyoen National Garden, Tokyo, 20240822 1512 5467.jpg' },
  { slug: 'gotokuji',       caption: '豪德寺 招財貓',        q: ['Gotokuji maneki-neko', 'Gotokuji temple'],
    pick: 'File:ManekiNekoGotokuji2.jpg' },
  /* ---- 鎌倉・江之島 ---- */
  // 小町通的其他照片多是單一店面或招牌特寫，裁成橫幅看不出街景；挑一張能看到整條商店街延伸的
  { slug: 'komachi-dori',   caption: '鎌倉 小町通',          q: ['Komachi-dori Kamakura', 'Komachi Street Kamakura'],
    pick: 'File:Komachi-dori Street - Kamakura - 2026 Oct 1 various 1.jpg' },
  { slug: 'tsurugaoka',     caption: '鶴岡八幡宮 太鼓橋',     q: ['Tsurugaoka Hachimangu', 'Tsurugaoka Hachiman-gu Kamakura'],
    pick: 'File:Tsurugaoka-Hachimangu Taiko-bashi-East-side 20261018.jpg' },
  { slug: 'kamakura-daibutsu', caption: '鎌倉大佛（高德院）', q: ['Kotoku-in Kamakura Daibutsu', 'Great Buddha of Kamakura'],
    pick: 'File:20260420 Großer Buddha von Kamakura 03, Kanagawa, Japan anagoria.jpg' },
  { slug: 'enoden',         caption: '鎌倉駅 江之電',        q: ['Enoden Kamakura', 'Enoshima Electric Railway'],
    pick: 'File:Estación Kamakura JR East - 2026 - 03.jpg' },
  { slug: 'enoshima',       caption: '江之島 海之燈塔眺望',   q: ['Enoshima Sea Candle', 'Enoshima Island'],
    pick: 'File:Enoshima Samuel Cocking Garden from the Enoshima Sea Candle (Feb 2022).jpg' },
  // 近五年的湘南海岸照片幾乎都看不到富士山，挑七里濱遠眺江之島的一張
  { slug: 'shonan-fuji',    caption: '七里濱 遠眺江之島',     q: ['Shonan coast Mount Fuji sunset', 'Enoshima Mount Fuji'],
    pick: 'File:230128 At Shichirigahama Kamakura Kanagawa pref Japan04s3.jpg' },
  /* ---- 高尾山 ---- */
  // 近五年的高尾山紅葉照片只有纜車內部，改用山上的藥王院一帶（高尾山 紅葉、藥王院 合併為此張）
  { slug: 'takao-yakuoin',  caption: '高尾山 藥王院一帶',     q: ['Mount Takao', 'Takao-san Hachioji'],
    pick: 'File:Takao-san hike during winter 6.jpg' },
  { slug: 'takao-cablecar', caption: '高尾山纜車',           q: ['Takao Tozan Railway', 'Takaosanguchi'],
    pick: 'File:Around Takaosanguchi (11236).jpg' },
  /* ---- 河口湖 ---- */
  { slug: 'kawaguchiko',    caption: '河口湖 富士山',        q: ['Lake Kawaguchi Mount Fuji', 'Kawaguchiko Fuji'],
    pick: 'File:Kawaguchiko, Part II - Kawaguchiko6805.jpg' },
  { slug: 'arakura',        caption: '新倉山淺間公園 忠靈塔', q: ['Arakurayama Sengen Park', 'Chureito Pagoda'],
    pick: 'File:Chureito Pagoda and Mount Fuji 20241022.jpg' },
  // 紅葉迴廊搜不到合格照片；改挑同一帶湖畔的楓葉與銀杏（大石公園的合格照片都是陰天，也不採用）
  { slug: 'kawaguchiko-momiji', caption: '河口湖 湖畔楓葉',  q: ['Kawaguchiko autumn leaves', 'Kawaguchiko Maple Corridor Fuji'],
    pick: 'File:Kawaguchiko, Part I - Kawaguchiko6815.jpg' },
  /* ---- 淺草・下町 ---- */
  { slug: 'kaminarimon',    caption: '淺草寺 雷門',          q: ['Kaminarimon Asakusa', 'Senso-ji Kaminarimon'],
    pick: 'File:Kaminarimon- Asakusa - Nov 8 2021 various 18 23 04 718000.jpeg' },
  { slug: 'nakamise',       caption: '仲見世通',             q: ['Nakamise-dori Asakusa', 'Nakamise Street'],
    pick: 'File:Nakamise-Straße.jpg' },
  { slug: 'skytree',        caption: '東京晴空塔',           q: ['Tokyo Skytree', 'Tokyo Skytree Sumida'],
    pick: 'File:Aerial view of tokyo skytree.jpg' },
  { slug: 'rikugien',       caption: '六義園 紅葉',          q: ['Rikugien autumn', 'Rikugien garden'],
    pick: 'File:Bunkyo Rikugien Panoramic View In Early Autumn.jpg' },
  // 上野公園本體的合格照片都是陰天冬景，改挑不忍池（同在上野公園內）
  { slug: 'ueno-park',      caption: '上野公園 不忍池',      q: ['Shinobazu Pond', 'Ueno Park'],
    pick: 'File:Shinobazu Pond (Hasu Pond Area) 20211126 02.jpg' },
  { slug: 'ameyoko',        caption: '阿美橫町',             q: ['Ameyoko', 'Ameya-Yokocho Ueno'],
    pick: 'File:Ameya Yokocho Shopping Street (53150237663).jpg' },
  { slug: 'sumida-river',   caption: '隅田川',               q: ['Sumida River Tokyo', 'Sumida River Asakusa'],
    pick: 'File:Sumida River and Asakusa Architecture (53417021554).jpg' },
  // 已刪除：昭和記念公園 銀杏並木（近五年沒有合格照片，且與同日的其他地點重複性高）
];

/* 可接受的自由授權；注意要能同時對到 "CC BY-SA 4.0" 與 "Public domain" */
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

/* EXIF 拍攝時間的寫法很雜：「2023-10-18」「2016-11-16 19:34:23」
   「7 August 2019, 16:31:48」「Taken on 15 July 2010」都有。解析不出日期就當作不合格 */
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
    // Commons 社群評選過的照片：品質圖／精選圖／有價值的圖
    quality: /Quality images/i.test(cats) ? 'QI' : '',
    featured: /Featured pictures/i.test(cats) ? 'FP' : '',
    valued: /Valued images/i.test(cats) ? 'VI' : '',
  };
}

/* 不合標準的原因；空字串代表合格 */
function reject(d) {
  if (!d) return '沒有圖片資訊';
  if (!isFree(d.license)) return '授權不符：' + (d.license || '未標示');
  if (!d.taken) return '沒有可解析的拍攝日期（' + (d.takenRaw || '空白') + '）';
  if (d.taken < TAKEN_AFTER) return '拍攝於 ' + d.taken + '，超過五年';
  if (d.width < MIN_WIDTH) return '原圖寬 ' + d.width + 'px，不到 ' + MIN_WIDTH;
  if (d.width <= d.height) return '直式照片';
  return '';
}

async function search(q, thumbWidth) {
  const j = await api({
    action: 'query', generator: 'search',
    gsrsearch: 'filetype:bitmap filew:>' + (MIN_WIDTH - 1) + ' ' + q,
    gsrnamespace: '6', gsrlimit: '50',
    prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: String(thumbWidth),
  });
  return j.query && j.query.pages ? Object.values(j.query.pages) : [];
}

async function candidates() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = [];
  for (const w of WANTED) {
    const seen = new Map();
    for (const q of w.q) {
      for (const p of await search(q, 330)) {
        const d = describe(p);
        if (d && !seen.has(d.title) && !reject(d)) seen.set(d.title, d);
      }
      await sleep(800);
    }
    // 社群評選過的排前面，其次解析度
    const list = [...seen.values()].sort((a, b) =>
      (!!(b.featured || b.quality || b.valued) - !!(a.featured || a.quality || a.valued))
      || (b.width * b.height - a.width * a.height)).slice(0, 12);
    out.push({ slug: w.slug, caption: w.caption, list });
    console.log((list.length ? '✓ ' : '✗ ') + w.slug.padEnd(16) + list.length + ' 張合格');
  }
  fs.writeFileSync(path.join(CACHE_DIR, 'hero-candidates.json'), JSON.stringify(out, null, 2), 'utf8');

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html = '<!doctype html><meta charset="utf-8"><title>hero 候選</title>'
    + '<style>body{font:13px system-ui;margin:12px;background:#222;color:#eee}h2{margin:18px 0 6px;font-size:15px}'
    + '.row{display:flex;flex-wrap:wrap;gap:8px}.c{width:250px}.c img{width:250px;height:110px;object-fit:cover;display:block;border-radius:4px}'
    + '.c small{display:block;line-height:1.35;color:#bbb;word-break:break-all}.b{color:#fc6;font-weight:700}</style>'
    + out.map((g) => '<h2>' + esc(g.slug) + '｜' + esc(g.caption) + '（' + g.list.length + '）</h2><div class="row">'
      + g.list.map((d, i) => '<div class="c"><img src="' + esc(d.thumburl) + '" loading="lazy">'
        + '<small><b>#' + i + '</b> ' + esc(d.taken) + '｜' + d.width + '×' + d.height
        + ' <span class="b">' + [d.featured, d.quality, d.valued].filter(Boolean).join(' ') + '</span><br>'
        + esc(d.title.replace(/^File:/, '')) + '</small></div>').join('') + '</div>').join('');
  fs.writeFileSync(path.join(CACHE_DIR, 'hero-candidates.html'), html, 'utf8');
  console.log('\n預覽：' + path.join(CACHE_DIR, 'hero-candidates.html'));
}

/* 用 Pillow 重新存成 progressive JPEG，目標每張 MAX_BYTES 以下：
   quality 從 82 起每次降 4（最低 62），仍太大就把寬度縮到 1600 再試。
   需要 python3 與 Pillow（pip install pillow） */
const MAX_BYTES = 500 * 1024;
function recompress(buf) {
  const code = 'import sys,io\nfrom PIL import Image\n'
    + 'im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")\n'
    + 'def enc(i,q):\n o=io.BytesIO(); i.save(o,"JPEG",quality=q,progressive=True,optimize=True); return o.getvalue()\n'
    + 'best=None\n'
    + 'for i in (im, im.resize((1600,round(im.height*1600/im.width)),Image.LANCZOS)):\n'
    + ' for q in range(82,61,-4):\n'
    + '  best=enc(i,q)\n'
    + '  if len(best)<=' + MAX_BYTES + ': break\n'
    + ' if len(best)<=' + MAX_BYTES + ': break\n'
    + 'sys.stdout.buffer.write(best)';
  return require('child_process').execFileSync('python3', ['-c', code],
    { input: buf, maxBuffer: 64 * 1024 * 1024 });
}

async function download() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const credits = [];
  const missing = WANTED.filter((w) => !w.pick);
  if (missing.length) {
    console.log('⚠ 以下地標還沒有 pick，略過：' + missing.map((w) => w.slug).join('、'));
  }

  for (const w of WANTED.filter((x) => x.pick)) {
    const j = await api({
      action: 'query', titles: w.pick, prop: 'imageinfo',
      iiprop: 'url|extmetadata|size', iiurlwidth: String(WIDTH),
    });
    const page = j.query && j.query.pages ? Object.values(j.query.pages)[0] : null;
    const d = page && page.missing === undefined ? describe(page) : null;
    const why = reject(d);
    if (why) { console.log('✗ ' + w.slug + '  ' + why + '：' + w.pick); continue; }

    const res = await fetch(d.thumburl, { headers: { 'User-Agent': UA } });
    if (!res.ok) { console.log('✗ ' + w.slug + '  下載失敗 HTTP ' + res.status); continue; }
    const raw = Buffer.from(await res.arrayBuffer());
    const buf = recompress(raw);
    fs.writeFileSync(path.join(OUT_DIR, w.slug + '.jpg'), buf);
    credits.push({
      slug: w.slug, caption: w.caption, file: w.slug + '.jpg',
      sourceTitle: d.title, sourceUrl: d.descurl,
      author: d.artist, license: d.license, licenseUrl: d.licenseUrl,
      taken: d.taken, original: d.width + 'x' + d.height,
      bytes: buf.length,
    });
    console.log('✓ ' + w.slug.padEnd(16) + (buf.length / 1024).toFixed(0).padStart(5) + ' KB  '
      + d.taken + '  ' + d.width + '×' + d.height + '  ' + d.license);
    await sleep(500);
  }

  /* 一張都沒成功（例如還沒填 pick、或網路斷了）就不要動既有的照片與清單 */
  if (!credits.length) {
    console.log('✗ 沒有任何照片下載成功，保留原本的照片不動');
    process.exit(1);
  }

  /* 已不在清單上的舊照片一併刪掉，避免殘留在 repo 裡 */
  const keep = new Set(credits.map((c) => c.file));
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.jpg') && !keep.has(f)) {
      fs.unlinkSync(path.join(OUT_DIR, f));
      console.log('  − 移除舊照片 ' + f);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'credits.json'), JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'Wikimedia Commons',
    criteria: '自由授權、拍攝於 ' + TAKEN_AFTER + ' 之後、原圖寬 ≥ ' + MIN_WIDTH + 'px 的橫式照片',
    photos: credits,
  }, null, 2) + '\n', 'utf8');

  /* 產生共用的 hero.js：清單直接內嵌，頁面不必再 fetch，也能被 Service Worker 快取 */
  const list = credits.map((c) => ({
    file: c.file, caption: c.caption,
    author: c.author, license: c.license, sourceUrl: c.sourceUrl,
  }));

  const heroJs = `/* 由 scripts/fetch-hero-photos.js 產生，請勿手動編輯 */
/* 照片來源：Wikimedia Commons，皆為自由授權、近五年拍攝，作者與授權標示於頁首下方 */
(function (global) {
  'use strict';

  var PHOTOS = ${JSON.stringify(list, null, 2).split('\n').join('\n  ')};

  /* base 是 hero 圖片資料夾相對於目前頁面的路徑，例如 '../assets/hero/' */
  global.applyHero = function (base) {
    var host = document.querySelector('[data-hero]');
    if (!host || !PHOTOS.length) return;

    var pick = PHOTOS[Math.floor(Math.random() * PHOTOS.length)];

    var img = document.createElement('img');
    img.className = 'hero-img';
    img.alt = '';            // 純裝飾，讀螢幕軟體略過
    img.decoding = 'async';
    img.src = base + pick.file;
    // 圖還沒載完前先不顯示，避免閃一下未套用樣式的畫面
    img.addEventListener('load', function () { img.classList.add('is-loaded'); });

    var credit = document.createElement('a');
    credit.className = 'hero-credit';
    credit.href = pick.sourceUrl;
    credit.target = '_blank';
    credit.rel = 'noopener';
    credit.textContent = pick.caption + '｜' + pick.author + '／' + pick.license;

    host.insertBefore(img, host.firstChild);
    host.appendChild(credit);
  };

  global.HERO_PHOTOS = PHOTOS;
})(window);
`;

  fs.writeFileSync(path.join(OUT_DIR, 'hero.js'), heroJs, 'utf8');

  const total = credits.reduce((s, c) => s + c.bytes, 0);
  console.log('\n成功 ' + credits.length + ' 張，合計 ' + (total / 1024 / 1024).toFixed(1) + ' MB');
  console.log('已產生 credits.json 與 hero.js');
}

(process.argv.includes('--candidates') ? candidates() : download()).catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
