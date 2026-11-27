package com.fhcpeboard.air6local

import android.content.Context
import android.content.SharedPreferences

/** 对应 AndroidCore 的 kcGet/kcSet/kcRemove（SharedPreferences 持久化）。 */
object Store {
    private const val PREF = "fhcpe_kv"
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    }

    fun get(key: String): String = prefs?.getString(key, "") ?: ""

    fun set(key: String, value: String) {
        prefs?.edit()?.putString(key, value)?.apply()
    }

    fun remove(key: String) {
        prefs?.edit()?.remove(key)?.apply()
    }

    fun clear() {
        prefs?.edit()?.clear()?.apply()
    }
}
