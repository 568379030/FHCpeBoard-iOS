package com.fhcpeboard.air6local

import android.content.Context
import android.content.SharedPreferences
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import org.json.JSONObject

/**
 * 把 LuCI 的 sysauth cookie 持久化到 SharedPreferences。
 * App 重启后仍保持登录态，避免每次都重新输密码。
 */
class PersistentCookieJar : CookieJar {
    private val store = mutableMapOf<String, MutableList<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val key = url.host
        val list = store.getOrPut(key) { mutableListOf() }
        for (c in cookies) {
            list.removeAll { it.name == c.name && it.domain == c.domain && it.path == c.path }
            if (c.expiresAt > System.currentTimeMillis() || c.expiresAt == Long.MAX_VALUE) {
                list.add(c)
            } else {
                list.removeAll { it.name == c.name }
            }
        }
        persist()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        val list = store[url.host] ?: return emptyList()
        val valid = list.filter { it.expiresAt > now }
        store[url.host] = valid.toMutableList()
        return valid.filter { it.matches(url) }
    }

    fun clear(host: String) {
        if (host.isEmpty()) {
            store.clear()
        } else {
            val keys = store.keys.filter { it == host || it.contains(host) || host.contains(it) }
            keys.forEach { store.remove(it) }
        }
        persist()
    }

    private fun persist() {
        try {
            val root = JSONObject()
            for ((host, cookies) in store) {
                val arr = JSONArray()
                for (c in cookies) {
                    val o = JSONObject()
                    o.put("name", c.name)
                    o.put("value", c.value)
                    o.put("expiresAt", c.expiresAt)
                    o.put("domain", c.domain)
                    o.put("path", c.path)
                    o.put("secure", c.secure)
                    o.put("httpOnly", c.httpOnly)
                    arr.put(o)
                }
                root.put(host, arr)
            }
            prefs?.edit()?.putString(KEY, root.toString())?.apply()
        } catch (_: Exception) {}
    }

    companion object {
        private const val PREF = "fhcpe_cookies"
        private const val KEY = "jar"
        private var prefs: SharedPreferences? = null

        fun init(context: Context) {
            prefs = context.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        }

        fun create(): PersistentCookieJar {
            val jar = PersistentCookieJar()
            try {
                val raw = prefs?.getString(KEY, null) ?: return jar
                val root = JSONObject(raw)
                for (k in root.keys()) {
                    val arr = root.getJSONArray(k)
                    val list = mutableListOf<Cookie>()
                    for (i in 0 until arr.length()) {
                        val o = arr.getJSONObject(i)
                        val b = Cookie.Builder()
                            .name(o.getString("name"))
                            .value(o.getString("value"))
                            .expiresAt(o.getLong("expiresAt"))
                            .domain(o.getString("domain"))
                            .path(o.getString("path"))
                        if (o.optBoolean("secure")) b.secure()
                        if (o.optBoolean("httpOnly")) b.httpOnly()
                        try { list.add(b.build()) } catch (_: Exception) {}
                    }
                    jar.store[k] = list
                }
            } catch (_: Exception) {}
            return jar
        }
    }
}
