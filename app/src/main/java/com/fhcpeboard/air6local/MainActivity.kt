package com.fhcpeboard.air6local

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity

/**
 * 双 WebView 宿主，与原 APK 结构一一对应：
 *
 *   runtime（不可见）加载 file:///android_asset/core.html
 *     ├─ AndroidCore / AndroidBoard 桥接
 *     ├─ 协议栈 + 轮询 + boot()
 *     └─ boot() 拼好 UI HTML -> AndroidCore.loadHTML
 *            ▼
 *   page（可见）loadDataWithBaseURL(拼好的 fhcpeweb.html)
 *     └─ AndroidBoard.postMessage -> runtime.__onPageMessage
 *
 * 预置：默认登录配置 192.168.99.1 / root / password，fhLine='air6'。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var runtime: WebView
    private lateinit var page: WebView
    private lateinit var bridge: Bridge
    private var pendingLoadId: String? = null

    companion object {
        private const val TAG = "FHCpeBoard"
        private const val VERSION = "1.4.3-local-52"
        // 默认设备配置（AIR6 / QWRT / LuCI）
        private const val DEFAULT_HOST = "http://192.168.99.1"
        private const val DEFAULT_USER = "root"
        private const val DEFAULT_PASS = "password"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Store.init(this)
        PersistentCookieJar.init(this)
        seedDefaultProfile()

        bridge = Bridge(this, VERSION)

        // 运行时 WebView（不可见，承载 core.html）
        runtime = WebView(this).apply {
            setupSettings()
            visibility = View.INVISIBLE
        }
        // 可见 WebView
        page = WebView(this).apply {
            setupSettings()
        }

        bridge.runtimeWebView = runtime
        bridge.pageWebView = page

        runtime.addJavascriptInterface(bridge.Core(), "AndroidCore")
        runtime.addJavascriptInterface(bridge.Board(), "AndroidBoard")
        page.addJavascriptInterface(bridge.Core(), "AndroidCore")
        page.addJavascriptInterface(bridge.Board(), "AndroidBoard")

        bridge.onLoadHTML = { id, html ->
            pendingLoadId = id
            page.loadDataWithBaseURL(
                DEFAULT_HOST + "/",
                html,
                "text/html",
                "utf-8",
                null
            )
        }

        val root = FrameLayout(this).apply {
            addView(runtime, FrameLayout.LayoutParams(1, 1))
            addView(page, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
        }
        setContentView(root)

        runtime.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "runtime loaded: $url")
            }
            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                Log.w(TAG, "runtime error: ${error?.description}")
            }
        }
        page.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // loadHTML 完成后回执给 runtime，让 boot() 继续
                pendingLoadId?.let { id ->
                    callRuntimeNativeDone(id, "true")
                    pendingLoadId = null
                }
            }
        }

        WebView.setWebContentsDebuggingEnabled(true)
        runtime.loadUrl("file:///android_asset/core.html")
    }

    private fun callRuntimeNativeDone(id: String, result: String) {
        val payload = org.json.JSONObject().put("id", id).put("result", result).toString()
        runtime.evaluateJavascript("window.__nativeDone($payload);", null)
    }

    /** 首次启动写入默认设备配置；不覆盖用户已保存的配置。 */
    private fun seedDefaultProfile() {
        try {
            val key = "LAN_PROFILES_V1"   // lan_runtime.js 的 STORE 常量
            val existing = Store.get(key)
            val parsed = try { org.json.JSONObject(existing) } catch (_: Exception) { org.json.JSONObject() }
            val profiles = parsed.optJSONArray("profiles")
            if (profiles == null || profiles.length() == 0) {
                val profile = org.json.JSONObject().apply {
                    put("id", "air6-default")
                    put("name", "AIR6 本地")
                    put("nameCustom", false)
                    put("host", DEFAULT_HOST)
                    put("username", DEFAULT_USER)
                    put("password", DEFAULT_PASS)
                    put("fhLine", "air6")   // 强制走 AIR6/LuCI 线路，跳过光纤探测
                    put("refresh", true)
                    put("refreshSec", 3)
                    put("reconnect", true)
                    put("autoLogin", true)
                    put("verified", false)
                    put("authSchema", 2)
                }
                val root = org.json.JSONObject().apply {
                    put("profiles", org.json.JSONArray().put(profile))
                    put("activeId", "air6-default")
                }
                Store.set(key, root.toString())
                Log.i(TAG, "seeded default AIR6 profile -> $DEFAULT_HOST")
            }
        } catch (e: Exception) {
            Log.w(TAG, "seedDefaultProfile failed: ${e.message}")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun WebView.setupSettings() {
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_NO_CACHE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                mediaPlaybackRequiresUserGesture = false
            }
        }
        setBackgroundColor(Color.WHITE)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 让页面自己处理返回（弹窗关闭等），不直接退出
        page.evaluateJavascript(
            "(typeof window.__onBack==='function') && window.__onBack();", null
        )
    }
}
