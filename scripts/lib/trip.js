/* 多趟旅行：建置腳本要處理哪一趟。
 *
 *   node scripts/build-places.js --trip 2026-09
 *   node scripts/build-places.js               ← 沒寫 --trip 就是 DEFAULT（正在規劃的那一趟）
 *
 * 每一趟各自的檔案：
 *   docs/<id>/final/index.html   行程表（這趟唯一的事實來源）
 *   docs/<id>/map/               地圖資料：places.json、routes.json、spots/（由腳本產生）
 *   data/trips/<id>/             這趟的路線定義 routes.json、景點小地圖的停留點 spots/
 * 兩趟共用的：data/attractions.json、data/plan-coords.json、scripts/.cache/、docs/assets/
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT = '2026-11';

/* data/trips/ 底下有資料夾的就是一趟旅行 */
function list() {
  const dir = path.join(ROOT, 'data', 'trips');
  return fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}$/.test(d) && fs.statSync(path.join(dir, d)).isDirectory()).sort();
}

function paths(id) {
  return {
    id,
    root: ROOT,
    docs: path.join(ROOT, 'docs', id),
    data: path.join(ROOT, 'data', 'trips', id),
    itinerary: path.join(ROOT, 'docs', id, 'final', 'index.html'),
    mapDir: path.join(ROOT, 'docs', id, 'map'),
  };
}

/* 從命令列讀 --trip；argv 會拿掉 --trip 與它的值，剩下的照原本的方式解析 */
function resolve() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--trip');
  const id = i >= 0 ? argv[i + 1] : DEFAULT;
  if (i >= 0) argv.splice(i, 2);
  if (!id || !list().includes(id)) {
    console.error('✗ 找不到這趟旅行：' + id + '（data/trips/ 裡有：' + list().join('、') + '）');
    process.exit(1);
  }
  return Object.assign(paths(id), { argv });
}

module.exports = { ROOT, DEFAULT, list, paths, resolve };
