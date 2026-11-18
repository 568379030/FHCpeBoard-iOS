/*
 * DiagHook.js — 注入到两个 WebView，最早执行，捕获一切异常与 console 输出。
 * 真机白屏时这些信息会显示在屏幕的诊断面板上，无需连电脑。
 */
(function () {
  'use strict';
  if (window.__FHCDiag__) return;
  window.__FHCDiag__ = true;

  function send(tag, text) {
    try {
      window.webkit.messageHandlers.fhcpe.postMessage({
        kind: 'diag',
        text: '[' + tag + '] ' + String(text)
      });
    } catch (e) { /* 无桥接时忽略 */ }
  }

  window.addEventListener('error', function (e) {
    var loc = e.filename ? (' @ ' + e.filename + ':' + e.lineno) : '';
    send('error', (e.message || 'unknown error') + loc);
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var msg = r && (r.stack || r.message) || String(r);
    send('reject', msg);
  });

  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(function (a) {
        try { return typeof a === 'string' ? a : JSON.stringify(a); }
        catch (_) { return String(a); }
      }).join(' ');
      send(level, args);
      if (original) original.apply(console, arguments);
    };
  });

  // 暴露一个手动探针，便于在页面里主动上报诊断。
  window.__fhcdiag = function (text) { send('probe', text); };
})();
