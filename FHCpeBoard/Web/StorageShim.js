/*
 * StorageShim.js — localStorage / sessionStorage 的持久化垫片。
 *
 * 原页面有 19 处用到 Web 存储（主题、壁纸分片、短信卡片视图状态等）。WKWebView 里
 * 自定义 scheme（app://）属于 opaque origin，直接访问 window.localStorage 会抛
 * SecurityError，导致注入的 UI 脚本在启动时就挂掉。
 *
 * 这里用 Proxy 把它接到原生 KV 上（与 AndroidCore.kc* 共用同一份持久化存储），
 * 写入做了 250ms 合并，避免壁纸分片那种高频写产生大量桥消息。
 */
(function () {
  'use strict';
  if (window.__FHCpeStorage__) return;
  window.__FHCpeStorage__ = true;

  var STORE_KEY = 'LOCAL_STORAGE_V1';
  var data = {};
  try {
    var seed = window.__IOS_LS;
    if (seed && typeof seed === 'object') {
      for (var key in seed) {
        if (Object.prototype.hasOwnProperty.call(seed, key)) data[key] = String(seed[key]);
      }
    }
  } catch (e) { data = {}; }

  var flushTimer = null;

  function persist() {
    if (flushTimer) return;
    flushTimer = setTimeout(function () {
      flushTimer = null;
      try {
        window.webkit.messageHandlers.fhcpe.postMessage({
          kind: 'lssave',
          json: JSON.stringify(data)
        });
      } catch (e) { /* 无桥接时静默降级为纯内存 */ }
    }, 250);
  }

  function has(key) { return Object.prototype.hasOwnProperty.call(data, key); }

  function createStorage() {
    var api = {
      getItem: function (key) {
        key = String(key);
        return has(key) ? data[key] : null;
      },
      setItem: function (key, value) {
        data[String(key)] = String(value);
        persist();
      },
      removeItem: function (key) {
        delete data[String(key)];
        persist();
      },
      clear: function () {
        data = {};
        persist();
      },
      key: function (index) {
        var keys = Object.keys(data);
        var i = Number(index);
        return i >= 0 && i < keys.length ? keys[i] : null;
      }
    };

    Object.defineProperty(api, 'length', {
      get: function () { return Object.keys(data).length; },
      configurable: true
    });

    return new Proxy(api, {
      get: function (target, property) {
        if (property in target) return target[property];
        if (typeof property === 'string' && has(property)) return data[property];
        return undefined;
      },
      set: function (target, property, value) {
        if (typeof property === 'string') {
          if (property in target) { target[property] = value; return true; }
          data[property] = String(value);
          persist();
        }
        return true;
      },
      has: function (target, property) {
        return property in target || (typeof property === 'string' && has(property));
      },
      deleteProperty: function (target, property) {
        if (typeof property === 'string' && has(property)) {
          delete data[property];
          persist();
        }
        return true;
      },
      ownKeys: function () { return Object.keys(data); },
      getOwnPropertyDescriptor: function (target, property) {
        if (typeof property === 'string' && has(property)) {
          return { value: data[property], enumerable: true, configurable: true, writable: true };
        }
        return Object.getOwnPropertyDescriptor(target, property);
      }
    });
  }

  function install(name) {
    try {
      Object.defineProperty(window, name, {
        value: createStorage(),
        configurable: true,
        enumerable: false,
        writable: false
      });
    } catch (e) {
      /* 某些 WebKit 版本上 localStorage 不可重定义，保留原生实现 */
    }
  }

  install('localStorage');
  install('sessionStorage');
})();
