/* 景點小地圖：依 data/trips/<trip>/spots/<id>.json 的停留點，算出步行路線，寫入 docs/<trip>/map/spots/<id>.json。
 * 行程表的卡片用 iframe 嵌入 docs/<trip>/map/spot.html?id=<id> 顯示。
 *
 *   node scripts/build-spots.js                 # 正在規劃的那一趟，沿用快取
 *   node scripts/build-spots.js --trip 2026-09  # 指定哪一趟
 *   node scripts/build-spots.js --refresh       # 全部重算
 *
 * 步行路徑由 OSRM（routing.openstreetmap.de）計算；請求之間間隔 1 秒以上。
 * 步行距離比直線遠 3 倍以上時改畫直線（OSM 沒畫到的捷徑會讓 OSRM 繞一大圈，同 build-routes.js）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TRIP = require('./lib/trip').resolve();
const SRC_DIR = path.join(TRIP.data, 'spots');
const OUT_DIR = path.join(TRIP.mapDir, 'spots');
const CACHE_DIR = path.join(__dirname, '.cache');
const REFRESH = process.argv.includes('--refresh');
const UA = 'tokyo-trip/1.0 (personal travel itinerary map)';
const DETOUR_MAX = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* 相鄰點距離小於 4m 的點丟掉，座標四捨五入到小數 5 位（約 1m），檔案才不會太大 */
function thin(coords) {
  const out = [];
  for (const c of coords) {
    const p = [+c[0].toFixed(5), +c[1].toFixed(5)];
    if (!out.length || haversine(out[out.length - 1], p) >= 4) out.push(p);
  }
  const last = coords[coords.length - 1];
  const lp = [+last[0].toFixed(5), +last[1].toFixed(5)];
  if (out[out.length - 1][0] !== lp[0] || out[out.length - 1][1] !== lp[1]) out.push(lp);
  return out;
}

async function walk(a, b) {
  const key = crypto.createHash('md5').update(JSON.stringify([a, b])).digest('hex').slice(0, 12);
  const file = path.join(CACHE_DIR, 'spot-leg-' + key + '.json');
  if (!REFRESH && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));

  const url = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/'
    + a[1] + ',' + a[0] + ';' + b[1] + ',' + b[0] + '?overview=full&geometries=geojson';
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('OSRM HTTP ' + res.status);
  const j = await res.json();
  const r = j.routes && j.routes[0];
  if (!r) throw new Error('OSRM 沒有路線');
  const straight = haversine(a, b);
  let leg;
  if (r.distance > straight * DETOUR_MAX && straight > 50) {
    leg = { meters: Math.round(straight), minutes: Math.round(straight / 1.25 / 60), coords: [a, b], straight: true };
  } else {
    leg = { meters: Math.round(r.distance), minutes: Math.round(r.duration / 60),
      coords: thin(r.geometry.coordinates.map((c) => [c[1], c[0]])) };
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(leg));
  await sleep(1100);
  return leg;
}

(async () => {
  if (!fs.existsSync(SRC_DIR)) { console.log('這趟（' + TRIP.id + '）還沒有景點小地圖'); return; }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const spot = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
    const stops = spot.stops;
    stops.forEach((s, i) => {
      if (typeof s.lat !== 'number' || typeof s.lon !== 'number') throw new Error(f + ' 第 ' + (i + 1) + ' 個停留點沒有座標');
    });
    const legs = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const leg = await walk([stops[i].lat, stops[i].lon], [stops[i + 1].lat, stops[i + 1].lon]);
      legs.push(Object.assign({ from: i, to: i + 1 }, leg));
      console.log('  ' + stops[i].name + ' → ' + stops[i + 1].name + '：' + leg.meters + ' m，約 ' + leg.minutes + ' 分' + (leg.straight ? '（直線）' : ''));
    }
    const out = {
      id: spot.id, title: spot.title, day: spot.day, date: spot.date, sunset: spot.sunset,
      generatedAt: new Date().toISOString().slice(0, 10),
      attribution: '© OpenStreetMap contributors — 步行路徑由 OSRM 計算',
      stops: stops.map((s, i) => Object.assign({ n: i }, s)),
      legs,
    };
    fs.writeFileSync(path.join(OUT_DIR, spot.id + '.json'), JSON.stringify(out) + '\n');
    const total = legs.reduce((s, l) => s + l.meters, 0);
    console.log('✓ ' + spot.id + '：' + stops.length + ' 個停留點，步行共約 ' + (total / 1000).toFixed(1) + ' km');
  }
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
