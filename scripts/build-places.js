#!/usr/bin/env node
/*
 * 從 docs/<trip>/final/index.html 擷取行程地點，用 OpenStreetMap Nominatim 查經緯度，
 * 產生 docs/<trip>/map/places.json 供地圖頁使用。
 *
 *   node scripts/build-places.js                 正在規劃的那一趟（scripts/lib/trip.js 的 DEFAULT）
 *   node scripts/build-places.js --trip 2026-09  指定哪一趟
 *
 * 行程表是唯一事實來源；改完行程重跑本腳本即可同步地圖。
 * 已查過的座標會沿用 places.json 舊值（除非加 --refresh），避免重複打 Nominatim；
 * 其他趟的 places.json 也會拿來當快取 —— 同一個地點兩趟都去，不必再查一次。
 *
 * Nominatim 使用規範：每秒至多 1 次請求、必須帶可識別的 User-Agent。
 * https://operations.osmfoundation.org/policies/nominatim/
 */

const fs = require('fs');
const path = require('path');

const TRIPS = require('./lib/trip');
const TRIP = TRIPS.resolve();
const SRC = TRIP.itinerary;
const RECO_SRC = path.join(TRIP.root, 'data', 'attractions.json');
const OUT = path.join(TRIP.mapDir, 'places.json');
const rel = (p) => path.relative(TRIP.root, p).replace(/\\/g, '/');
const REFRESH = process.argv.includes('--refresh');
const UA = 'tokyo-trip/1.0 (personal travel itinerary map)';

/* Nominatim 對少數地點解析不佳，這裡指定更精確的查法 */
/* 門牌級座標：Nominatim 對日本地址只查得到「丁目」的中心，步行路線會差一兩百公尺。
 * 這裡的座標來自國土地理院「地址檢索」（https://msearch.gsi.go.jp/address-search/AddressSearch?q=地址），
 * 優先於 QUERY_OVERRIDE 與快取 */
// 2026-11-07 東京這趟的門牌座標（來源：國土地理院地址檢索，key 是 map-link ?q= 的內容）
const FIXED_COORDS = {
  // 豪徳寺（寺）：Nominatim 查「豪徳寺」會落到小田急豪徳寺駅旁的「豪徳寺一丁目」，離寺 15 分；寺的地址 世田谷区豪徳寺2-24-7，用國土地理院門牌座標（2026-11-09）
  '豪徳寺': {
    lat: 35.647671, lon: 139.647202,
    osm: '東京都世田谷区豪徳寺二丁目２４番７号（國土地理院 地址檢索）',
    geocodedQuery: 'GSI 東京都世田谷区豪徳寺2-24-7',
  },
  // 小田急 豪徳寺駅：用小田急線 relation 9483158 的停靠點 node 6793703209
  '豪徳寺駅': {
    lat: 35.6534875, lon: 139.6468687,
    osm: '小田急小田原線 豪徳寺（OpenStreetMap node 6793703209）',
    geocodedQuery: 'OSM 小田急線 豪徳寺',
  },
  // 東池袋民宿（使用者 2026-11-09 提供地址），國土地理院地址檢索
  '東京都豊島区東池袋3-11-3': {
    lat: 35.731876, lon: 139.718689,
    osm: '東京都豊島区東池袋三丁目１１番３号（國土地理院 地址檢索）',
    geocodedQuery: 'GSI 東京都豊島区東池袋3-11-3',
  },
  '東横INN富士河口湖大橋': { lat: 35.504341, lon: 138.760208, osm: '國土地理院地址檢索 船津294（2026-11-07）', geocodedQuery: 'GSI 山梨県南都留郡富士河口湖町船津294' },
  '富士五湖汽船 船津浜乗り場': { lat: 35.503071, lon: 138.767746, osm: '國土地理院地址檢索 船津4034（2026-11-07）', geocodedQuery: 'GSI 山梨県南都留郡富士河口湖町船津4034' },
  '東京都台東区千束3-17-4': { lat: 35.721958, lon: 139.791306, osm: '國土地理院地址檢索（2026-11-07）', geocodedQuery: 'GSI 東京都台東区千束3-17-4' },
  '牛たんの檸檬 新宿総本店': { lat: 35.696178, lon: 139.697968, osm: '國土地理院地址檢索 西新宿7-16-12（2026-11-07）', geocodedQuery: 'GSI 東京都新宿区西新宿7-16-12' },
  '浅草 牛かつ': { lat: 35.710827, lon: 139.795898, osm: '國土地理院地址檢索 雷門2-17-10（2026-11-07）', geocodedQuery: 'GSI 東京都台東区雷門2-17-10' },
};

