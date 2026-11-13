/* 依交通方式產生地圖上的移動路線，寫入 docs/<trip>/map/routes.json（--trip 指定哪一趟，見 scripts/lib/trip.js）
 *
 * 為什麼需要這支腳本：
 *   地圖原本只把當天的地點依時間用直線連起來，看不出來是走路還是搭車；
 *   Day 1 關西機場 → 新今宮的直線還會橫跨大阪灣。2026-09-24 起**八天全部**改畫實際路線，
 *   不再有「隨意連線」（使用者要求）。
 *
 * 哪一段搭什麼車、在哪站上下車，寫在 data/trips/<trip>/routes.json；本腳本負責把它變成座標：
 *   - 鐵路／地鐵／公車：抓 OpenStreetMap 上該路線的 route relation，用它的軌道（公車是道路）建圖，
 *     在上下車站之間找最短路 —— 畫出來就是列車、公車實際走的路
 *   - 步行：OSRM 步行路徑（routing.openstreetmap.de）
 *   - 接送車（"mode": "car"）：OSRM 開車路徑，例如 2027-02 Day 1 機場接送小巴士；路線時間不含塞車
 *   - 起訖點與車站之間、轉乘的兩站之間，會自動補上步行
 *
 * routes.json 的寫法（依「行程表上的項目」定義，而不是依地點）：
 *   - 每一天是一串「區段」：from／to 是項目的時間（"09:00"），當天出發的飯店是 "start"
 *   - 彈性行程有好幾個方案，區段的 legs 是預設走法；某些方案走法不同時寫在 cases 裡
 *     （{ "from": ["B"], "to": ["C"], "legs": [...] }，由上往下第一個符合的生效）
 *   - 本腳本會把「前一站的每個方案 × 下一站的每個方案」都算一次，地圖上不管選哪個方案都有實際路線
 *   - 某個方案沒有地點（例如「在飯店休息」）時，地圖會跳過它，這時需要「跨過它」的區段，
 *     少了會直接報錯
 *   - 同一個項目裡有好幾個地點（例如奈良公園 → 東大寺 → 春日大社）時，中間一律步行
 *   - OSM 上只有一條 way、沒有 route relation 的路線（摩耶山的空中纜車）寫 "way": <id>；
 *     relation 的站序缺了某一站（神戶市巴士 18 系統沒列三宮）時，用 "stations": { "站名": [緯度, 經度] } 指定
 *
 * 用法：
 *   node scripts/build-routes.js            沿用已抓過的 relation 與已算過的步行路徑（存在 scripts/.cache/）
 *   node scripts/build-routes.js --refresh  全部重抓重算
 *
 * 請遵守公共服務的使用規範：OSM API、Overpass 與 OSRM 都是志工維運的免費服務，
 * 本腳本每次請求之間都有間隔、帶可識別的 User-Agent，並且會沿用上次的結果。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const TRIP = require('./lib/trip').resolve();
const ROOT = TRIP.root;
const DEF = path.join(TRIP.data, 'routes.json');
const PLACES = path.join(TRIP.mapDir, 'places.json');
const OUT = path.join(TRIP.mapDir, 'routes.json');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
/* 抓過的 OSM relation 與算過的步行路徑存在本機（不進版控），重跑時不必再打 API */
const CACHE_DIR = path.join(ROOT, 'scripts/.cache');
const REFRESH = process.argv.includes('--refresh');

const UA = 'tokyo-trip-map/1.0 (personal trip planner)';

/* relation 先用 OSM 主 API 抓（穩定），失敗才用 Overpass；Overpass 主站常常 504 */
const OSM_API = 'https://api.openstreetmap.org/api/0.6/relation/';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
const OSRM_CAR = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';

const MODES = ['walk', 'rail', 'subway', 'bus', 'car'];
/* 起訖點離車站超過這個距離才補畫步行，太短的畫出來只是一個點 */
const WALK_MIN_M = 120;
/* 步行路徑比直線遠這麼多就不採用。例如關西機場航廈與車站之間有室內連通道，
   OSM 的步行網路沒畫到，OSRM 會繞出 3.4 km 的怪路線；這種情況直接畫直線 */
