/* 行程地圖（兩趟旅行共用）。
 * 頁面 docs/<trip>/map/index.html 先載入 ../trip.js（這趟的設定），再載入本檔；
 * 資料讀同一個資料夾的 places.json、routes.json（由 scripts/build-places.js、build-routes.js 產生）
 */
(function () {
  'use strict';

  /* 這趟旅行的 localStorage key（見 ../trip.js）：兩趟的方案選擇、看過的位置分開存 */
  var K = (window.TRIP && window.TRIP.key) || function (k) { return k; };

  var CATS = {
    spot:      { label: '景點',   icon: '📍', color: 'var(--c-spot)' },
    food:      { label: '美食',   icon: '🍽️', color: 'var(--c-food)' },
    transport: { label: '交通',   icon: '🚇', color: 'var(--c-transport)' },
    hotel:     { label: '住宿',   icon: '🏨', color: 'var(--c-hotel)' },
    fixed:     { label: '已預約', icon: '⭐', color: 'var(--c-fixed)' },
  };

  /* 機場＝旅程的起訖點；當天最早的點若是機場（或前一晚的飯店），編號從 0 起算代表「抵達／出發點」 */
  function isGateway(p) {
    return /機場|空港|airport/i.test((p.label || '') + ' ' + (p.title || '') + ' ' + (p.query || ''));
  }

  /* 依行程表的分類與標題判斷屬於哪一類 */
  function categorize(p) {
    if (p.start) return 'hotel';
    if (p.kind === 'fixed') return 'fixed';
    if (/入住|飯店|退房/.test(p.title)) return 'hotel';
    if (p.kind === 'transport' || /駅|車站|機場|空港|步行｜|交通｜/.test(p.title)) return 'transport';
    if (/早餐|午餐|晚餐|宵夜|美食|市場/.test(p.title)) return 'food';
    return 'spot';
  }

  var map, layer, recoLayer, altLayer, routeLayer, stationLayer, meMarker, flexCtlEl, homeCtlEl, legendCtlEl;
  var routes = {};      // 同資料夾的 routes.json：每天每一對相鄰地點依交通方式算好的路線
  var routeLegs = {};   // routes.json 的路段（同一段車、同一段步行只存一次）
  var homeBounds = null; // 這一天（目前選的方案）全部地點與路線的範圍，「回到全觀」就是回到這裡
  var places = [];       // 行程表上的地點（彈性行程只含方案 A）
  var slots = [];        // 彈性行程的全部方案（places.json 的 slots）
  var recos = [];        // data/attractions.json 的推薦景點
  var activeDay = 'all';
  var activeCats = new Set(Object.keys(CATS));
  var showReco = false;  // 推薦景點預設關閉，避免一開始就太雜
  var showTimes = true;  // 行程地點旁是否常駐顯示時間
  var showRoute = true;  // 單日檢視時是否畫出移動路線
  var showAlts = false;  // 沒選的彈性方案位置，預設隱藏
  var panelOpen = false; // 彈性方案面板，預設收合

  /* 分頭行動（行程表的 .split，地點帶 who: family／solo）：看全部時兩條線都畫，
     只看家人或獨旅時只留那一條。和行程表共用 localStorage K('who') */
  var WHO = ['all', 'family', 'solo'];
  var WHO_LABEL = { all: '👥 看：全部', family: '🅰 看：A 線', solo: '🅱 看：B 線' };
  var WHO_MARK = { family: '🅰', solo: '🅱' };
  var whoSel = (function () {
    try { var v = localStorage.getItem(K('who')); return WHO.indexOf(v) >= 0 ? v : 'all'; } catch (e) { return 'all'; }
  })();
  var byWho = function (p) { return whoSel === 'all' || !p.who || p.who === whoSel; };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* 每個彈性時段目前看哪個方案：{ 'd5-1920': 'B' }，沒存的就是 A。
     localStorage 在無痕視窗會丟例外，全部包起來 */
  var PLAN_KEY = K('mapPlanSel');
  var planSel = (function () {
    try { return JSON.parse(localStorage.getItem(PLAN_KEY)) || {}; } catch (e) { return {}; }
  })();
  function savePlanSel() {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(planSel)); } catch (e) { /* 忽略 */ }
  }

  /* 每一天的縮放與位置（使用者要求「記憶縮放」）：切換方案、開關圖層都不會重置；
     換到別天再換回來、或從行程表連回地圖，也停在剛才看的地方。
     存在 sessionStorage，關掉分頁就清掉；想看整天就按「回到全觀」 */
  var VIEW_KEY = K('mapViews');
  var views = (function () {
    try { return JSON.parse(sessionStorage.getItem(VIEW_KEY)) || {}; } catch (e) { return {}; }
  })();
  function saveViews() {
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(views)); } catch (e) { /* 忽略 */ }
  }

  /* ---------- 建立地圖 ---------- */
  function initMap() {
    $('map').innerHTML = '';
    map = L.map('map', { zoomControl: true, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    // 由下而上：路線 → 推薦景點 → 沒選的彈性方案 → 行程地點（行程地點永遠蓋在最上面）
    routeLayer = L.layerGroup().addTo(map);
    stationLayer = L.layerGroup();   // 上下車站：放大到 12 級以上才加到地圖上
    recoLayer = L.layerGroup().addTo(map);
    altLayer = L.layerGroup().addTo(map);
    layer = L.layerGroup().addTo(map);

    /* 左上角縮放鈕下面：放大或移開之後才出現的「回到全觀」 */
    var HomeCtl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var div = L.DomUtil.create('div', 'home-ctl');
        L.DomEvent.disableClickPropagation(div);
        div.innerHTML = '<button type="button" class="home-btn" data-act="home" hidden title="回到這一天的全部路線">⤢ 回到全觀</button>';
        homeCtlEl = div.firstChild;
        return div;
      },
    });
    new HomeCtl().addTo(map);

    /* 左下角：這一天用到的交通方式 */
    var LegendCtl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: function () {
        var div = L.DomUtil.create('div', 'legend-ctl');
        L.DomEvent.disableClickPropagation(div);
        div.hidden = true;
        legendCtlEl = div;
        return div;
      },
    });
    new LegendCtl().addTo(map);

    map.on('moveend', function () {
      views[activeDay] = { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() };
      saveViews();
      syncHomeBtn();
    });
    map.on('zoomend', syncStations);

    /* 右上角的彈性方案面板；地圖上的點擊、捲動不要穿透到面板後面的地圖 */
    var FlexCtl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        var div = L.DomUtil.create('div', 'flex-ctl');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        flexCtlEl = div;
        return div;
      },
    });
    new FlexCtl().addTo(map);
  }

  /* ---------- 標記 ---------- */
  function makeIcon(cat, seq) {
    var c = CATS[cat];
    // 注意：序號 0 代表起點（機場或前一晚的飯店），0 是 falsy 不能用 seq ? ... 判斷
    var badge = (seq === undefined || seq === null)
      ? ''
      : '<i class="pin-seq" style="color:' + c.color + '">' + seq + '</i>';
    return L.divIcon({
      className: '',
      html: '<div style="position:relative">'
          + '<div class="pin" style="background:' + c.color + '"><span>' + c.icon + '</span></div>'
          + badge + '</div>',
      iconSize: [32, 32],
      iconAnchor: [16, 30],
      popupAnchor: [0, -28],
    });
  }

  function slotById(id) {
    for (var i = 0; i < slots.length; i++) if (slots[i].id === id) return slots[i];
    return null;
  }

  function selectedPlan(s) {
    var k = planSel[s.id] || 'A';
    return s.plans.filter(function (pl) { return pl.k === k; })[0] || s.plans[0];
  }

  /* 一組彈性行程的方案按鈕；沒有固定地點的方案（例如「在飯店附近吃」）用虛線框 */
  function planBtns(s) {
    var sel = selectedPlan(s).k;
    return s.plans.map(function (pl) {
      var has = pl.pts.some(function (pt) { return pt.lat != null; });
      return '<button type="button" class="pk' + (pl.k === sel ? ' on' : '') + (pl.k !== 'A' ? ' alt' : '')
        + (has ? '' : ' nopt') + '" data-slot="' + s.id + '" data-k="' + pl.k + '" title="'
        + esc(pl.k + '｜' + pl.title + (has ? '' : '（沒有固定地點，地圖上不標）')) + '"'
        + ' aria-pressed="' + (pl.k === sel) + '">' + pl.k + '</button>';
    }).join('');
  }

  function timeText(p) {
    if (p.start) return p.startTime ? p.startTime + ' 出發' : '出發';
    return p.time + (p.slot ? '・' + p.plan : '') + (p.who && WHO_MARK[p.who] ? ' ' + WHO_MARK[p.who] : '');
  }

  function popupHtml(p) {
    var gmaps = 'https://maps.google.com/maps?q=' + encodeURIComponent(p.query);
    var parts = [];
    var when = p.start ? '　' + (p.startTime ? p.startTime + ' ' : '') + '從飯店出發' : (p.time ? '　' + p.time : '');
    var lane = p.who && WHO_MARK[p.who] ? '・分頭行動 ' + WHO_LABEL[p.who].replace('看：', '') : '';
    parts.push('<span class="pop-day">Day ' + p.day + when + (p.slot ? '・彈性 ' + p.plan : '') + lane + '</span>');
    parts.push('<div class="pop-title">' + p.icon + ' ' + esc(p.label) + '</div>');
    if (p.ja) parts.push('<div class="pop-ja">' + esc(p.ja) + '</div>');
    if (p.title && p.title !== p.label) parts.push('<div class="pop-ja">' + esc(p.title) + '</div>');
    if (p.note) parts.push('<div class="pop-note">' + esc(p.note) + '</div>');
    var s = p.slot && slotById(p.slot);
    if (s && s.plans.length > 1) parts.push('<div class="pop-plans">換方案 ' + planBtns(s) + '</div>');
    parts.push('<div class="pop-actions">'
      + '<a href="' + gmaps + '" target="_blank" rel="noopener">在 Google Maps 開啟</a>'
      + '<a href="../final/index.html#day-' + p.day + '">看這天的行程</a>'
      + '</div>');
    return parts.join('');
  }

  /* 沒選的方案（小圓點）的彈窗 */
  function altPopupHtml(s, pl, pt) {
    var gmaps = 'https://maps.google.com/maps?q=' + encodeURIComponent(pt.query);
    return '<span class="pop-day">Day ' + s.day + '　' + s.time + '・彈性 ' + pl.k + '（沒有選）</span>'
      + '<div class="pop-title">' + pl.icon + ' ' + esc(pt.label) + '</div>'
      + '<div class="pop-ja">' + esc(pl.title) + '</div>'
      + (pl.head ? '<div class="pop-note">' + esc(pl.head) + '</div>' : '')
      + '<div class="pop-plans">換方案 ' + planBtns(s) + '</div>'
      + '<div class="pop-actions"><a href="' + gmaps + '" target="_blank" rel="noopener">在 Google Maps 開啟</a>'
      + '<a href="../final/index.html#day-' + s.day + '">看這天的行程</a></div>';
  }

  /* 推薦景點的彈窗：資料欄位與行程地點不同 */
  function recoPopupHtml(r) {
    var gmaps = r.link || ('https://maps.google.com/maps?q=' + encodeURIComponent(r.query));
    var parts = [];
    parts.push('<span class="pop-day">💡 推薦景點・' + r.city + '</span>');
    parts.push('<div class="pop-title">' + r.name + '</div>');
    if (r.features) parts.push('<div class="pop-note">' + r.features + '</div>');

    var facts = [];
    if (r.price)     facts.push('🎫 ' + r.price);
    if (r.duration)  facts.push('⏱ ' + r.duration);
    if (r.hours)     facts.push('🕐 ' + r.hours);
    if (r.transport) facts.push('🚇 ' + r.transport);
    if (facts.length) parts.push('<div class="pop-note">' + facts.join('<br>') + '</div>');

    parts.push('<div class="pop-actions">'
      + '<a href="' + gmaps + '" target="_blank" rel="noopener">'
      + (r.link ? '官方網站' : '在 Google Maps 開啟') + '</a>'
      + (r.link ? '<a href="https://maps.google.com/maps?q=' + encodeURIComponent(r.query)
                + '" target="_blank" rel="noopener">Google Maps</a>' : '')
      + '</div>');
    return parts.join('');
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  /* 交通方式的線條（使用者要求：走路虛線、搭車實線，而且不同交通工具不同顏色）
     鐵路（JR・私鐵・嵐電）＝主色實線、地鐵＝次色實線、市巴士＝綠色實線、接送車＝桃紅色實線、步行＝灰色虛線 */
  var MODES = {
    rail:   { name: '鐵路（JR・私鐵）', icon: '🚃', css: 'lg-rail',   color: function () { return cssVar('--primary', '#B5451B'); } },
    subway: { name: '地鐵',             icon: '🚇', css: 'lg-subway', color: function () { return cssVar('--secondary', '#4A6FA5'); } },
    bus:    { name: '市巴士',           icon: '🚌', css: 'lg-bus',    color: function () { return cssVar('--c-bus', '#2E8B57'); } },
    car:    { name: '接送車',           icon: '🚐', css: 'lg-car',    color: function () { return cssVar('--c-car', '#C2407A'); } },
    walk:   { name: '步行',             icon: '🚶', css: 'lg-walk',   color: function () { return cssVar('--muted', '#7A6E5D'); } },
  };

  /* 底下先墊一條較粗的白線，在街道很多的底圖上才看得清楚；
     最上面再疊一條看不見的粗線當觸控範圍：滑鼠滑過、手指點一下都會顯示搭哪一班 */
  function drawLeg(leg) {
    var st = MODES[leg.mode] || MODES.walk;
    var color = st.color();
    var walk = leg.mode === 'walk';
    if (!walk) {
      L.polyline(leg.coords, { color: cssVar('--surface', '#fff'), weight: 9, opacity: 0.9, interactive: false })
        .addTo(routeLayer);
    }
    L.polyline(leg.coords, walk
      ? { color: color, weight: 4, opacity: 0.95, dashArray: '3 9', lineCap: 'round', interactive: false }
      : { color: color, weight: 5, opacity: 0.95, interactive: false })
      .addTo(routeLayer);
    L.polyline(leg.coords, { color: '#000', weight: 20, opacity: 0, interactive: true })
      .bindTooltip(st.icon + ' ' + esc(leg.label), { sticky: true, className: 'route-tip' })
      .on('click', function (e) { this.openTooltip(e.latlng); })
      .addTo(routeLayer);

    // 接送車直接開到門口，沒有上下車站
    if (!walk && leg.mode !== 'car' && leg.coords.length) {
      var stn = function (ll, name, what) {
        L.circleMarker(ll, { radius: 5, color: color, weight: 2.5, fillColor: cssVar('--surface', '#fff'), fillOpacity: 1 })
          .bindTooltip(st.icon + ' ' + what + '｜' + esc(name) + (leg.mode === 'bus' ? '' : '站'), { direction: 'top', offset: [0, -6], className: 'stn-tip' })
          .on('click', function () { this.openTooltip(); })
          .addTo(stationLayer);
      };
      stn(leg.coords[0], leg.from || '', '上車');
      stn(leg.coords[leg.coords.length - 1], leg.to || '', '下車');
    }
  }

  /* 車站小圓圈放大到 12 級以上才顯示，整天或整趟的縮圖不會一堆圓點 */
  function syncStations() {
    var want = activeDay !== 'all' && map.getZoom() >= 12;
    if (want && !map.hasLayer(stationLayer)) stationLayer.addTo(map);
    if (!want && map.hasLayer(stationLayer)) map.removeLayer(stationLayer);
  }

  /* 「回到全觀」：這一天全部地點與路線都在畫面裡時隱藏，放大或移開才出現 */
  function syncHomeBtn() {
    if (!homeCtlEl || !map._loaded) return;
    homeCtlEl.hidden = !homeBounds || map.getBounds().pad(0.02).contains(homeBounds);
  }

  function fitHome() {
    if (homeBounds) map.fitBounds(homeBounds, { padding: [45, 45], maxZoom: 15 });
  }

  /* 某一天的所有地點：行程地點＋每組彈性行程「目前選的方案」。
     彈性行程在 places 裡的是方案 A，這裡換成選的那一個 */
  function dayPoints(day) {
    var list = places.filter(function (p) { return p.day === day && !p.slot; });
    slots.forEach(function (s) {
      if (s.day !== day) return;
      var pl = selectedPlan(s);
      pl.pts.forEach(function (pt, j) {
        if (pt.lat == null) return;
        list.push({
          day: s.day, date: s.date, time: s.time, icon: pl.icon, title: pl.title, ja: '',
          label: pt.label, tag: '', kind: 'spot', note: pl.head, query: pt.query,
          lat: pt.lat, lon: pt.lon, order: s.order, sub: j, slot: s.id, plan: pl.k, who: s.who,
        });
      });
    });
    return list;
  }

  /* 出發點（飯店）永遠第一個，其餘依時間、再依行程表上的先後 */
  function byTime(a, b) {
    if (!!a.start !== !!b.start) return a.start ? -1 : 1;
    return a.time.localeCompare(b.time) || ((a.order || 0) - (b.order || 0)) || ((a.sub || 0) - (b.sub || 0));
  }

  var seqKey = function (p) { return (p.start ? 'S' : '') + p.query + '@' + p.time + '@' + (p.slot || '') + '@' + (p.sub || 0); };

  /* ---------- 彈性方案面板 ---------- */
  function renderPanel() {
    if (!flexCtlEl) return;
    var list = activeDay === 'all' ? [] : slots.filter(function (s) { return s.day === activeDay && s.plans.length > 1 && byWho(s); });
    flexCtlEl.hidden = !list.length;
    if (!list.length) { flexCtlEl.innerHTML = ''; return; }
    var changed = list.filter(function (s) { return selectedPlan(s).k !== 'A'; }).length;
    var html = '<button type="button" class="flex-toggle" data-act="panel" aria-expanded="' + panelOpen + '">🔀 彈性方案 '
      + list.length + ' 組' + (changed ? '・<b>' + changed + ' 組改選</b>' : '') + (panelOpen ? ' ▴' : ' ▾') + '</button>';
    if (panelOpen) {
      html += '<div class="flex-panel"><p class="fp-note">地圖上只標目前選的方案；A 是原訂或首選，B～E 是替代方案。虛線框的方案沒有固定地點。</p>';
      list.forEach(function (s) {
        html += '<div class="fp-row"><span class="fp-time">' + s.time + '</span>'
          + '<span class="fp-name" title="' + esc(selectedPlan(s).title) + '">' + esc(selectedPlan(s).title) + '</span>'
          + '<span class="fp-btns">' + planBtns(s) + '</span></div>';
      });
      html += '<div class="fp-foot">'
        + '<button type="button" class="fp-btn" data-act="alts" aria-pressed="' + showAlts + '">📍 其他方案的位置</button>'
        + (changed ? '<button type="button" class="fp-btn" data-act="resetA">全部改回 A</button>' : '')
        + '</div></div>';
    }
    flexCtlEl.innerHTML = html;
  }

  /* 換方案：保留目前的縮放與位置（不重置成整張地圖）。
     新方案的點不在畫面裡時，只平移過去、不改縮放；從彈窗換的會在新的點上再打開彈窗，方便繼續比較 */
  function setPlan(slotId, k, fromPopup) {
    if (k === 'A') delete planSel[slotId]; else planSel[slotId] = k;
    savePlanSel();
    map.closePopup();
    render({ keepView: true, focusSlot: slotId, reopen: fromPopup });
  }

  /* 面板、彈窗裡的按鈕都是動態產生的，統一在 document 上接點擊
     （Leaflet 只擋 mousedown／touchstart 的冒泡，click 會傳上來） */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-slot][data-k], [data-act]') : null;
    if (!el) return;
    if (el.hasAttribute('data-slot')) {
      setPlan(el.getAttribute('data-slot'), el.getAttribute('data-k'), !!el.closest('.leaflet-popup'));
      return;
    }
    var act = el.getAttribute('data-act');
    if (act === 'home') { fitHome(); }
    else if (act === 'panel') { panelOpen = !panelOpen; renderPanel(); }
    else if (act === 'alts') { showAlts = !showAlts; render({ keepView: true }); }
    else if (act === 'resetA') {
      slots.forEach(function (s) { if (s.day === activeDay) delete planSel[s.id]; });
      savePlanSel();
      render({ keepView: true });
    }
  });

  /* ---------- 重繪 ---------- */
  function render(opts) {
    opts = opts || {};
    layer.clearLayers();
    recoLayer.clearLayers();
    altLayer.clearLayers();
    routeLayer.clearLayers();
    stationLayer.clearLayers();
    var routeBounds = [];
    var routeModes = {};   // 這一天實際用到的交通方式，圖例只列這些
    var missing = 0;       // 沒有路線資料的段數（應該是 0；build-routes.js 缺定義會直接報錯）

    // 單日檢視：當天全部地點（含選的彈性方案），依時間排序編號、連成路線。
    // 編號與路線不受類別篩選影響 —— 關掉某類標記，其他點的號碼不該跟著變
    var ordered = [];
    var seqOf = {};
    if (activeDay !== 'all') {
      ordered = dayPoints(activeDay).filter(function (p) { return p.time && p.lat != null && byWho(p); }).sort(byTime);
      // 當天最早的點若是機場或前一晚的飯店，視為起點標 0，其餘依序從 1 開始
      var offset = (ordered.length && (ordered[0].start || isGateway(ordered[0]))) ? 0 : 1;
      ordered.forEach(function (p, i) { seqOf[seqKey(p)] = i + offset; });

      if (showRoute) {
        /* 分頭行動的那天：家人、獨旅各自一串（共同的點兩串都有），兩串都畫；
           沒有分頭行動就只有一串。同一對相鄰點只畫一次 */
        var lanesToday = [];
        ordered.forEach(function (p) { if (p.who && lanesToday.indexOf(p.who) < 0) lanesToday.push(p.who); });
        var seqs = lanesToday.length
          ? lanesToday.map(function (w) { return ordered.filter(function (p) { return !p.who || p.who === w; }); })
          : [ordered];
        var pairs = [];
        var pairSeen = {};
        seqs.forEach(function (seq) {
          // 同一個座標連續出現（例如出發的飯店和第一站同一處）只算一次
          var sp = seq.filter(function (p, i) {
            return i === 0 || p.lat !== seq[i - 1].lat || p.lon !== seq[i - 1].lon;
          });
          for (var k = 1; k < sp.length; k++) {
            var pk = seqKey(sp[k - 1]) + '>' + seqKey(sp[k]);
            if (pairSeen[pk]) continue;
            pairSeen[pk] = true;
            pairs.push([sp[k - 1], sp[k]]);
          }
        });
        var segs = routes[activeDay] || [];
        for (var i = 0; i < pairs.length; i++) {
          var A = pairs[i][0], B = pairs[i][1];
          var seg = segs.filter(function (s) { return s.from === A.query && s.to === B.query; })[0];
          if (seg) {
            /* 依交通方式畫實際路線：鐵路、地鐵沿著軌道，公車、步行沿著道路 */
            seg.legs.forEach(function (id) {
              var leg = typeof id === 'string' ? routeLegs[id] : id;
              if (!leg) return;
              drawLeg(leg);
              routeModes[leg.mode] = true;
              routeBounds = routeBounds.concat(leg.coords);
            });
          } else {
            /* 萬一缺資料：紅色虛線，並在狀態列提醒，不假裝它是路線 */
            missing++;
            L.polyline([[A.lat, A.lon], [B.lat, B.lon]], { color: '#C62828', weight: 3, opacity: 0.8, dashArray: '6 6' })
              .bindTooltip('這一段沒有路線資料', { sticky: true, className: 'route-tip' })
              .addTo(routeLayer);
          }
        }
      }
    }

    var shown = (activeDay === 'all'
      ? places.filter(function (p) { return !p.start; })   // 全部檢視：每天的出發飯店就是前一天的住宿，不重複標
      : ordered.concat(dayPoints(activeDay).filter(function (p) { return !p.time; }))
    ).filter(function (p) { return p.lat != null && byWho(p) && activeCats.has(categorize(p)); });

    /* --- 行程地點 --- */
    var focusMarkers = [];
    shown.forEach(function (p) {
      var m = L.marker([p.lat, p.lon], {
        icon: makeIcon(categorize(p), seqOf[seqKey(p)]),
        zIndexOffset: 500,          // 永遠蓋在推薦景點之上
      }).bindPopup(popupHtml(p));
      if (opts.focusSlot && p.slot === opts.focusSlot) focusMarkers.push(m);

      // 時間直接浮在標記旁邊，不用點開也看得到；彈性行程多標一個方案字母
      if (showTimes && p.time) {
        m.bindTooltip(timeText(p), {
          permanent: true,
          direction: 'right',
          offset: [10, -12],
          className: 'time-tip',
        });
      }
      m.addTo(layer);
    });

    /* --- 沒選的彈性方案：小圓點，預設隱藏 --- */
    var altShown = 0;
    if (showAlts && activeDay !== 'all') {
      slots.forEach(function (s) {
        if (s.day !== activeDay || !byWho(s)) return;
        var sel = selectedPlan(s).k;
        s.plans.forEach(function (pl) {
          if (pl.k === sel) return;
          pl.pts.forEach(function (pt) {
            if (pt.lat == null) return;
            altShown++;
            L.marker([pt.lat, pt.lon], {
              icon: L.divIcon({ className: '', html: '<div class="alt-dot">' + pl.k + '</div>', iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -10] }),
              zIndexOffset: 300,
            })
              .bindTooltip(s.time + '・' + pl.k + '｜' + pt.label, { direction: 'top', offset: [0, -10], className: 'reco-tip' })
              .bindPopup(altPopupHtml(s, pl, pt))
              .addTo(altLayer);
          });
        });
      });
    }

    /* --- 推薦景點 --- */
    var recoShown = [];
    if (showReco) {
      recoShown = recos.filter(function (r) { return r.lat != null; });
      recoShown.forEach(function (r) {
        var must = (r.tags || []).indexOf('必去') !== -1;
        L.marker([r.lat, r.lon], {
          icon: L.divIcon({
            className: '',
            html: must ? '<div class="dot-star">★</div>' : '<div class="dot"></div>',
            iconSize: must ? [19, 19] : [15, 15],
            iconAnchor: must ? [9, 9] : [7, 7],
            popupAnchor: [0, -10],
          }),
          zIndexOffset: 0,
        })
          .bindTooltip(r.name, { direction: 'top', offset: [0, -8], className: 'reco-tip' })
          .bindPopup(recoPopupHtml(r))
          .addTo(recoLayer);
      });
    }

    var label = activeDay === 'all' ? '全部行程' : ('Day ' + activeDay);
    $('status').textContent = label + '：行程 ' + shown.length + ' 點'
      + (altShown ? '／其他方案 ' + altShown + ' 點' : '')
      + (showReco ? '／推薦 ' + recoShown.length + ' 點' : '')
      + (activeDay !== 'all' && !showRoute ? '（路線已隱藏）' : '')
      + (missing ? '（有 ' + missing + ' 段沒有路線資料）' : '');
    if (!places.length) {
      $('status').textContent = '這趟還沒排行程' + (showReco ? '，先看推薦景點 ' + recoShown.length + ' 點' : '');
    }

    /* 左下角圖例：只列這一天用到的交通方式 */
    var used = ['rail', 'subway', 'bus', 'car', 'walk'].filter(function (m) { return routeModes[m]; });
    legendCtlEl.hidden = !(activeDay !== 'all' && showRoute && (used.length || missing));
    legendCtlEl.innerHTML = used.map(function (m) {
      return '<span><i class="' + MODES[m].css + '"></i>' + MODES[m].name + '</span>';
    }).join('')
      + (routeModes.rail || routeModes.subway || routeModes.bus ? '<span><i class="lg-stn"></i>上下車站（放大才顯示）</span>' : '')
      + (missing ? '<span><i class="lg-miss"></i>缺路線資料</span>' : '');

    renderPanel();

    // 這一天的全觀範圍：只依行程地點與路線決定，避免被散落各地的推薦景點拉遠
    homeBounds = shown.length
      ? L.latLngBounds(shown.map(function (p) { return [p.lat, p.lon]; }).concat(routeBounds))
      : null;
    // 這趟還沒有任何行程地點（規劃初期）：全觀改看推薦景點，否則地圖沒有範圍可以對焦
    if (!places.length && recoShown.length) {
      homeBounds = L.latLngBounds(recoShown.map(function (r) { return [r.lat, r.lon]; }));
    }

    if (!opts.keepView) {
      // 換天或第一次載入：這一天看過就回到上次的位置，沒看過就顯示整天
      var v = views[activeDay];
      if (v && v.c && v.z != null) map.setView(v.c, v.z);
      else fitHome();
    } else if (focusMarkers.length && map._loaded) {
      // 換了方案：新的點不在畫面裡就平移過去，但不改縮放
      var ll = focusMarkers[0].getLatLng();
      if (!map.getBounds().contains(ll)) map.panInside(ll, { padding: [60, 60] });
      if (opts.reopen) focusMarkers[0].openPopup();
    }
    syncStations();
    syncHomeBtn();
  }

  /* ---------- 篩選鈕 ---------- */
  function buildChips() {
    var days = [...new Set(places.map(function (p) { return p.day; }))].sort(function (a, b) { return a - b; });
    var dayBox = $('dayChips');

    function dayChip(value, text) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(activeDay === value));
      b.onclick = function () {
        activeDay = value;
        dayBox.querySelectorAll('.chip').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        render();
      };
      dayBox.appendChild(b);
    }

    dayChip('all', '全部');
    days.forEach(function (d) {
      var date = (places.find(function (p) { return p.day === d; }) || {}).date || '';
      dayChip(d, 'Day' + d + ' ' + date.slice(5).replace('-', '/'));
    });

    var catBox = $('catChips');
    Object.keys(CATS).forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip cat';
      b.style.setProperty('--cat-color', CATS[key].color);
      b.textContent = CATS[key].icon + ' ' + CATS[key].label;
      b.setAttribute('aria-pressed', 'true');
      b.onclick = function () {
        var on = b.getAttribute('aria-pressed') === 'true';
        if (on) { activeCats.delete(key); } else { activeCats.add(key); }
        b.setAttribute('aria-pressed', String(!on));
        render({ keepView: true });
      };
      catBox.appendChild(b);
    });

    /* 分隔線，強調以下兩個開關和上面的「行程分類」性質不同 */
    var sep = document.createElement('span');
    sep.style.cssText = 'flex:0 0 auto;width:1px;background:var(--border);margin:4px 3px;';
    catBox.appendChild(sep);

    /* 推薦景點開關 */
    var rb = document.createElement('button');
    rb.type = 'button';
    rb.className = 'chip cat';
    rb.style.setProperty('--cat-color', 'var(--c-reco)');
    rb.textContent = '💡 推薦景點 ' + recos.filter(function (r) { return r.lat != null; }).length;
    rb.setAttribute('aria-pressed', String(showReco));
    rb.onclick = function () {
      showReco = !showReco;
      rb.setAttribute('aria-pressed', String(showReco));
      render({ keepView: true });
    };
    catBox.appendChild(rb);

    /* 路線開關 —— 只有在單日檢視才有作用 */
    var routeBtn = document.createElement('button');
    routeBtn.type = 'button';
    routeBtn.className = 'chip cat';
    routeBtn.style.setProperty('--cat-color', 'var(--primary)');
    routeBtn.textContent = '〰️ 移動路線';
    routeBtn.setAttribute('aria-pressed', 'true');
    routeBtn.title = '選擇單一天數時才會畫出路線';
    routeBtn.onclick = function () {
      showRoute = !showRoute;
      routeBtn.setAttribute('aria-pressed', String(showRoute));
      render({ keepView: true });
    };
    catBox.appendChild(routeBtn);

    /* 時間標籤開關 */
    var tb = document.createElement('button');
    tb.type = 'button';
    tb.className = 'chip cat';
    tb.style.setProperty('--cat-color', 'var(--primary)');
    tb.textContent = '🕐 顯示時間';
    tb.setAttribute('aria-pressed', 'true');
    tb.onclick = function () {
      showTimes = !showTimes;
      tb.setAttribute('aria-pressed', String(showTimes));
      render({ keepView: true });
    };
    catBox.appendChild(tb);

    /* 分頭行動：有地點分在家人／獨旅兩條線時才出現；和行程表同步同一個選擇 */
    if (places.some(function (p) { return p.who; }) || slots.some(function (s) { return s.who; })) {
      var wb = document.createElement('button');
      wb.type = 'button';
      wb.className = 'chip cat';
      wb.style.setProperty('--cat-color', 'var(--secondary)');
      wb.textContent = WHO_LABEL[whoSel];
      wb.setAttribute('aria-pressed', 'true');
      wb.title = '分頭行動的時段要看誰的行程（和行程表同步）';
      wb.onclick = function () {
        whoSel = WHO[(WHO.indexOf(whoSel) + 1) % WHO.length];
        try { localStorage.setItem(K('who'), whoSel); } catch (e) {}
        wb.textContent = WHO_LABEL[whoSel];
        render({ keepView: true });
      };
      catBox.appendChild(wb);
    }
  }

  /* ---------- 目前位置 ---------- */
  $('locateBtn').onclick = function () {
    if (!navigator.geolocation) {
      $('status').textContent = '這個瀏覽器不支援定位';
      return;
    }
    $('status').textContent = '定位中…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      var ll = [pos.coords.latitude, pos.coords.longitude];
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker(ll, {
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        zIndexOffset: 1000,
      }).bindPopup('你在這裡').addTo(map);
      map.setView(ll, 15);
      $('status').textContent = '已標出你目前的位置';
    }, function (err) {
      $('status').textContent = err.code === 1 ? '定位權限被拒絕' : '無法取得位置';
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  /* ---------- 載入資料 ---------- */
  /* 路線資料讀不到（例如離線）時不影響地圖本身，只是不畫路線、狀態列會提醒 */
  fetch('routes.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (rd) {
      if (rd && rd.days) {
        routeLegs = rd.legs || {};
        Object.keys(rd.days).forEach(function (d) { routes[+d] = rd.days[d]; });
      }
      return fetch('places.json');
    })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      places = (data.places || []).filter(function (p) { return p.lat != null; });
      slots = data.slots || [];
      recos = (data.recommended || []).filter(function (r) { return r.lat != null; });
      if (!places.length && !recos.length) throw new Error('places.json 沒有任何含座標的地點');
      // 行程還沒排（例如剛開始規劃的下一趟）：先把推薦景點打開，地圖才不是空的
      if (!places.length) showReco = true;
      initMap();
      buildChips();

      // 網址帶 ?day=3 時直接開那一天
      var want = new URLSearchParams(location.search).get('day');
      if (want && places.some(function (p) { return String(p.day) === want; })) {
        activeDay = +want;
        $('dayChips').querySelectorAll('.chip').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b.textContent.indexOf('Day' + want + ' ') === 0));
        });
      }
      render();
    })
    .catch(function (e) {
      $('map').innerHTML = '<p class="loading">地圖資料載入失敗：' + e.message
        + '<br><br>這一頁需要透過網頁伺服器開啟（例如 GitHub Pages），'
        + '直接用瀏覽器開啟本機檔案會因瀏覽器安全限制而無法讀取 places.json。</p>';
    });
})();
