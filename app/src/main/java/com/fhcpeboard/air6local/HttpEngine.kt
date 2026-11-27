package com.fhcpeboard.air6local

import android.util.Log
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class HttpResult(val status: Int, val text: String)

/**
 * 对应 iOS 版 HttpEngine / 原 APK 的 OkHttp 内核。
 *
 * 契约来自 assets/core.html 的 __nfetch：
 *   - 成功：真实 HTTP 状态码 + 响应正文
 *   - 传输失败：status=0，正文为 transportFailures 的键名，
 *     让 JS 侧沿用原有中文错误提示。
 *
 * 关键点：CookieJar 必须持久化，否则 LuCI 的 sysauth 登录态会丢。
 */
object HttpEngine {
    private const val TAG = "FHCpeBoard"

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cookieJar(PersistentCookieJar.create())
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(180, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .cache(null)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    fun fetch(urlString: String, optionsJson: String?, callback: (HttpResult) -> Unit) {
        val url = try {
            parseUrl(urlString)
        } catch (e: Exception) {
            callback(HttpResult(0, "DEVICE_ADDRESS_REJECTED")); return
        }
        if (url == null) {
            callback(HttpResult(0, "DEVICE_ADDRESS_REJECTED")); return
        }

        val opt = parseOptions(optionsJson)
        val method = (opt.optString("method", "GET")).uppercase()
        val bodyStr = if (opt.has("body") && !opt.isNull("body")) opt.getString("body") else null

        val builder = Request.Builder().url(url)
        val headers = opt.optJSONObject("headers")
        if (headers != null) {
            for (k in headers.keys()) {
                try { builder.header(k, headers.getString(k)) } catch (_: Exception) {}
            }
        }
        val body = if (bodyStr != null && method != "GET" && method != "HEAD") {
            val ct = headers?.optString("Content-Type")
            val contentType = when {
                ct.isNullOrEmpty() -> {
                    val ct2 = headers?.optString("content-type")
                    if (ct2.isNullOrEmpty()) "text/plain; charset=utf-8" else ct2
                }
                else -> ct
            }
            bodyStr.toRequestBody(contentType.toMediaTypeOrNull())
        } else null
        builder.method(method, body)

        val timeoutMs = opt.optLong("timeoutMs", 60000)
        // 用带总超时的客户端，避免设备无响应时永久挂起。
        val effectiveClient = if (timeoutMs in 3000..300000) {
            client.newBuilder().callTimeout(timeoutMs + 8000, TimeUnit.MILLISECONDS).build()
        } else client
        effectiveClient.newCall(builder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                val code = failureCode(e)
                Log.w(TAG, "fetch failed $urlString -> $code (${e.message})")
                callback(HttpResult(0, code))
            }

            override fun onResponse(call: Call, response: Response) {
                val text = response.body?.use { it.string() } ?: ""
                callback(HttpResult(response.code, text))
            }
        })
    }

    private fun parseUrl(value: String): HttpUrl? {
        val url = value.toHttpUrlOrNull() ?: return null
        val scheme = url.scheme.lowercase()
        if (scheme != "http" && scheme != "https") return null
        if (url.host.isEmpty()) return null
        if (url.username.isNotEmpty() || url.password.isNotEmpty()) return null
        return url
    }

    private fun parseOptions(json: String?): JSONObject {
        if (json.isNullOrEmpty()) return JSONObject()
        return try { JSONObject(json) } catch (_: Exception) { JSONObject() }
    }

    private fun failureCode(e: IOException): String = when {
        e.message?.contains("failed to connect", true) == true -> "DNS_FAILED"
        e.message?.contains("Unable to resolve host", true) == true -> "DNS_FAILED"
        e is java.net.SocketTimeoutException -> "NETWORK_ERROR"
        e.message?.contains("SSL", true) == true || e.message?.contains("certificate", true) == true -> "TLS_CERT_FAILED"
        else -> "NETWORK_ERROR"
    }

    /** 丢弃某设备的会话 Cookie。host 为空表示全部清除。 */
    fun clearSession(host: String) {
        val jar = client.cookieJar
        if (jar is PersistentCookieJar) jar.clear(host)
    }
}