/* 彈性行程各方案（B～E，以及沒有 map-link 的方案 A）的地點座標。
 * 店家座標取食べログ地圖頁，景點與車站用 Nominatim 查過再逐一核對；見 data/plan-coords.json */
const PLAN_COORDS = path.join(TRIP.root, 'data', 'plan-coords.json');

/* 2026-11-07 東京這趟：Nominatim 查名稱會落到別處的地點 */
const QUERY_OVERRIDE = {
  '今戸神社': '今戸神社 台東区', // 不加台東区會落到群馬
  '高尾山 山頂': '高尾山',
};

const strip = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const MAP_LINK = /<a class="map-link" href="https:\/\/maps\.google\.com\/maps\?q=([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const toQuery = (q) => decodeURIComponent(q).replace(/\+/g, ' ');

/* 彈性行程的所有方案：地圖上可以切換要看哪一個方案。
 * 方案 A 的地點以卡片本身的 map-link 為準（和 places 裡的行程地點一致），
 * B～E（以及沒有 map-link 的方案 A）取方案小卡 .plan-ref 裡的 .pr-map */
function extractSlot(item, base) {
  const itemLinks = [...item.matchAll(MAP_LINK)].map((m) => ({ label: strip(m[2]), query: toQuery(m[1]) }));
  const track = item.split('<div class="plans-track">')[1] || '';
  const blocks = track.split(/(?=<div class="plan[ "][^>]*data-i=")/).slice(1);
  const plans = blocks.map((b) => {
    const k = 'ABCDE'[+((b.match(/data-i="(\d)"/) || [])[1] || 0)];
    const titleRaw = (b.match(/<span class="plan-title" hidden>([\s\S]*?)<\/span><div class="plan-head">/) || [])[1] || '';
    let pts = [...b.matchAll(/<div class="pr-name">([\s\S]*?)<\/div>[\s\S]*?<a class="pr-map" href="https:\/\/maps\.google\.com\/maps\?q=([^"]+)"/g)]
      .map((m) => ({ label: strip(m[1]), query: toQuery(m[2]) }));
    if (k === 'A' && itemLinks.length) pts = itemLinks;
    return {
      k,
      icon: (b.match(/data-icon="([^"]*)"/) || [])[1] || '',
      title: strip(titleRaw.replace(/<span class="ja-name">[\s\S]*?<\/span>/, '')),
      head: strip((b.match(/<div class="plan-head">([\s\S]*?)<\/div>/) || [])[1] || '').replace(/^[A-E]/, ''),
      pts,
    };
  });
  return Object.assign(base, { plans });
}

function extract() {
  const html = fs.readFileSync(SRC, 'utf8');
  const places = [];
  const slots = [];
  let order = 0;       // 行程表上的先後順序，地圖同一時間的地點依此排序
  let hotel = null;    // 前一晚住的飯店（最近一張「入住｜」卡片）

  const sections = html.split(/<section class="day-section[^"]*" id="day-/).slice(1);

  for (const sec of sections) {
    const day = parseInt(sec, 10);
    const date = (sec.match(/data-date="([^"]+)"/) || [])[1] || '';
    const seen = new Set();

    // --- 時間軸項目 ---
    const items = sec.split(/<div class="timeline-item/).slice(1);

    /* 分頭行動（2026-11-05 起）：.lane（data-who="family"／"solo"）裡的項目屬於那一條線，
       地點帶上 who，地圖與 build-routes.js 才分得出兩條線。.lane 的結尾一定要有 <!-- /lane --> 標記
       （見 templates/itinerary-snippets.html），字串解析分不出巢狀的 </div> */
    const lanes = [];
    for (const m of sec.matchAll(/<div class="lane" data-who="(\w+)"/g)) {
      const end = sec.indexOf('<!-- /lane -->', m.index);
      const next = sec.indexOf('<div class="lane" data-who=', m.index + 1);
      if (end < 0 || (next >= 0 && next < end)) throw new Error('Day ' + day + ' 的 .lane（' + m[1] + '）沒有 <!-- /lane --> 結尾標記');
      lanes.push({ who: m[1], start: m.index, end });
    }
    const itemPos = [...sec.matchAll(/<div class="timeline-item/g)].map((m) => m.index);
    const whoOf = (i) => { const l = lanes.find((x) => itemPos[i] > x.start && itemPos[i] < x.end); return l ? l.who : undefined; };

    /* 第 2 天起，每天都從前一晚住的飯店出發，地圖上標 0。
       當天第一張卡片就是「從飯店出發」的交通或退房時，順便標出發時間 */
    if (hotel) {
      const first = items[0] || '';
      const firstTime = strip((first.match(/<span class="tl-time">([^<]*)<\/span>/) || [])[1] || '');
      const firstTitle = strip((first.match(/<span class="tl-title">([\s\S]*?)<\/span>/) || [])[1] || '');
      const leaves = /^[^>]*\bis-move\b/.test(first) || /退房/.test(firstTitle);
      places.push({
        day, date, time: firstTime, start: true, startTime: leaves ? firstTime : '',
        icon: '🏨', title: '出發｜' + hotel.name, ja: '', label: hotel.name,
        tag: '', kind: 'start', note: '前一晚住的飯店', query: hotel.query, order: order++,
      });
    }

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx].split('<div class="day-maps')[0];
      const who = whoOf(idx);
      const isTransport = /^[^>]*\btransport\b/.test(item);

      // 標題後面可能接 .tl-tag／.tl-kind／.tl-plan，或直接收尾；
      // 少列一個就會把那個 span 的文字吃進標題裡
      const titleRaw = (item.match(/<span class="tl-title">([\s\S]*?)<\/span>\s*(?:<span class="tl-(?:tag|kind|plan)|<\/div>)/) || [])[1] || '';
      const ja = strip((titleRaw.match(/<span class="ja-name">([\s\S]*?)<\/span>/) || [])[1] || '');
      const title = strip(titleRaw.replace(/<span class="ja-name">[\s\S]*?<\/span>/, ''));

      const tagMatch = item.match(/<span class="tl-tag([^"]*)">([^<]*)<\/span>/);
      // 交通項目沒有 .tl-tag（那會和 .tl-kind 的「交通」重複顯示），改用分類標籤當後備
      const kindMatch = item.match(/<span class="tl-kind[^"]*">([^<]*)<\/span>/);
      const tag = tagMatch ? tagMatch[2].trim() : (kindMatch ? kindMatch[1].trim() : '');
      const isFixed = tagMatch ? /\bfixed\b/.test(tagMatch[1]) : false;

      const time = strip((item.match(/<span class="tl-time">([^<]*)<\/span>/) || [])[1] || '');
      const icon = strip((item.match(/<span class="tl-icon">([^<]*)<\/span>/) || [])[1] || '');
      const note = [...item.matchAll(/<p class="tl-note">([\s\S]*?)<\/p>/g)].map((m) => strip(m[1])).join(' ／ ');

      // 彈性行程：places 裡放方案 A 的地點，slots 裡放全部方案
      const isFlex = /^[^>]*\bis-flex\b/.test(item);
      const slot = isFlex ? 'd' + day + '-' + time.replace(':', '') : undefined;
      const itemOrder = order++;

      for (const m of item.matchAll(MAP_LINK)) {
        const query = toQuery(m[1]);
        seen.add(query);
        places.push({
          day, date, time, icon, title, ja,
          label: strip(m[2]),
          tag,
          kind: isTransport ? 'transport' : (isFixed ? 'fixed' : 'spot'),
          note, query, order: itemOrder, slot,
        });
        if (who) places[places.length - 1].who = who;
        if (/^入住｜/.test(title)) hotel = { name: title.replace(/^入住｜/, ''), query };
      }
      if (isFlex) slots.push(extractSlot(item, Object.assign({ id: slot, day, date, time, order: itemOrder }, who ? { who } : {})));
    }

    // --- 只出現在「今日相關地圖」的地點 ---
    const dayMaps = sec.split('<div class="day-maps')[1] || '';
    for (const m of dayMaps.matchAll(/<a class="map-chip" href="https:\/\/maps\.google\.com\/maps\?q=([^"]+)"[^>]*>([^<]*)<\/a>/g)) {
      const query = decodeURIComponent(m[1]).replace(/\+/g, ' ');
      if (seen.has(query)) continue;
      seen.add(query);
      const text = strip(m[2]);
      places.push({
        day, date, time: '', icon: text.slice(0, 2).trim(), title: text, ja: '',
        label: text.replace(/^\S+\s*/, ''), tag: '', kind: 'spot', note: '', query, order: order++,
      });
    }
  }

  return { places, slots };
}

/* 繁體漢字 → 日文新字體。OSM 的日本資料用日文漢字，
   「有馬溫泉」查不到但「有馬温泉」查得到。 */
const ZH_TO_JA = {
  '溫': '温', '戶': '戸', '區': '区', '縣': '県', '觀': '観', '國': '国',
  '學': '学', '灣': '湾', '醫': '医', '藝': '芸', '櫻': '桜', '舊': '旧',
  '寶': '宝', '鐵': '鉄', '驛': '駅', '澤': '沢', '濱': '浜', '缽': '鉢',
  '龍': '竜', '藥': '薬', '橫': '横', '嶽': '岳', '團': '団', '廣': '広',
  '劍': '剣', '萬': '万', '歷': '歴', '澀': '渋', '祕': '秘', '眾': '衆',
};

const toJaKanji = (s) => s.replace(/[一-鿿]/g, (c) => ZH_TO_JA[c] || c);

/* 產生由精確到寬鬆的候選查詢字串 */
function queryVariants(query) {
  const out = [];
  const push = (s) => { s = (s || '').trim(); if (s && out.indexOf(s) === -1) out.push(s); };

  push(query);
  push(toJaKanji(query));

  // 去掉括號內的補充說明：「銀閣寺（慈照寺） 京都」→「銀閣寺 京都」
  const noParen = query.replace(/[（(][^）)]*[）)]/g, ' ').replace(/\s+/g, ' ');
  push(noParen);
  push(toJaKanji(noParen));

  // 取括號內的名稱：「美國村（アメリカ村） 大阪」→「アメリカ村 大阪」
  const inner = query.match(/[（(]([^）)]+)[）)]/);
  if (inner) {
    const tail = query.replace(/^.*[）)]/, '').trim();
    push((inner[1] + ' ' + tail).trim());
  }

  // 「新世界・通天閣 大阪」→ 取「・」後段
  if (query.indexOf('・') !== -1) {
    const parts = query.split(' ')[0].split('・');
    const tail = query.split(' ').slice(1).join(' ');
    parts.forEach((p) => { push((p + ' ' + tail).trim()); push(toJaKanji((p + ' ' + tail).trim())); });
  }

  return out;
}

