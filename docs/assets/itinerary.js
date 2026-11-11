/* 行程表（兩趟旅行共用）：逐日切換、方案輪播、複製這天行程、日文地名、主題、離線。
 * 頁面 docs/<trip>/final/index.html 先載入 ../trip.js，再載入本檔；sw.js 留在各趟自己的資料夾
 */

  (function () {
    'use strict';

    /* 這趟旅行的 localStorage key（見 ../trip.js）：兩趟的資料分開存，不會互相覆蓋 */
    var K = (window.TRIP && window.TRIP.key) || function (k) { return k; };

    // localStorage 在無痕視窗／封鎖 cookie 時會丟例外，全部包起來
    var store = {
      get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
      del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
    };

    /* ---------- 日期切換 ---------- */
    var TOTAL_DAYS = document.querySelectorAll('.day-section').length;   // 天數依頁面上的 .day-section 決定
    var currentDay = 1;   // 鍵盤、滑動、複製功能都會讀這個值

    /* 日期列在版面中的原始位置。它是 sticky，捲下去之後自己量到的 top 永遠是 0，
       所以改量它前一個元素（航班列）的底邊。無條件進位，免得頂端露出一條航班列 */
    function navHomeY() {
      var nav = document.getElementById('dayNav');
      var prev = nav && nav.previousElementSibling;
      return prev ? Math.ceil(prev.getBoundingClientRect().bottom + window.scrollY) : 0;
    }

    /* 浮動的「☔」按鈕（.rain-fab）：只在有備案的那幾天顯示。
       頁面上寫 data-days='{"5":"../rain/index.html#day-1", …}'，key 是這頁的 Day 編號、值是要跳去的網址；
       沒有對應的那一天就隱藏。雨天備案頁用同一個機制跳回主行程表（使用者 2026-11-10 要求） */
    function updateAltFab(n) {
      var fab = document.querySelector('.rain-fab');
      if (!fab) return;
      var map = {};
      try { map = JSON.parse(fab.getAttribute('data-days') || '{}'); } catch (e) { map = {}; }
      var href = map[String(n)];
      fab.hidden = !href;
      if (href) fab.setAttribute('href', href);
    }

    /* 日期列的實際高度寫進 CSS 變數，給 .day-section 的 scroll-margin-top 用（見 styles.css） */
    function syncNavHeight() {
      var nav = document.getElementById('dayNav');
      // 用 getBoundingClientRect 而不是 offsetHeight：後者會四捨五入（61.6 → 62），頂端會露出一條航班列
      if (nav) document.documentElement.style.setProperty('--nav-h', nav.getBoundingClientRect().height + 'px');
    }

    /* opts.noScroll：只切換、不捲動（第一次載入時用） */
    window.showDay = function (n, opts) {
      n = Math.min(Math.max(parseInt(n, 10) || 1, 1), TOTAL_DAYS);
      currentDay = n;
      document.querySelectorAll('.day-section').forEach(function (el) { el.classList.remove('active'); });
      var target = document.getElementById('day-' + n);
      if (target) target.classList.add('active');

      document.querySelectorAll('.day-nav button').forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      var navBtn = document.getElementById('nav-' + n);
      if (navBtn) { navBtn.classList.add('active'); navBtn.setAttribute('aria-selected', 'true'); }

      store.set(K('lastDay'), String(n));
      updateAltFab(n);

      // 切到別天時，方案輪播撐開的頁尾墊片就沒有意義了，收回去免得多一塊空白
      var slackEl = document.querySelector('.scroll-slack');
      if (slackEl) slackEl.style.height = '0px';

      /* 換天後回到「日期列貼齊畫面頂端」的位置，不要整頁跳回最上面：
         頁首照片不必每換一天就重看一次，新的一天直接從第一個項目開始。
         本來就停在日期列上方（頁首還看得到）時不動，工具列的「複製這天行程」才不會被捲走。 */
      if (opts && opts.noScroll) return;
      var home = navHomeY();
      if (window.scrollY > home) {
        /* 換天等於換一頁，內容已經整個換掉，不需要捲動動畫（html 預設是 smooth） */
        var root = document.documentElement;
        var prevBehavior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(0, home);
        root.style.scrollBehavior = prevBehavior;
      }
    };

    /* 決定初始顯示哪一天：網址 #day-N > 今天的日期 > 上次瀏覽的那天。
       第一次載入不主動捲動：沒有 #day-N 就停在頁首；有的話瀏覽器會自己捲到那一天
       （.day-section 的 scroll-margin-top 讓它停在日期列貼齊頂端的位置）。
       之後網址 hash 改變（hashchange，會帶事件物件進來）就和點日期按鈕一樣處理。 */
    function initDay(e) {
      var opts = e ? null : { noScroll: true };
      var fromHash = (location.hash.match(/^#day-(\d+)$/) || [])[1];
      if (fromHash && document.getElementById('day-' + fromHash)) {
        window.showDay(fromHash, opts);
        return;
      }

      var today = new Date();
      var iso = today.getFullYear() + '-' +
                String(today.getMonth() + 1).padStart(2, '0') + '-' +
                String(today.getDate()).padStart(2, '0');
      var match = document.querySelector('.day-section[data-date="' + iso + '"]');
      if (match) { window.showDay(match.id.replace('day-', ''), opts); return; }

      window.showDay(store.get(K('lastDay'), '1'), opts);
    }

    /* 從地圖頁點「看這天的行程」回來時，網址只變 hash 不會重載，要手動切換 */
    window.addEventListener('hashchange', initDay);

    /* 在日期列標出「今天」，旅途中一眼看到自己在第幾天 */
    function markToday() {
      var today = new Date();
      var iso = today.getFullYear() + '-' +
                String(today.getMonth() + 1).padStart(2, '0') + '-' +
                String(today.getDate()).padStart(2, '0');
      var sec = document.querySelector('.day-section[data-date="' + iso + '"]');
      if (!sec) return;
      var btn = document.getElementById('nav-' + sec.id.replace('day-', ''));
      if (btn) { btn.classList.add('is-today'); btn.title = '今天'; }
    }

    /* 左右方向鍵切換日期 */
    document.addEventListener('keydown', function (e) {
      // e.target 可能是 document（沒有 matches），所以要先確認是元素
      var t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && currentDay > 1) { window.showDay(currentDay - 1); }
      else if (e.key === 'ArrowRight' && currentDay < TOTAL_DAYS) { window.showDay(currentDay + 1); }
    });

    /* 手機左右滑動切換日期 */
    (function enableSwipe() {
      var x0 = null, y0 = null;
      var main = document.querySelector('main');

      main.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) { x0 = null; return; }
        // 手指落在方案輪播或照片列裡 → 那是切換方案／捲動照片的手勢，不要拿來換日期
        if (e.target instanceof Element && e.target.closest('.plans, .spot-photos')) { x0 = null; return; }
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
      }, { passive: true });

      main.addEventListener('touchend', function (e) {
        if (x0 === null) return;
        var dx = e.changedTouches[0].clientX - x0;
        var dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        // 橫向位移夠大、且明顯大於縱向，才算換頁（避免干擾正常上下捲動）
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
        if (dx < 0 && currentDay < TOTAL_DAYS) window.showDay(currentDay + 1);
        else if (dx > 0 && currentDay > 1) window.showDay(currentDay - 1);
      }, { passive: true });
    })();

    /* ---------- 餐飲建議收合（.is-suggest）---------- */
    /* 餐飲彈性卡的方案都是 AI 的建議：預設收起，點標題列或收合列才展開 */
    function setSuggest(item, collapsed) {
      item.classList.toggle('is-collapsed', collapsed);
      var btn = item.querySelector('.sugg-toggle');
      if (!btn) return;
      btn.setAttribute('aria-expanded', String(!collapsed));
      var arrow = btn.querySelector('.sugg-arrow');
      if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
    }

    function syncSuggestAll() {
      var btn = document.getElementById('suggToggle');
      if (!btn) return;
      var anyCollapsed = !!document.querySelector('.timeline-item.is-suggest.is-collapsed');
      btn.textContent = anyCollapsed ? '💡 展開建議' : '💡 收起建議';
    }

    window.toggleAllSuggest = function () {
      var sec = document.getElementById('day-' + currentDay);
      var items = (sec || document).querySelectorAll('.timeline-item.is-suggest');
      var anyCollapsed = Array.prototype.some.call(items, function (it) { return it.classList.contains('is-collapsed'); });
      items.forEach(function (it) { setSuggest(it, !anyCollapsed); });
      syncSuggestAll();
    };

    function initSuggest(root) {
      var scope = root || document;
      var items = scope.querySelectorAll('.timeline-item.is-suggest');
      items.forEach(function (item) {
        if (item.dataset.suggReady) return;
        item.dataset.suggReady = '1';
        var header = item.querySelector('.tl-header');
        if (!header) return;
        var n = item.querySelectorAll('.plan').length;
        var first = item.querySelector('.plan .plan-title');
        var name = first ? first.textContent.replace(/^[^｜]*｜/, '').trim() : '';

        var kind = header.querySelector('.tl-kind');
        var tag = document.createElement('span');
        tag.className = 'tl-sugg';
        tag.textContent = '💡 建議';
        header.insertBefore(tag, kind);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sugg-toggle';
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span class="sugg-arrow">▸</span><span class="sugg-text"></span>';
        btn.querySelector('.sugg-text').textContent =
          n + ' 個建議' + (name ? '（A：' + name + '）' : '') + '，點開看';
        header.parentNode.insertBefore(btn, header.nextSibling);

        btn.addEventListener('click', function () {
          setSuggest(item, !item.classList.contains('is-collapsed'));
          syncSuggestAll();
        });
        header.addEventListener('click', function (e) {
          if (e.target.closest('a, button')) return;
          setSuggest(item, !item.classList.contains('is-collapsed'));
          syncSuggestAll();
        });
        setSuggest(item, true);
      });

      if (items.length && !document.getElementById('suggToggle')) {
        var sb = document.createElement('button');
        sb.id = 'suggToggle';
        sb.type = 'button';
        sb.setAttribute('onclick', 'toggleAllSuggest()');
        sb.textContent = '💡 展開建議';
        var copyBtn = document.getElementById('copyDayBtn');
        if (copyBtn) copyBtn.parentNode.insertBefore(sb, copyBtn);
      }
      syncSuggestAll();
    }

    /* 列印要看到全部內容：印之前全部展開，印完還原 */
    window.addEventListener('beforeprint', function () {
      document.querySelectorAll('.timeline-item.is-suggest').forEach(function (it) {
        it.dataset.wasCollapsed = it.classList.contains('is-collapsed') ? '1' : '';
        setSuggest(it, false);
      });
    });
    window.addEventListener('afterprint', function () {
      document.querySelectorAll('.timeline-item.is-suggest').forEach(function (it) {
        setSuggest(it, it.dataset.wasCollapsed === '1');
      });
      syncSuggestAll();
    });

    /* 把當天行程複製成純文字，方便貼給旅伴 */
    window.copyDay = function () {
      var sec = document.getElementById('day-' + currentDay);
      if (!sec) return;

      var lines = [sec.querySelector('.day-info h2').textContent.trim()
                 + '｜' + sec.querySelector('.date-str').textContent.trim()];

      function itemLines(item, indent) {
        var time = (item.querySelector('.tl-time') || {}).textContent || '';
        var titleEl = item.querySelector('.tl-title');
        if (!titleEl) return;
        var clone = titleEl.cloneNode(true);
        var ja = clone.querySelector('.ja-name');
        var jaText = ja ? ja.textContent.trim() : '';
        if (ja) ja.remove();
        lines.push(indent + (time.trim() ? time.trim() + '  ' : '') + clone.textContent.trim()
                 + (jaText ? '（' + jaText + '）' : ''));

        /* 主行程的計畫B 也一起帶上，旅伴才知道下雨時的備案 */
        var alt = item.querySelector('.alt-plan .ap-name');
        if (alt) {
          var altClone = alt.cloneNode(true);
          var altJa = altClone.querySelector('.ja-name');
          var altJaText = altJa ? altJa.textContent.trim() : '';
          if (altJa) altJa.remove();
          lines.push(indent + '　　└ ' + altClone.textContent.trim() + (altJaText ? '（' + altJaText + '）' : ''));
        }
      }

      /* 分頭行動：「看：全部」時兩條線都列，並標出誰；只看一個人時只列那條線 */
      var who = document.body.getAttribute('data-who') || 'all';
      var tl = sec.querySelector('.timeline');
      Array.prototype.forEach.call(tl ? tl.children : [], function (el) {
        if (el.classList.contains('timeline-item')) { itemLines(el, ''); return; }
        /* 依天氣二選一：兩邊都列，標出是哪一邊 */
        if (el.classList.contains('branch')) {
          el.querySelectorAll('.branch-panel').forEach(function (p) {
            var label = p.querySelector('.branch-label');
            lines.push('〔' + (label ? label.textContent.trim() : '') + '〕');
            p.querySelectorAll('.timeline-item').forEach(function (item) { itemLines(item, '　'); });
          });
          return;
        }
        if (!el.classList.contains('split')) return;
        var head = el.querySelector('.split-head');
        var lanes = el.querySelectorAll('.lane');
        if (who === 'all') {
          lines.push('── ' + (head ? head.textContent.replace(/\s+/g, ' ').trim() : '分頭行動') + ' ──');
          lanes.forEach(function (lane) {
            lines.push('〔' + laneName(lane) + '〕');
            lane.querySelectorAll('.timeline-item').forEach(function (item) { itemLines(item, '　'); });
          });
          lines.push('── 分頭行動結束 ──');
        } else {
          lanes.forEach(function (lane) {
            if (lane.dataset.who !== who) return;
            lane.querySelectorAll('.timeline-item').forEach(function (item) { itemLines(item, ''); });
          });
        }
      });

      var text = lines.join('\n');
      var btn = document.getElementById('copyDayBtn');
      var done = function (ok) {
        btn.textContent = ok ? '✅ 已複製' : '⚠️ 複製失敗';
        setTimeout(function () { btn.textContent = '📋 複製這天行程'; }, 2000);
      };

      // 舊瀏覽器、非安全來源，或 Clipboard API 被擋下時的退路
      function legacyCopy() {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
        document.body.removeChild(ta);
        return ok;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function () { done(true); })
          .catch(function () { done(legacyCopy()); });
      } else {
        done(legacyCopy());
      }
    };

    /* ---------- 日文地名 ---------- */
    window.toggleJa = function () {
      var on = document.body.classList.toggle('show-ja');
      var btn = document.getElementById('jaToggle');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? '🇯🇵 隱藏日文地名' : '🇯🇵 顯示日文地名';
      store.set('showJa', on ? '1' : '0');
    };

    /* ---------- 主題：自動 → 淺色 → 深色 ---------- */
    var THEMES = ['auto', 'light', 'dark'];
    var THEME_LABEL = { auto: '🌗 主題：自動', light: '☀️ 主題：淺色', dark: '🌙 主題：深色' };

    function applyTheme(t) {
      if (t === 'auto') { document.documentElement.removeAttribute('data-theme'); }
      else { document.documentElement.setAttribute('data-theme', t); }
      document.getElementById('themeToggle').textContent = THEME_LABEL[t];
      store.set('theme', t);
    }

    window.cycleTheme = function () {
      var cur = store.get('theme', 'auto');
      applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
    };

    /* 預算追蹤已移至獨立頁面 ../budget/（依每日分開記帳） */
    /* ---------- 彈性行程的方案輪播 ---------- */

    /* 頁尾墊片：見 go() 裡的說明。只有在捲到底又切換方案時才會被撐開。 */
    var slackEl = null;
    var lastSelfScroll = 0;

    function slack() {
      if (slackEl) return slackEl;
      slackEl = document.createElement('div');
      slackEl.className = 'scroll-slack';
      slackEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(slackEl);
      window.addEventListener('scroll', function () {
        // 自己補正造成的捲動不算，使用者真的捲動才把墊片收掉
        if (Date.now() - lastSelfScroll < 300) return;
        if (slackEl.style.height && slackEl.style.height !== '0px') slackEl.style.height = '0px';
      }, { passive: true });
      return slackEl;
    }

    function initPlans(root) {
      (root || document).querySelectorAll('[data-plans]').forEach(function (box) {
        if (box.dataset.ready) return;
        box.dataset.ready = '1';

        var track = box.querySelector('.plans-track');
        var panes = box.querySelectorAll('.plan');
        var dots = box.querySelectorAll('.plan-dot');
        var arrows = box.querySelectorAll('.plan-arrow');
        var nav = box.querySelector('.plans-nav');
        var n = panes.length;
        var cur = 0;

        /* 方案各自帶標題與 emoji，切換時要一起換掉時間軸的抬頭，
           否則會出現「標題寫木津市場、內容是黑門市場」這種對不起來的狀況 */
        var item = box.closest('.timeline-item');
        var titleEl = item && item.querySelector('.tl-title');
        var iconEl = item && item.querySelector('.tl-icon');
        var planChip = item && item.querySelector('.tl-plan');

        /* 只切 class，不做任何高度計算 —— 在 display:none 的分頁裡也不會出錯 */
        function go(i, noAnchor) {
          /* 方案長短不同會改變整份文件的高度。使用者若捲在接近頁尾處，
             瀏覽器會夾住捲動位置，導覽列就從游標底下跑掉，下一次點擊必定落空。
             先記下導覽列現在在螢幕上的位置，切換完再把差值捲回來。 */
          var anchorTop = (!noAnchor && nav && box.offsetParent) ? nav.getBoundingClientRect().top : null;

          cur = Math.min(Math.max(i, 0), n - 1);
          panes.forEach(function (pn, k) {
            pn.classList.toggle('is-active', k === cur);
            pn.setAttribute('aria-hidden', String(k !== cur));
          });
          dots.forEach(function (d, k) {
            d.classList.toggle('active', k === cur);
            d.setAttribute('aria-selected', String(k === cur));
          });
          arrows.forEach(function (a) {
            var dir = +a.dataset.dir;
            a.disabled = (dir < 0 && cur === 0) || (dir > 0 && cur === n - 1);
          });

          /* 抬頭跟著換：標題（含日文地名）、emoji、A/B/C 指示 */
          var src = panes[cur].querySelector('.plan-title');
          if (titleEl && src) titleEl.innerHTML = src.innerHTML;
          if (iconEl && panes[cur].dataset.icon) iconEl.textContent = panes[cur].dataset.icon;
          if (planChip) {
            planChip.textContent = String.fromCharCode(65 + cur);
            planChip.classList.toggle('is-alt', cur > 0);
          }

          if (anchorTop !== null) {
            /* 把導覽列捲回原本的螢幕位置。回傳還差多少。 */
            var pull = function () {
              var delta = nav.getBoundingClientRect().top - anchorTop;
              if (!delta) return 0;
              /* html 有 scroll-behavior: smooth，這裡要的是瞬間補正，先暫時關掉 */
              var root = document.documentElement;
              var prevBehavior = root.style.scrollBehavior;
              root.style.scrollBehavior = 'auto';
              lastSelfScroll = Date.now();
              window.scrollBy(0, delta);
              root.style.scrollBehavior = prevBehavior;
              return nav.getBoundingClientRect().top - anchorTop;
            };

            var shortBy = pull();
            if (shortBy) {
              /* 已經捲到底、再也捲不動 —— 在頁尾墊出空間，把距離還回來 */
              var el = slack();
              var h = Math.min((parseFloat(el.style.height) || 0) + Math.abs(shortBy), 600);
              el.style.height = h + 'px';
              pull();
            }
          }
        }

        dots.forEach(function (d) {
          d.addEventListener('click', function () { go(+d.dataset.i); });
        });

        arrows.forEach(function (a) {
          a.addEventListener('click', function () { go(cur + (+a.dataset.dir)); });
        });

        /* 區塊內左右滑動切換方案。門檻 40px，比日期滑動的 70px 低，
           因為這是小範圍的元件手勢。 */
        var sx = null, sy = null;
        box.addEventListener('touchstart', function (e) {
          if (e.touches.length !== 1) { sx = null; return; }
          sx = e.touches[0].clientX;
          sy = e.touches[0].clientY;
        }, { passive: true });

        box.addEventListener('touchend', function (e) {
          if (sx === null) return;
          var dx = e.changedTouches[0].clientX - sx;
          var dy = e.changedTouches[0].clientY - sy;
          sx = null;
          if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          go(cur + (dx < 0 ? 1 : -1));
        }, { passive: true });

        /* 桌機：滑鼠拖曳也能切換 */
        var mx = null;
        box.addEventListener('mousedown', function (e) {
          if (e.target.closest('a, button')) return;
          mx = e.clientX;
        });
        box.addEventListener('mouseup', function (e) {
          if (mx === null) return;
          var dx = e.clientX - mx;
          mx = null;
          if (Math.abs(dx) < 50) return;
          go(cur + (dx < 0 ? 1 : -1));
        });

        go(0, true);
      });
    }


    /* ---------- 分頭行動：家人／獨旅兩條線 ----------
       2026-11-05 使用者說 2027-02 有一部分會自己獨旅、和家人的行程不一樣。
       時間軸裡用 .split 包住分開的那一段，裡面兩個 .lane（data-who="family"／"solo"），
       各自放一般的時間軸項目（主行程、交通、彈性都可以）。寫法見 templates/itinerary-snippets.html。
       頁面上有 .split 才會在工具列多一個「👥 看：全部／家人／獨旅」，選擇存在 localStorage K('who')，地圖頁也讀同一個值：
       - 全部：寬螢幕兩條線並排；手機上用區塊裡的分頁切換（只切這一個區塊）
       - 家人／獨旅：只顯示那一條線，複製這天行程也只複製那條線 */
    var WHO = ['all', 'family', 'solo'];
    var WHO_LABEL = { all: '👥 看：全部', family: '🅰 看：A 線', solo: '🅱 看：B 線' };
    var LANE_NAME = { family: '🅰 A 線', solo: '🅱 B 線' };

    function laneName(lane) {
      var label = lane.querySelector('.lane-label');
      return label ? label.textContent.trim() : (LANE_NAME[lane.dataset.who] || lane.dataset.who || '');
    }

    /* 區塊裡的分頁（手機用）：只換這一個 .split 目前顯示哪條線 */
    function setLane(sp, lane) {
      sp.dataset.lane = lane;
      sp.querySelectorAll('.split-tab').forEach(function (t) {
        var on = t.dataset.lane === lane;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      });
      sp.querySelectorAll('.lane').forEach(function (l) { l.classList.toggle('is-current', l.dataset.who === lane); });
    }

    function applyWho(w) {
      if (WHO.indexOf(w) < 0) w = 'all';
      document.body.setAttribute('data-who', w);
      var btn = document.getElementById('whoToggle');
      if (btn) btn.textContent = WHO_LABEL[w];
      store.set(K('who'), w);
      document.querySelectorAll('.split').forEach(function (sp) {
        setLane(sp, w === 'all' ? (sp.dataset.lane || 'family') : w);
      });
    }

    window.cycleWho = function () {
      var cur = document.body.getAttribute('data-who') || 'all';
      applyWho(WHO[(WHO.indexOf(cur) + 1) % WHO.length]);
    };

    function initSplits() {
      var splits = document.querySelectorAll('.split');
      if (!splits.length) return;   // 沒有分頭行動的頁面（例如 2026-09）什麼都不加
      var btn = document.getElementById('whoToggle');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'whoToggle';
        btn.type = 'button';
        btn.title = '分頭行動的時段要看誰的行程';
        btn.addEventListener('click', window.cycleWho);
        var copyBtn = document.getElementById('copyDayBtn');
        if (copyBtn) copyBtn.parentNode.insertBefore(btn, copyBtn);
      }
      splits.forEach(function (sp) {
        /* 日期列標出有分頭行動的那幾天 */
        var sec = sp.closest('.day-section');
        var nb = sec && document.getElementById('nav-' + sec.id.replace('day-', ''));
        if (nb) { nb.classList.add('has-split'); nb.title = (nb.title ? nb.title + '・' : '') + '有分頭行動'; }
        sp.querySelectorAll('.split-tab').forEach(function (t) {
          t.addEventListener('click', function () {
            /* 「看：全部」時只切這個區塊；只看一個人時，點另一個分頁就等於改看那個人 */
            if ((document.body.getAttribute('data-who') || 'all') === 'all') setLane(sp, t.dataset.lane);
            else applyWho(t.dataset.lane);
          });
        });
      });
      applyWho(store.get(K('who'), 'all'));
    }

    /* ---------- 依天氣二選一 .branch（雨天備案頁） ----------
       .branch 裡的 .branch-tabs 按鈕（data-b）切換同一塊裡的 .branch-panel（data-b），只換這一塊；
       和 .split 不同，不加工具列按鈕、不存 localStorage。列印時兩邊都印 */
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.branch-tabs button');
      if (!t) return;
      var br = t.closest('.branch');
      br.querySelectorAll('.branch-tabs button').forEach(function (x) {
        var on = x === t;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      br.querySelectorAll('.branch-panel').forEach(function (pn) { pn.classList.toggle('is-current', pn.dataset.b === t.dataset.b); });
    });

    /* ---------- 主行程的計畫B ---------- */
    /* 收合的 <details> 列印時不會印出內容：印之前全部展開，印完還原 */
    window.addEventListener('beforeprint', function () {
      document.querySelectorAll('details.alt-plan').forEach(function (d) {
        d.dataset.wasOpen = d.open ? '1' : '';
        d.open = true;
      });
    });
    window.addEventListener('afterprint', function () {
      document.querySelectorAll('details.alt-plan').forEach(function (d) {
        d.open = d.dataset.wasOpen === '1';
      });
    });

    /* ---------- 回到頂部 ---------- */
    window.addEventListener('scroll', function () {
      var btn = document.getElementById('backToTop');
      if (window.scrollY > 400) btn.classList.add('visible');
      else btn.classList.remove('visible');
    }, { passive: true });

    /* ---------- 離線狀態 ---------- */
    function syncOnline() {
      document.body.classList.toggle('is-offline', !navigator.onLine);
    }
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);

    /* ---------- 啟動 ---------- */
    applyTheme(store.get('theme', 'auto'));
    if (store.get('showJa', '0') === '1') window.toggleJa();
    markToday();
    initPlans();
    initSuggest();
    initSplits();
    syncNavHeight();   // 要在瀏覽器捲到 #day-N 之前寫好，所以放在 initDay 前面
    initDay();
    syncOnline();
    window.addEventListener('resize', syncNavHeight, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncNavHeight);   // 網路字型載入後行高可能改變

    /* Service Worker：讓整份行程可離線開啟（需 https 或 localhost） */
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
                /* 新版 Service Worker 接手後自動重新整理一次。
           沒有這段的話，改版當下已開著舊頁面的人會停在
           「新的 HTML ＋ 舊的 CSS / JS」的半舊狀態，畫面照樣是壞的。
           hadController：第一次安裝時本來就會換手，那次不需要重載。 */
        var hadController = !!navigator.serviceWorker.controller;
        var swReloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
          if (!hadController || swReloaded) return;
          swReloaded = true;
          location.reload();
        });

navigator.serviceWorker.register('sw.js').catch(function () { /* 離線快取失敗不影響閱讀 */ });
      });
    }
  })();
