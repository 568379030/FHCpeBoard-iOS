/*
 * ShimRuntime.js — 注入到隐藏运行时 WebView（core.html）的桥接垫片。
 *
 * 对应 Android 的 @JavascriptInterface 对象 AndroidCore。凡是 JS 侧要求「同步返回」
 * 的方法（kcGet / assetRead / decodeSmsPdu / nativePing）都在这里就地实现：
 * WKWebView 没有同步 JS→native 通道，异步接口则沿用 core.html 已有的
 * __fetchText / __nativeDone 回调协议，无需改动业务代码。
 */
(function () {
  'use strict';
  if (window.__FHCpeIOS__) return;
  window.__FHCpeIOS__ = true;

  var KV = {};
  try { KV = Object.assign({}, window.__IOS_KV || {}); } catch (e) { KV = {}; }

  var ASSETS = window.__IOS_ASSETS || {};
  var VERSION = window.__IOS_VERSION || '';

  function post(payload) {
    try { window.webkit.messageHandlers.fhcpe.postMessage(payload); } catch (e) { /* 预览环境无桥接 */ }
  }
  function str(value) { return value === null || value === undefined ? '' : String(value); }
  function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

  window.AndroidCore = {
    /* ---- 异步：走 __fetchText / __nativeDone 回执 ---- */
    fetch: function (id, url, options) {
      post({
        kind: 'fetch',
        id: str(id),
        url: str(url),
        options: options === null || options === undefined ? '' : str(options)
      });
    },
    evalJS: function (id, code) {
      post({ kind: 'evaljs', id: str(id), code: str(code) });
    },
    loadHTML: function (id, html) {
      post({ kind: 'loadhtml', id: str(id), html: str(html) });
    },

    /* ---- 同步 ---- */
    assetRead: function (name) {
      var value = ASSETS[str(name)];
      return typeof value === 'string' ? value : '';
    },
    kcGet: function (key) {
      key = str(key);
      return has(KV, key) ? KV[key] : '';
    },
    kcSet: function (key, value) {
      key = str(key);
      KV[key] = str(value);
      post({ kind: 'kcset', key: key, value: KV[key] });
    },
    kcRemove: function (key) {
      key = str(key);
      delete KV[key];
      post({ kind: 'kcremove', key: key });
    },
    fileRead: function () { return ''; },
    fileRemove: function () { /* 响应统一走内存文本，不落临时文件 */ },
    clearCaches: function () {
      post({ kind: 'clearcaches' });
      return 0;
    },
    clearHttpSession: function (host) {
      post({ kind: 'clearhttp', host: str(host) });
    },
    nativePing: function () {
      // nativeCore:false 会让版本号显示“兼容模式”，这是 lan_runtime.js 里
      // 本来就支持的降级路径（PDU 解码已由 SmsPdu.js 接管）。
      return JSON.stringify({ ver: VERSION, nativeCore: false, platform: 'ios' });
    },
    log: function (text) {
      post({ kind: 'log', text: str(text) });
    },
    decodeSmsPdu: function (pdu) {
      try {
        return window.__SmsPdu ? window.__SmsPdu(str(pdu)) : 'null';
      } catch (e) {
        return 'null';
      }
    }
  };

  /* 运行时页面不渲染 AndroidBoard 相关 UI，提供空实现避免 ReferenceError。 */
  window.AndroidBoard = {
    uiFlavor: function () { return 'coui'; },
    postMessage: function () {},
    wifiCacheGet: function () { return 'null'; },
    wifiCacheSet: function () {}
  };
})();