async function geocodeOnce(q) {
  const url = 'https://nominatim.openstreetmap.org/search'
    + '?format=jsonv2&limit=1&countrycodes=jp&accept-language=ja'
    + '&q=' + encodeURIComponent(q);

  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const hits = await res.json();
  if (!hits.length) return null;
  return {
    lat: +(+hits[0].lat).toFixed(6),
    lon: +(+hits[0].lon).toFixed(6),
    osm: hits[0].display_name,
    geocodedQuery: q,
  };
}

async function geocode(query) {
  // 有手動指定就只用指定的，不再試其他變體
  if (QUERY_OVERRIDE[query]) return geocodeOnce(QUERY_OVERRIDE[query]);

  const variants = queryVariants(query);
  for (let i = 0; i < variants.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100)); // 每次請求都要守速率
    const hit = await geocodeOnce(variants[i]);
    if (hit) return hit;
  }
  return null;
}

/* 推薦景點：來自 data/attractions.json，與行程表地點分開呈現 */
function extractRecommended() {
  if (!fs.existsSync(RECO_SRC)) return [];
  const json = JSON.parse(fs.readFileSync(RECO_SRC, 'utf8'));
  return (json.attractions || []).map((a) => ({
    id: a.id,
    name: a.name,
    city: a.city,
    category: a.category || a.area || '',
    features: a.features || '',
    price: a.price || '',
    duration: a.duration || '',
    hours: a.hours || '',
    transport: a.transport || '',
    link: a.link || '',
    tags: a.tags || [],
    // 加上城市可大幅提高 Nominatim 命中率（「清水寺」全日本不只一間）
    query: a.name + ' ' + a.city,
  }));
}