const WALK_DETOUR_MAX = 3;
const WALK_SPEED = 1.25;   // m/s，約時速 4.5 km，退回直線時用來估時間
/* 走路超過這個距離就提醒：可能少寫了搭車的區段 */
const WALK_WARN_M = 2600;
/* 簡化折線的容許誤差（公尺）：縮小檔案，肉眼看不出差別 */
const SIMPLIFY_M = 8;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 幾何 ---------- */
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function dist(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Douglas–Peucker，距離用局部平面近似（路段不長，誤差可忽略） */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const lat0 = rad(pts[0][0]);
  const xy = pts.map((p) => [rad(p[1]) * Math.cos(lat0) * R, rad(p[0]) * R]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = xy[s];
    const [x2, y2] = xy[e];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1e-9;
    let far = -1, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const t = Math.max(0, Math.min(1, ((xy[i][0] - x1) * dx + (xy[i][1] - y1) * dy) / len2));
      const d = Math.hypot(xy[i][0] - (x1 + t * dx), xy[i][1] - (y1 + t * dy));
      if (d > far) { far = d; idx = i; }
    }
    if (far > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const round = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
const lengthOf = (pts) => pts.reduce((a, p, i) => (i ? a + dist(pts[i - 1], p) : 0), 0);
const hash = (x) => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);

/* ---------- 網路 ---------- */
function request(url, opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, Object.assign({ timeout: 150000 }, opts), (res) => {
      // 先收齊 Buffer 再解碼：一塊一塊轉字串會把切在中間的中日文字變成亂碼
      // （2026-11-05 四つ橋線 relation 的「西梅田」就這樣壞掉，站名比對不到）
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

async function overpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  let lastErr;
  for (const ep of OVERPASS) {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await request(ep, {
          method: 'POST',
          timeout: 120000,
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, body);
        if (r.status === 200) return JSON.parse(r.body);
        lastErr = new Error(ep + ' HTTP ' + r.status);
      } catch (e) {
        lastErr = new Error(ep + ' ' + e.message);
      }
      console.log('\n    ⟳ ' + lastErr.message + '，稍後重試');
      await sleep(15000 * (i + 1));
    }
  }
  throw lastErr;
}

/* OSM 主 API 的 relation/<id>/full 轉成和 Overpass「out geom」相同的格式 */
async function fetchRelationFromApi(id) {
  const r = await request(OSM_API + id + '/full.json', { headers: { 'User-Agent': UA } });
  if (r.status !== 200) throw new Error('OSM API relation ' + id + ' HTTP ' + r.status);
  const j = JSON.parse(r.body);
  const nodes = new Map(j.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));
  const ways = new Map(j.elements.filter((e) => e.type === 'way').map((w) => [w.id, w]));
  const rel = j.elements.find((e) => e.type === 'relation' && e.id === id);
  if (!rel) throw new Error('OSM 找不到 relation ' + id);
  const members = rel.members.map((m) => {
    if (m.type === 'way') {
      const w = ways.get(m.ref);
      return { type: 'way', ref: m.ref, role: m.role, geometry: w ? w.nodes.map((n) => ({ lat: nodes.get(n).lat, lon: nodes.get(n).lon })) : undefined };
    }
    if (m.type === 'node') { const n = nodes.get(m.ref); return { type: 'node', ref: m.ref, role: m.role, lat: n && n.lat, lon: n && n.lon }; }
    return { type: m.type, ref: m.ref, role: m.role };
  });
  const stopNodes = rel.members.filter((m) => m.type === 'node').map((m) => nodes.get(m.ref)).filter(Boolean)
    .map((n) => ({ type: 'node', id: n.id, lat: n.lat, lon: n.lon, tags: n.tags || {} }));
  return { version: 0.6, generator: 'OSM API relation/full', elements: [{ type: 'relation', id, members, tags: rel.tags }, ...stopNodes] };
}

/* ---------- 步行與接送車（OSRM），結果存在快取 ---------- */
async function osrmFoot(a, b) { return osrmRoute(a, b, 'walk'); }
async function osrmCar(a, b) { return osrmRoute(a, b, 'car'); }

async function osrmRoute(a, b, kind) {
  const key = hash([kind, round(a), round(b)]);
  const file = path.join(CACHE_DIR, kind + '-' + key + '.json');
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const url = (kind === 'car' ? OSRM_CAR : OSRM_FOOT) + a[1] + ',' + a[0] + ';' + b[1] + ',' + b[0] + '?overview=full&geometries=geojson';
  for (let i = 0; i < 4; i++) {
    try {
      await sleep(1100);   // 每秒至多 1 次
      const r = await request(url, { headers: { 'User-Agent': UA } });
      if (r.status === 200) {
        const j = JSON.parse(r.body);
        if (j.code === 'Ok' && j.routes && j.routes[0]) {
          const w = {
            coords: j.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]),
            meters: j.routes[0].distance,
            seconds: j.routes[0].duration,
          };
          fs.mkdirSync(CACHE_DIR, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(w));
          return w;
        }
      }
    } catch (e) { /* 重試 */ }
    await sleep(2000 * (i + 1));
  }
  throw new Error('OSRM ' + (kind === 'car' ? '開車' : '步行') + '路徑查詢失敗：' + a + ' → ' + b);
}

