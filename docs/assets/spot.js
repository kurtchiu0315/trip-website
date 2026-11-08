/* 景點小地圖（兩趟旅行共用）：docs/<trip>/map/spot.html?id=<id>，讀同資料夾的 spots/<id>.json */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var id = (params.get('id') || '').replace(/[^a-z0-9-]/gi, '');
  if (params.get('embed') === '1') document.body.classList.add('embed');
  var mapEl = document.getElementById('map');

  function fail(msg) { mapEl.innerHTML = '<p class="msg">' + msg + '</p>'; }
  if (!id) { fail('缺少 ?id= 參數'); return; }
  if (typeof L === 'undefined') { fail('地圖元件載入失敗（可能沒有網路）'); return; }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  fetch('spots/' + id + '.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(draw)
    .catch(function () { fail('找不到這個景點的地圖資料'); });

  function draw(spot) {
    document.title = spot.title + '｜' + ((window.TRIP && window.TRIP.name) || '大阪・京都之旅');
    document.getElementById('title').textContent = spot.title + '（Day ' + spot.day + '）';
    document.getElementById('dayLink').href = '../final/index.html#day-' + spot.day;
    document.getElementById('mapLink').href = './index.html?day=' + spot.day;

    var map = L.map(mapEl, { scrollWheelZoom: !document.body.classList.contains('embed') });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors｜步行路徑 OSRM'
    }).addTo(map);

    var route = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#4A6FA5';
    var bounds = [];
    spot.legs.forEach(function (leg) {
      L.polyline(leg.coords, { color: route, weight: 4, opacity: 0.85, dashArray: '2 7', lineCap: 'round' })
        .bindTooltip('步行約 ' + leg.minutes + ' 分（' + leg.meters + ' m）', { sticky: true })
        .addTo(map);
      bounds = bounds.concat(leg.coords);
    });

    var last = spot.stops.length - 1;
    spot.stops.forEach(function (s, i) {
      var label = (i === 0 || i === last) ? (i === 0 ? '起' : '終') : String(i);
      var icon = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12],
        html: '<div class="stop-pin' + ((i === 0 || i === last) ? ' is-end' : '') + '">' + label + '</div>' });
      // Google Maps 查詢用日文名稱；執行時用 encodeURIComponent 產生，和 map/index.html 的彈窗寫法相同
      var gmaps = 'https://maps.google.com/maps?q=' + encodeURIComponent(s.ja || s.name);
      L.marker([s.lat, s.lon], { icon: icon, zIndexOffset: 500 }).addTo(map).bindPopup(
        '<div class="pop-time">' + esc(s.time || '') + '</div>'
        + '<div class="pop-name">' + esc(s.name) + '</div>'
        + (s.ja && s.ja !== s.name ? '<div class="pop-ja">' + esc(s.ja) + '</div>' : '')
        + (s.desc ? '<div class="pop-desc">' + esc(s.desc) + '</div>' : '')
        + '<a class="pop-link" href="' + gmaps + '" target="_blank" rel="noopener">在 Google Maps 開啟</a>');
      bounds.push([s.lat, s.lon]);
    });
    map.fitBounds(bounds, { padding: [24, 24] });

    /* 嵌在行程表卡片裡時，那一天還沒顯示前 iframe 的尺寸是 0，Leaflet 會算錯範圍。
       尺寸一改變（切到那一天、手機轉向）就重新量一次、把所有點框進畫面 */
    var lastSize = mapEl.clientWidth + 'x' + mapEl.clientHeight;
    window.addEventListener('resize', function () {
      var size = mapEl.clientWidth + 'x' + mapEl.clientHeight;
      if (size === lastSize || !mapEl.clientWidth || !mapEl.clientHeight) return;
      lastSize = size;
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [24, 24] });
    });

    if (spot.sunset) {
      var chip = document.createElement('div');
      chip.className = 'chip sunset';
      chip.textContent = '🌇 日落 ' + spot.sunset;
      mapEl.appendChild(chip);
    }
    var ex = document.createElement('a');
    ex.className = 'chip expand';
    ex.href = 'spot.html?id=' + encodeURIComponent(id);
    ex.target = '_blank';
    ex.rel = 'noopener';
    ex.textContent = '⤢ 放大';
    mapEl.appendChild(ex);
  }
})();
