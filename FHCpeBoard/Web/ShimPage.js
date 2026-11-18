/*
 * ShimPage.js — 注入到可见页面（fhcpeweb.html 及其注入脚本）的垫片。
 *
 * 可见页对原生层的依赖只有 AndroidBoard：UI 动作通过 postMessage 回到隐藏的
 * 运行时页面（对应 Android 的 AndroidBoard.postMessage → __onPageMessage），
 * 全部网络与存储都发生在运行时页面，这里不直接发起请求。
 */
(function () {
  'use strict';
  if (window.__FHCpeIOSPage__) return;
  window.__FHCpeIOSPage__ = true;

  var WIFI = {};
  try { WIFI = Object.assign({}, window.__IOS_WIFI || {}); } catch (e) { WIFI = {}; }

  function post(payload) {
    try { window.webkit.messageHandlers.fhcpe.postMessage(payload); } catch (e) { /* ignore */ }
  }

  window.AndroidBoard = {
    /* lan_ui.js 用它给 <html data-native-ui> 打标记，css 里有 23 处对应的选择器。 */
    uiFlavor: function () { return 'coui'; },
    postMessage: function (json) {
      post({ kind: 'post', json: String(json || '{}') });
    },
    wifiCacheGet: function (scope) {
      var key = String(scope);
      return Object.prototype.hasOwnProperty.call(WIFI, key) ? String(WIFI[key]) : 'null';
    },
    wifiCacheSet: function (scope, json) {
      var key = String(scope);
      WIFI[key] = String(json);
      post({ kind: 'wificacheset', scope: key, json: WIFI[key] });
    }
  };

  /* 可见页脚本不直接使用 AndroidCore，留一组空实现兜底。 */
  window.AndroidCore = {
    kcGet: function () { return ''; },
    kcSet: function () {},
    kcRemove: function () {},
    assetRead: function () { return ''; },
    log: function () {}
  };
})();