/* ---------- 鐵路、地鐵、公車：在路線的軌道（道路）上找路 ---------- */
const relCache = new Map();

async function loadRelation(id) {
  if (relCache.has(id)) return relCache.get(id);
  const file = path.join(CACHE_DIR, 'relation-' + id + '.json');
  let j;
  if (!REFRESH && fs.existsSync(file)) {
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    await sleep(1500);
    try {
      j = await fetchRelationFromApi(id);
    } catch (e) {
      console.log('\n    ⟳ ' + e.message + '，改用 Overpass');
      j = await overpass('[out:json][timeout:120];relation(' + id + ')->.r;.r out geom;node(r.r);out;');
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(j));
  }
  const rel = j.elements.find((e) => e.type === 'relation');
  if (!rel) throw new Error('OSM 找不到 relation ' + id);

  // 停靠站：有名字的 node 成員。班次 relation 的角色是 stop／platform（公車多半只有 platform），
  // 鐵道線路 relation（type=railway，例如京阪本線）的車站沒有角色
  const nodeById = new Map(j.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));
  const stops = rel.members
    .filter((m) => m.type === 'node' && (/stop|platform/.test(m.role) || m.role === ''))
    .map((m) => nodeById.get(m.ref))
    .filter((n) => n && n.tags && n.tags.name)
    .map((n) => ({ name: n.tags.name, at: [n.lat, n.lon] }));
  const ways = rel.members
    .filter((m) => m.type === 'way' && !/platform/.test(m.role) && m.geometry)
    .map((m) => m.geometry.map((g) => [g.lat, g.lon]));

  const data = { id, name: rel.tags.name, stops, ways, graph: null };
  relCache.set(id, data);
  return data;
}

/* 用軌道的 way 建無向圖；相鄰 way 若沒有共用節點（OSM 偶有小縫），30m 內自動接起來 */
function buildGraph(ways) {
  const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const coords = new Map();
  const adj = new Map();
  const link = (a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === kb) return;
    coords.set(ka, a); coords.set(kb, b);
    const w = dist(a, b);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push([kb, w]);
    adj.get(kb).push([ka, w]);
  };
  ways.forEach((w) => { for (let i = 1; i < w.length; i++) link(w[i - 1], w[i]); });

  const deg = new Map();
  ways.forEach((w) => [w[0], w[w.length - 1]].forEach((p) => {
    const k = key(p); deg.set(k, (adj.get(k) || []).length);
  }));
  const all = [...coords.entries()];
  for (const [k, d] of deg) {
    if (d > 1) continue;                       // 已經接上別的 way
    const p = coords.get(k);
    let best = null, bd = 30;
    for (const [k2, p2] of all) {
      if (k2 === k || (adj.get(k) || []).some((e) => e[0] === k2)) continue;
      const dd = dist(p, p2);
      if (dd < bd) { bd = dd; best = p2; }
    }
    if (best) link(p, best);
  }
  return { coords, adj, key };
}

function nearestNode(graph, p) {
  let best = null, bd = Infinity;
  for (const [k, c] of graph.coords) {
    const d = dist(p, c);
    if (d < bd) { bd = d; best = k; }
  }
  return { key: best, meters: bd };
}

function shortestPath(graph, from, to) {
  const d = new Map([[from, 0]]);
  const prev = new Map();
  const heap = [[0, from]];
  const push = (x) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [du, u] = pop();
    if (u === to) break;
    if (du > (d.get(u) ?? Infinity)) continue;
    for (const [v, w] of graph.adj.get(u) || []) {
      const nd = du + w;
      if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, u); push([nd, v]); }
    }
  }
  if (!d.has(to)) return null;
  const out = [];
  for (let u = to; u; u = prev.get(u)) out.push(graph.coords.get(u));
  return out.reverse();
}

/* 只有一條 way、沒有 route relation 的路線（例如摩耶山的空中纜車 aerialway=cable_car）：
   用 way 的形狀當軌道，車站座標寫在 routes.json 該段的 stations */
