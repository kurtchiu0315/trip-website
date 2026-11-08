/* 預算追蹤（兩趟旅行共用）。
 * 頁面 docs/<trip>/budget/index.html 先載入 ../trip.js，並用 window.BUDGET 給這趟的
 * shared（共同支出項目）與 days（每天的日期、標題、已查證的固定門票）
 */
(function () {
  'use strict';

  /* 這趟旅行的 localStorage key（見 ../trip.js）：兩趟的資料分開存，不會互相覆蓋 */
  var K = (window.TRIP && window.TRIP.key) || function (k) { return k; };
  /* 共用檔所在的資料夾（docs/assets/），頁首照片從這裡找 */
  var ASSETS = ((document.currentScript && document.currentScript.src) || '../../assets/x').replace(/[^/]*$/, '');

  /* localStorage 在無痕視窗／封鎖 cookie 時會丟例外，全部包起來；key 一律經過 K() 加上這趟的前綴 */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(K(k)); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(K(k), v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(K(k)); } catch (e) {} }
  };

  var CATS = [
    { key: 'transport', label: '🚇 交通' },
    { key: 'food',      label: '🍽️ 餐飲' },
    { key: 'ticket',    label: '🎫 門票・入場' },
    { key: 'shopping',  label: '🛍️ 購物' },
    { key: 'other',     label: '➕ 其他' },
  ];

  var SHARED = BUDGET.shared;

  var DAYS = BUDGET.days;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var yen = function (n) { return '¥' + Math.round(n).toLocaleString('zh-TW'); };

  function val(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var v = parseFloat(el.value);
    return (isFinite(v) && v > 0) ? v : 0;
  }

  function fixedTotal(day) {
    return day.fixed.reduce(function (s, f) { return s + f.amount; }, 0);
  }

  /* ---------- 建立畫面 ---------- */
  function amountRow(id, label, sub) {
    return '<div class="row">'
      + '<span class="label">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span>'
      + '<span class="yen">¥</span>'
      + '<input type="number" id="' + id + '" min="0" step="100" placeholder="0" inputmode="numeric">'
      + '</div>';
  }

  function build() {
    $('#sharedBody').innerHTML = SHARED.map(function (s) {
      return amountRow('s-' + s.key, s.label);
    }).join('');

    $('#days').innerHTML = DAYS.map(function (d) {
      var fixedRows = d.fixed.map(function (f) {
        return '<div class="row fixed">'
          + '<span class="label">🎫 ' + f.name + '<small>已確認票價，自動計入</small></span>'
          + '<span class="amount">' + yen(f.amount) + '</span></div>';
      }).join('');

      var inputRows = CATS.map(function (c) {
        return amountRow('d' + d.n + '-' + c.key, c.label);
      }).join('');

      return '<section class="panel day-panel" id="panel-' + d.n + '">'
        + '<div class="panel-head" onclick="togglePanel(' + d.n + ')">'
        +   '<span class="day-badge">' + d.n + '</span>'
        +   '<h2>Day ' + d.n + '　' + d.date + '<br><small style="font-weight:400;color:var(--muted);font-size:0.76rem">' + d.title + '</small></h2>'
        +   '<span class="day-sum" id="sum-' + d.n + '">' + yen(fixedTotal(d)) + '</span>'
        +   '<span class="caret">▶</span>'
        + '</div>'
        + '<div class="panel-body">' + fixedRows + inputRows + '</div>'
        + '</section>';
    }).join('');
  }

  /* ---------- 計算 ---------- */
  function dayTotal(d) {
    return fixedTotal(d) + CATS.reduce(function (s, c) {
      return s + val('d' + d.n + '-' + c.key);
    }, 0);
  }

  function recalc() {
    var sharedSum = SHARED.reduce(function (s, x) { return s + val('s-' + x.key); }, 0);
    var daySum = 0;

    DAYS.forEach(function (d) {
      var t = dayTotal(d);
      daySum += t;
      var el = document.getElementById('sum-' + d.n);
      if (el) el.textContent = yen(t);
    });

    var grand = sharedSum + daySum;
    $('#grandJpy').textContent = yen(grand);

    var rate = parseFloat($('#rate').value);
    $('#grandTwd').textContent = (isFinite(rate) && rate > 0)
      ? '≈ NT$' + Math.round(grand * rate).toLocaleString('zh-TW') : '';

    /* 分類小計（含每日各分類 + 共同支出） */
    var byCat = {};
    CATS.forEach(function (c) {
      byCat[c.label] = DAYS.reduce(function (s, d) { return s + val('d' + d.n + '-' + c.key); }, 0);
    });
    byCat['🎫 門票・入場'] += DAYS.reduce(function (s, d) { return s + fixedTotal(d); }, 0);

    var chips = [];
    chips.push('共同支出 ' + yen(sharedSum));
    chips.push('每日合計 ' + yen(daySum));
    Object.keys(byCat).forEach(function (k) {
      if (byCat[k] > 0) chips.push(k + ' ' + yen(byCat[k]));
    });
    $('#breakdown').innerHTML = chips.map(function (c) { return '<span>' + c + '</span>'; }).join('');
  }

  /* ---------- 儲存 ---------- */
  function allInputIds() {
    var ids = SHARED.map(function (s) { return 's-' + s.key; });
    DAYS.forEach(function (d) {
      CATS.forEach(function (c) { ids.push('d' + d.n + '-' + c.key); });
    });
    ids.push('rate');
    return ids;
  }

  function bind() {
    allInputIds().forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var saved = store.get('budget2.' + id, '');
      if (saved !== '') el.value = saved;
      el.addEventListener('input', function () {
        store.set('budget2.' + id, el.value);
        recalc();
      });
    });
  }

  /* ---------- 互動 ---------- */
  window.togglePanel = function (n) {
    var p = document.getElementById('panel-' + n);
    p.classList.toggle('open');
    store.set('budget2.open.' + n, p.classList.contains('open') ? '1' : '0');
  };

  window.toggleAll = function () {
    var panels = document.querySelectorAll('.day-panel');
    var anyClosed = [].some.call(panels, function (p) { return !p.classList.contains('open'); });
    [].forEach.call(panels, function (p, i) {
      p.classList.toggle('open', anyClosed);
      store.set('budget2.open.' + (i + 1), anyClosed ? '1' : '0');
    });
    $('#expandBtn').textContent = anyClosed ? '收合全部' : '展開全部';
  };

  window.resetAll = function () {
    if (!confirm('確定要清空所有已填入的金額嗎？此動作無法復原。')) return;
    allInputIds().forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
      store.del('budget2.' + id);
    });
    recalc();
  };

  window.copySummary = function () {
    var rate = parseFloat($('#rate').value);
    var lines = ['【' + (BUDGET.title || '關西') + ' 預算明細（每人）】', ''];

    var sharedSum = 0;
    lines.push('◆ 共同支出');
    SHARED.forEach(function (s) {
      var v = val('s-' + s.key);
      sharedSum += v;
      if (v > 0) lines.push('　' + s.label.replace(/^\S+\s*/, '') + '：' + yen(v));
    });
    lines.push('　小計：' + yen(sharedSum), '');

    DAYS.forEach(function (d) {
      var t = dayTotal(d);
      if (t === 0) return;
      lines.push('◆ Day ' + d.n + '　' + d.date + '　' + d.title + '：' + yen(t));
      d.fixed.forEach(function (f) { lines.push('　' + f.name + '：' + yen(f.amount)); });
      CATS.forEach(function (c) {
        var v = val('d' + d.n + '-' + c.key);
        if (v > 0) lines.push('　' + c.label.replace(/^\S+\s*/, '') + '：' + yen(v));
      });
      lines.push('');
    });

    var grand = sharedSum + DAYS.reduce(function (s, d) { return s + dayTotal(d); }, 0);
    lines.push('━━━━━━━━━━━━');
    lines.push('總計：' + yen(grand)
      + ((isFinite(rate) && rate > 0) ? '　≈ NT$' + Math.round(grand * rate).toLocaleString('zh-TW') : ''));

    var text = lines.join('\n');
    var btn = $('#copyBtn');
    var done = function (ok) {
      btn.textContent = ok ? '✅ 已複製' : '⚠️ 複製失敗';
      setTimeout(function () { btn.textContent = '📋 複製明細'; }, 2000);
    };

    function legacyCopy() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { done(legacyCopy()); });
    } else {
      done(legacyCopy());
    }
  };

  /* ---------- 啟動 ---------- */
  build();
  bind();

  // 還原展開狀態；第一次進來預設全部收合，只展開有固定門票的那幾天
  DAYS.forEach(function (d) {
    var saved = store.get('budget2.open.' + d.n, null);
    var open = saved === null ? false : saved === '1';
    document.getElementById('panel-' + d.n).classList.toggle('open', open);
  });

  recalc();
  if (window.applyHero) window.applyHero(ASSETS + 'hero/');
})();
