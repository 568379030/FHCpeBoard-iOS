package com.fhcpeboard.air6local

import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.io.IOException

/**
 * JS ↔ native 桥接，等价于原 APK 的 @JavascriptInterface 对象。
 *
 * Android 的 addJavascriptInterface 是同步的，所以 assetRead / kcGet /
 * decodeSmsPdu / nativePing 都能同步返回，无需 iOS 那套注入快照垫片。
 *
 * 异步接口（fetch / evalJS / loadHTML）沿用 core.html 已有的回调协议：
 *   fetch    -> window.__fetchText(id,status,text)
 *   evalJS   -> window.__nativeDone(JSON.stringify({id,result}))
 *   loadHTML -> 由 Activity 接管，加载完成后回执
 */
class Bridge(
    private val context: Context,
    private val version: String
) {
    /** 由 Activity 设置：可见页 WebView（evalJS 在这里执行） */
    var pageWebView: WebView? = null
    /** 由 Activity 设置：运行时 WebView（承载 core.html，接收回调） */
    var runtimeWebView: WebView? = null
    /** loadHTML 交给 Activity 处理（需要操作可见 WebView） */
    var onLoadHTML: ((id: String, html: String) -> Unit)? = null

    private val assetsCache = mutableMapOf<String, String>()

    private fun runOnUi(block: () -> Unit) {
        android.os.Handler(android.os.Looper.getMainLooper()).post { block() }
    }

    private fun callRuntime(function: String, vararg args: Any) {
        val arr = org.json.JSONArray()
        args.forEach { arr.put(it) }
        val js = "$function.apply(null, $arr);"
        runOnUi { runtimeWebView?.evaluateJavascript(js, null) }
    }

    // ==================== AndroidCore ====================

    /** 暴露给 JS 的 AndroidCore 对象 */
    inner class Core {
        @JavascriptInterface
        fun fetch(id: String, url: String, optsJson: String?) {
            HttpEngine.fetch(url, optsJson) { result ->
                callRuntime("window.__fetchText", id, result.status, result.text)
            }
        }

        @JavascriptInterface
        fun evalJS(id: String, code: String) {
            // evaluateJavascript 返回的是 JSON 编码后的字符串值：
            //   JS 返回字符串 "abc" -> 回调收到 "\"abc\""
            //   JS 返回对象 {a:1}   -> 回调收到 "{\"a\":1}"
            // 由于外层已 JSON.stringify，回调值本身就是合法的 JSON 文本，
            // 直接作为 __nativeDone 的 result 字段回传即可（JS 侧会 JSON.parse）。
            val wrapped = "JSON.stringify((function(){ $code })())"
            runOnUi {
                val page = pageWebView
                if (page == null) {
                    val payload = JSONObject().put("id", id).put("result", "null").toString()
                    callRuntime("window.__nativeDone", payload)
                    return@runOnUi
                }
                page.evaluateJavascript(wrapped) { value ->
                    val result = if (value.isNullOrBlank() || value == "null") "null" else value
                    val payload = JSONObject().put("id", id).put("result", result).toString()
                    callRuntime("window.__nativeDone", payload)
                }
            }
        }

        @JavascriptInterface
        fun loadHTML(id: String, html: String) {
            runOnUi { onLoadHTML?.invoke(id, html) }
        }

        @JavascriptInterface
        fun assetRead(name: String): String {
            return assetsCache.getOrPut(name) {
                try { context.assets.open(name).bufferedReader().use { it.readText() } }
                catch (e: IOException) { Log.w(TAG, "assetRead: $name not found"); "" }
            }
        }

        @JavascriptInterface
        fun fileRead(path: String): String {
            return try {
                java.io.File(path).readText()
            } catch (_: Exception) { "" }
        }

        @JavascriptInterface
        fun fileRemove(path: String) {
            try { java.io.File(path).delete() } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun kcGet(key: String): String = Store.get(key)

        @JavascriptInterface
        fun kcSet(key: String, value: String) = Store.set(key, value)

        @JavascriptInterface
        fun kcRemove(key: String) = Store.remove(key)

        @JavascriptInterface
        fun clearCaches(): Int {
            // 只清网络缓存与会话 Cookie，保留账号配置（LAN_PROFILES_V1）。
            // 对应 UI 提示「缓存已清理，账号配置已保留」。
            HttpEngine.clearSession("")
            return 0
        }

        @JavascriptInterface
        fun clearHttpSession(host: String) {
            HttpEngine.clearSession(host)
        }

        @JavascriptInterface
        fun nativePing(): String {
            return JSONObject()
                .put("ver", version)
                .put("nativeCore", true)
                .put("platform", "android")
                .toString()
        }

        @JavascriptInterface
        fun decodeSmsPdu(pdu: String): String = SmsPdu.decode(pdu)

        @JavascriptInterface
        fun log(text: String) {
            Log.i(TAG, text)
        }
    }

    // ==================== AndroidBoard ====================

    inner class Board {
        @JavascriptInterface
        fun uiFlavor(): String = "coui"

        @JavascriptInterface
        fun postMessage(json: String) {
            // 页面侧消息回传给 runtime 的 __onPageMessage
            runOnUi {
                runtimeWebView?.evaluateJavascript(
                    "window.__onPageMessage && window.__onPageMessage($json);", null
                )
            }
        }

        @JavascriptInterface
        fun wifiCacheGet(scope: String): String = Store.get("WIFI_CACHE_$scope")

        @JavascriptInterface
        fun wifiCacheSet(scope: String, json: String) = Store.set("WIFI_CACHE_$scope", json)
    }

    companion object {
        private const val TAG = "FHCpeBoard"
    }
}