async function loadWay(id) {
  const key = 'way/' + id;
  if (relCache.has(key)) return relCache.get(key);
  const file = path.join(CACHE_DIR, 'way-' + id + '.json');
  let j;
  if (!REFRESH && fs.existsSync(file)) {
    j = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    await sleep(1500);
    const r = await request(OSM_API.replace('/relation/', '/way/') + id + '/full.json', { headers: { 'User-Agent': UA } });
    if (r.status !== 200) throw new Error('OSM API way ' + id + ' HTTP ' + r.status);
    j = JSON.parse(r.body);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(j));
  }
  const nodes = new Map(j.elements.filter((e) => e.type === 'node').map((n) => [n.id, n]));
  const way = j.elements.find((e) => e.type === 'way' && e.id === id);
  if (!way) throw new Error('OSM 找不到 way ' + id);
  const data = {
    id: key, name: (way.tags && way.tags.name) || 'way ' + id, stops: [],
    ways: [way.nodes.map((n) => [nodes.get(n).lat, nodes.get(n).lon])], graph: null,
  };
  relCache.set(key, data);
  return data;
}

/* 車站：routes.json 有寫 stations（{ "站名": [緯度, 經度] }）就用它 —— relation 的站序缺了某一站
   （例如神戶市巴士 18 系統沒有列三宮那一站）、或是只有 way 的路線時用 */
function findStop(rel, name, leg) {
  if (leg && leg.stations && leg.stations[name]) return { name, at: leg.stations[name] };
  const s = rel.stops.find((x) => x.name === name)
    || rel.stops.find((x) => x.name.replace(/駅$/, '') === name.replace(/駅$/, ''));
  if (!s) {
    throw new Error('relation ' + rel.id + '（' + rel.name + '）沒有「' + name + '」這一站。'
      + '可用的站：' + [...new Set(rel.stops.map((x) => x.name))].join('、'));
  }
  return s;
}

const transitCache = new Map();

async function transitLeg(leg) {
  const k = [leg.relation || 'way/' + leg.way, leg.board, leg.alight, JSON.stringify(leg.stations || {})].join('|');
  if (transitCache.has(k)) return transitCache.get(k);
  const rel = leg.way ? await loadWay(leg.way) : await loadRelation(leg.relation);
  const board = findStop(rel, leg.board, leg);
  const alight = findStop(rel, leg.alight, leg);
  if (!rel.graph) rel.graph = buildGraph(rel.ways);
  const g = rel.graph;
  const a = nearestNode(g, board.at);
  const b = nearestNode(g, alight.at);
  if (a.meters > 400 || b.meters > 400) {
    throw new Error(rel.name + '：車站離路線太遠（' + Math.round(a.meters) + 'm / '
      + Math.round(b.meters) + 'm），relation 資料可能不完整');
  }
  const p = shortestPath(g, a.key, b.key);
  if (!p) throw new Error(rel.name + '：' + leg.board + ' → ' + leg.alight + ' 之間的路線不連通');
  const out = { board: board.at, alight: alight.at, coords: p, meters: lengthOf(p), service: rel.name };
  transitCache.set(k, out);
  return out;
}

