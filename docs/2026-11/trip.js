/* 2026 年 11 月這趟（11/14～11/22，9 天 8 夜，8 位大人＋1 位小孩）的設定。
 * 這趟各頁共用的程式（docs/assets/*.js）靠 window.TRIP 分辨是哪一趟。
 */
window.TRIP = {
  id: '2026-11',
  name: '東京秋季家族之旅 2026',
  /* localStorage 的 key 前面加上這趟的 id：記帳、勾選、地圖方案各趟分開存 */
  key: function (k) { return '2026-11:' + k; }
};