(async () => {
  const { places, slots } = extract();
  const recommended = extractRecommended();
  const planPts = [].concat(...slots.map((s) => [].concat(...s.plans.map((p) => p.pts))));
  const planCoords = fs.existsSync(PLAN_COORDS) ? JSON.parse(fs.readFileSync(PLAN_COORDS, 'utf8')).coords || {} : {};
  console.log('行程表地點 ' + places.length + ' 個，彈性行程 ' + slots.length + ' 組（方案地點 ' + planPts.length
    + ' 個），推薦景點 ' + recommended.length + ' 個\n');

  // 沿用既有座標，避免重複請求：先讀其他趟、最後讀這一趟（這一趟的值優先）
  let cache = {};
  const prevFiles = TRIPS.list().filter((id) => id !== TRIP.id)
    .map((id) => path.join(TRIPS.paths(id).mapDir, 'places.json')).concat(OUT);
  for (const file of REFRESH ? [] : prevFiles.filter((f) => fs.existsSync(f))) {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    const prevPts = [].concat(...(prev.slots || []).map((s) => [].concat(...s.plans.map((p) => p.pts))));
    for (const p of (prev.places || []).concat(prev.recommended || [], prevPts)) {
      if (p.lat != null) cache[p.query] = { lat: p.lat, lon: p.lon, osm: p.osm, geocodedQuery: p.geocodedQuery };
    }
    // 上次查不到的也記下來，不要每次重試（別趟查到過座標的不要蓋掉）
    for (const q of prev.unresolved || []) if (!cache[q]) cache[q] = null;
  }

  const all = places.concat(recommended, planPts);
  const uniq = [...new Set(all.map((p) => p.query))];
  const coords = {};
  const unresolved = [];
  let hit = 0, miss = 0, cached = 0;

  for (const q of uniq) {
    if (FIXED_COORDS[q]) { coords[q] = FIXED_COORDS[q]; cached++; continue; }
    if (planCoords[q]) {
      const c = planCoords[q];
      coords[q] = { lat: c.lat, lon: c.lon, osm: c.src, geocodedQuery: 'data/plan-coords.json' };
      cached++;
      continue;
    }
    // QUERY_OVERRIDE 改過的地點，舊座標是用舊查詢字串查的，要重查
    // 上次查不到（null）的，加了 override 之後也要重查
    if (QUERY_OVERRIDE[q] && (cache[q] === null || (cache[q] && cache[q].geocodedQuery !== QUERY_OVERRIDE[q]))) delete cache[q];
    if (Object.prototype.hasOwnProperty.call(cache, q)) {
      cached++;
      if (cache[q]) coords[q] = cache[q]; else unresolved.push(q);
      continue;
    }
    try {
      await new Promise((r) => setTimeout(r, 1100)); // 遵守 Nominatim 每秒 1 次
      const c = await geocode(q);
      if (c) {
        coords[q] = c; hit++; console.log('  ✓ ' + q + '  →  ' + c.lat + ', ' + c.lon);
        // 方案地點多半是店家；Nominatim 查店名常常查錯，提醒改填食べログ座標
        if (planPts.some((p) => p.query === q) && !places.some((p) => p.query === q)) {
          console.log('    ⚠ 這是彈性方案的地點，請確認座標；店家請改填 data/plan-coords.json（食べログ地圖頁）');
        }
      }
      else { miss++; unresolved.push(q); console.log('  ✗ 查無座標  ' + q); }
    } catch (e) {
      miss++;
      unresolved.push(q);
      console.log('  ✗ ' + q + '  (' + e.message + ')');
    }
  }

  for (const p of all) Object.assign(p, coords[p.query] || {});

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    source: rel(SRC),
    recommendedSource: rel(RECO_SRC),
    attribution: '© OpenStreetMap contributors — 座標由 Nominatim 查詢',
    places,
    slots,
    recommended: recommended.filter((r) => r.lat != null),
    unresolved,
  }, null, 2) + '\n', 'utf8');

  console.log('\n新查 ' + hit + ' / 沿用快取 ' + cached + ' / 查無座標 ' + miss);
  const noPts = planPts.filter((p) => p.lat == null);
  if (noPts.length) console.log('⚠ 彈性方案地點沒有座標：' + noPts.map((p) => p.query).join('、'));
  console.log('行程表地點 ' + places.filter((p) => p.lat != null).length + '/' + places.length
            + '，推薦景點 ' + recommended.filter((r) => r.lat != null).length + '/' + recommended.length);
  console.log('已寫入 ' + rel(OUT));

  /* 地點座標變了，依交通方式畫的路線也要跟著重算（沒變的路段會沿用，不會重打 API） */
  console.log('\n— 更新移動路線 —');
  const r = require('child_process').spawnSync(process.execPath,
    [path.join(__dirname, 'build-routes.js'), '--trip', TRIP.id].concat(REFRESH ? ['--refresh'] : []),
    { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log('⚠ 路線沒有更新成功（places.json 已寫入）。可稍後單獨執行 node scripts/build-routes.js --trip ' + TRIP.id);
  }
})();
