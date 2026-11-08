/* 行前 Check List（兩趟旅行共用）。
 * 頁面 docs/<trip>/checklist/index.html 先載入 ../trip.js，並用 window.CHECKLIST 給這趟的項目
 */
(function () {
  'use strict';

  /* 這趟旅行的 localStorage key（見 ../trip.js）：兩趟的資料分開存，不會互相覆蓋 */
  var K = (window.TRIP && window.TRIP.key) || function (k) { return k; };
  /* 共用檔所在的資料夾（docs/assets/），頁首照片從這裡找 */
  var ASSETS = ((document.currentScript && document.currentScript.src) || '../../assets/x').replace(/[^/]*$/, '');

  /* key 一律經過 K() 加上這趟的前綴 */
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(K(k)); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(K(k), v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(K(k)); } catch (e) {} }
  };

  var GROUPS = window.CHECKLIST;

  var $ = function (s) { return document.querySelector(s); };
  var KEY = function (g, i) { return 'chk.' + g + '.' + i; };

  function build() {
    $('#groups').innerHTML = GROUPS.map(function (g) {
      var items = g.items.map(function (it) {
        var id = 'cb-' + g.id + '-' + it.id;
        return '<div class="item" id="item-' + g.id + '-' + it.id + '">'
          + '<input type="checkbox" id="' + id + '" data-g="' + g.id + '" data-i="' + it.id + '">'
          + '<div class="body">'
          +   '<label class="t" for="' + id + '">' + it.t
          +     '<span class="tagline ' + it.tag + '">' + tagLabel(it.tag) + '</span>'
          +   '</label>'
          +   (it.d ? '<div class="d">' + it.d + '</div>' : '')
          + '</div></div>';
      }).join('');

      return '<section class="panel">'
        + '<div class="panel-head group-head">'
        +   '<h2>' + g.title + '</h2>'
        +   '<span class="meta" id="meta-' + g.id + '"></span>'
        + '</div>'
        + '<div class="panel-body">'
        +   (g.note ? '<p class="hint">' + g.note + '</p>' : '')
        +   items
        + '</div></section>';
    }).join('');
  }

  function tagLabel(tag) {
    return { need: '必帶', must: '必辦', rec: '建議', when: '有時限', info: '須知' }[tag] || tag;
  }

  function refresh() {
    var total = 0, done = 0;

    GROUPS.forEach(function (g) {
      var gt = g.items.length, gd = 0;
      g.items.forEach(function (it) {
        var cb = document.getElementById('cb-' + g.id + '-' + it.id);
        if (cb && cb.checked) gd++;
      });
      total += gt; done += gd;

      var meta = document.getElementById('meta-' + g.id);
      meta.textContent = gd + ' / ' + gt;
      meta.classList.toggle('done', gd === gt);
    });

    var pct = total ? Math.round(done / total * 100) : 0;
    $('#pct').textContent = pct + '%';
    $('#count').textContent = '（' + done + ' / ' + total + '）';
    $('#bar').style.width = pct + '%';
  }

  function bind() {
    GROUPS.forEach(function (g) {
      g.items.forEach(function (it) {
        var cb = document.getElementById('cb-' + g.id + '-' + it.id);
        if (!cb) return;
        cb.checked = store.get(KEY(g.id, it.id), '0') === '1';
        document.getElementById('item-' + g.id + '-' + it.id)
          .classList.toggle('checked', cb.checked);

        cb.addEventListener('change', function () {
          store.set(KEY(g.id, it.id), cb.checked ? '1' : '0');
          document.getElementById('item-' + g.id + '-' + it.id)
            .classList.toggle('checked', cb.checked);
          refresh();
        });
      });
    });
  }

  window.uncheckAll = function () {
    if (!confirm('確定要取消所有勾選嗎？')) return;
    GROUPS.forEach(function (g) {
      g.items.forEach(function (it) {
        var cb = document.getElementById('cb-' + g.id + '-' + it.id);
        if (cb) cb.checked = false;
        store.del(KEY(g.id, it.id));
        document.getElementById('item-' + g.id + '-' + it.id).classList.remove('checked');
      });
    });
    refresh();
  };

  build();
  bind();
  refresh();
  if (window.applyHero) window.applyHero(ASSETS + 'hero/');
})();