const walkLabel = (m, s) => '步行 約 ' + Math.max(1, Math.round(s / 60)) + ' 分鐘（' + (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m') + '）';

/* 一段移動：依 legs 的交通方式把 A 到 B 接起來；起訖點與車站之間自動補步行 */
async function buildLegs(defs, A, B, warn) {
  const legs = [];
  let cursor = [A.lat, A.lon];
  const end = [B.lat, B.lon];

  const walkTo = async (to) => {
    if (dist(cursor, to) < WALK_MIN_M) { cursor = to; return; }
    let w = await osrmFoot(cursor, to);
    const straight = dist(cursor, to);
    if (w.meters > Math.max(straight * WALK_DETOUR_MAX, straight + 800)) {
      w = { coords: [cursor, to], meters: straight, seconds: straight / WALK_SPEED };
    }
    if (w.meters > WALK_WARN_M) warn('步行 ' + (w.meters / 1000).toFixed(1) + ' km：' + A.query + ' → ' + B.query);
    legs.push({ mode: 'walk', label: walkLabel(w.meters, w.seconds), coords: w.coords, meters: w.meters });
    cursor = to;
  };

  for (const leg of defs) {
    if (leg.mode === 'walk') {
      await walkTo(end);
    } else if (leg.mode === 'car') {
      // 接送車直接開到下一站門口（OSRM 開車路徑），不補步行
      const c = await osrmCar(cursor, end);
      legs.push({
        mode: 'car',
        label: (leg.label || '接送車') + '｜約 ' + Math.round(c.seconds / 60) + ' 分鐘（' + (c.meters / 1000).toFixed(1) + ' km，OSRM 估算、不含塞車）',
        coords: c.coords, meters: c.meters,
      });
      cursor = end;
    } else if (MODES.includes(leg.mode)) {
      const r = await transitLeg(leg);
      await walkTo(r.board);
      legs.push({
        mode: leg.mode,
        label: (leg.label || r.service) + '｜' + leg.board + ' → ' + leg.alight,
        from: leg.board, to: leg.alight,
        coords: r.coords,
        meters: r.meters,
      });
      cursor = r.alight;
    } else {
      throw new Error('不支援的交通方式：' + leg.mode + '（可用：' + MODES.join('、') + '）');
    }
  }
  await walkTo(end);

  return legs.map((l) => Object.assign(l, {
    coords: simplify(l.coords, SIMPLIFY_M).map(round),
    meters: Math.round(l.meters),
  }));
}

/* ---------- 當天的項目：行程表上的每一張卡片（有地點的），彈性行程帶全部方案 ---------- */
function dayItems(data, day) {
  const items = [];
  const byOrder = new Map();
  for (const p of data.places) {
    if (p.day !== day || !p.time || p.lat == null || p.slot) continue;
    const key = p.start ? 'start' : p.time;
    const id = p.start ? 'start' : 'o' + p.order;
    if (!byOrder.has(id)) {
      const it = { key, time: p.time, start: !!p.start, order: p.order, who: p.who, variants: [{ k: null, pts: [] }] };
      byOrder.set(id, it);
      items.push(it);
    }
    byOrder.get(id).variants[0].pts.push(p);
  }
  for (const s of data.slots || []) {
    if (s.day !== day) continue;
    items.push({
      key: s.time, time: s.time, start: false, order: s.order, slot: s.id, who: s.who,
      variants: s.plans.map((pl) => ({ k: pl.k, pts: pl.pts.filter((pt) => pt.lat != null) })),
    });
  }
  items.sort((a, b) => (a.start === b.start ? 0 : (a.start ? -1 : 1)) || a.time.localeCompare(b.time) || a.order - b.order);
  return items;
}

/* 分頭行動（行程表的 .split）：家人、獨旅各自一條線。共同的項目＋那一條線的項目依時間排成一串，
   兩串各自相連；共同的部分兩串都會走到，addSeg 會去掉重複的。沒有分頭行動的天就是一串 */
function daySequences(items, day) {
  const lanes = [...new Set(items.filter((it) => it.who).map((it) => it.who))];
  const seqs = lanes.length
    ? lanes.map((lane) => ({ lane, items: items.filter((it) => !it.who || it.who === lane) }))
    : [{ lane: null, items }];
  for (const q of seqs) {
    const keys = q.items.map((it) => it.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) throw new Error('Day ' + day + (q.lane ? '（' + q.lane + '）' : '') + ' 有兩個項目的時間都是 ' + dup + '，routes.json 分不出來');
  }
  return seqs;
}

/* 區段定義：分頭行動時，兩條線有同一個時間的話用 "who" 區分；先找寫了這條線的，再找沒寫 who 的 */
function findGap(gaps, from, to, lane) {
  return gaps.find((g) => g.from === from && g.to === to && lane && g.who === lane)
    || gaps.find((g) => g.from === from && g.to === to && !g.who);
}

/* 挑出這一組方案要用的走法：cases 由上往下第一個符合的生效，都不符合就用預設 legs */
function pickLegs(def, fromK, toK) {
  for (const c of def.cases || []) {
    const okFrom = !c.from || [].concat(c.from).includes(fromK);
    const okTo = !c.to || [].concat(c.to).includes(toK);
    if (okFrom && okTo) { c._used = true; return c.legs; }
  }
  def._usedDefault = true;
  return def.legs;
}

(async () => {
  const def = JSON.parse(fs.readFileSync(DEF, 'utf8'));
  const data = JSON.parse(fs.readFileSync(PLACES, 'utf8'));

  const legsOut = {};           // 路段：同一段車、同一段步行只存一次
  const days = {};
  const errors = [];
  const warnings = new Set();
  let segCount = 0;

  const allDays = [...new Set(data.places.map((p) => p.day))].sort((a, b) => a - b);
  for (const day of allDays) {
    const items = dayItems(data, day);
    const pointCount = items.length;
    if (pointCount < 2) continue;
    const gaps = def.days[String(day)];
    if (!gaps) { errors.push('Day ' + day + ' 沒有路線定義（八天都要定義，地圖不再畫直線）'); continue; }
    days[day] = [];
    const seen = new Map();
    process.stdout.write('Day ' + day + ' ');

    const addSeg = async (from, to, legDefs, ctx) => {
      if (from.lat === to.lat && from.lon === to.lon) return;
      const pair = from.query + ' → ' + to.query;
      const sig = JSON.stringify(legDefs);
      if (seen.has(pair)) {
        if (seen.get(pair) !== sig) warnings.add('Day ' + day + ' 同一對地點有兩種走法（' + ctx + '）：' + pair);
        return;
      }
      seen.set(pair, sig);
      const legs = await buildLegs(legDefs, from, to, (w) => warnings.add('Day ' + day + ' ' + w + '（' + ctx + '）'));
      const ids = legs.map((l) => {
        const id = 'L' + hash([l.mode, l.label, l.coords]);
        legsOut[id] = l;
        return id;
      });
      days[day].push({ from: from.query, to: to.query, legs: ids });
      segCount++;
      process.stdout.write('.');
    };

    for (const { lane, items: seq } of daySequences(items, day)) for (let i = 0; i < seq.length; i++) {
      const I = seq[i];
      // 同一個方案裡的好幾個地點：依序步行
      for (const v of I.variants) {
        for (let k = 1; k < v.pts.length; k++) await addSeg(v.pts[k - 1], v.pts[k], [{ mode: 'walk' }], I.key + ' 同一項目內');
      }
      // 和後面的項目相連：下一個項目；若中間的彈性行程選了「沒有地點」的方案，也要能跨過去
      for (let j = i + 1; j < seq.length; j++) {
        const J = seq[j];
        const gap = findGap(gaps, I.key, J.key, lane);
        const needed = I.variants.some((v) => v.pts.length) && J.variants.some((v) => v.pts.length);
        if (needed) {
          if (!gap) {
            const missing = '{ "from": "' + I.key + '", "to": "' + J.key + '"' + (lane && (I.who || J.who) ? ', "who": "' + lane + '"' : '') + ' }';
            if (!errors.some((e) => e.includes(missing))) errors.push('Day ' + day + ' 缺少區段定義：' + missing
              + (j > i + 1 ? '（中間的彈性行程選了沒有地點的方案時會用到）' : ''));
          } else {
            gap._used = true;
            for (const vi of I.variants) {
              if (!vi.pts.length) continue;
              for (const vj of J.variants) {
                if (!vj.pts.length) continue;
                const legDefs = pickLegs(gap, vi.k, vj.k);
                await addSeg(vi.pts[vi.pts.length - 1], vj.pts[0], legDefs,
                  I.key + (vi.k ? vi.k : '') + ' → ' + J.key + (vj.k ? vj.k : ''));
              }
            }
          }
        }
        // 只有「可以選沒有地點的方案」的彈性行程能被跨過；沒有方案的彈性卡（例如「下午待排」）沒有地點，也跨過
        if (J.variants.length && !J.variants.some((v) => !v.pts.length)) break;
      }
    }
    for (const g of gaps) {
      if (!g._used) warnings.add('Day ' + day + ' 的區段定義沒被用到（時間可能改了）：' + g.from + ' → ' + g.to);
      for (const c of g.cases || []) if (!c._used) warnings.add('Day ' + day + ' ' + g.from + ' → ' + g.to + ' 有一個 case 沒被用到：' + JSON.stringify({ from: c.from, to: c.to }));
    }
    console.log(' ' + days[day].length + ' 段');
  }

  [...warnings].forEach((w) => console.log('  ⚠ ' + w));
  if (errors.length) {
    console.error('\n✗ ' + rel(DEF) + ' 需要補：\n  ' + errors.join('\n  '));
    process.exit(1);
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString().slice(0, 10),
    source: rel(DEF),
    attribution: '© OpenStreetMap contributors — 鐵路、地鐵、公車的路線取自 OSM route relation，步行路徑由 OSRM 計算',
    legs: legsOut,
    days,
  }) + '\n', 'utf8');

  const size = fs.statSync(OUT).size;
  console.log('\n路線：' + segCount + ' 段、' + Object.keys(legsOut).length + ' 個路段，'
    + (size / 1024).toFixed(0) + ' KB，已寫入 ' + rel(OUT));
})().catch((e) => {
  console.error('\n✗ ' + e.message);
  process.exit(1);
});
