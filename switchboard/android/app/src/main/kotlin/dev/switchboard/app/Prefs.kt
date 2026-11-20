package dev.switchboard.app

import android.content.Context

/** Small settings store. Token lives in app-private storage (no backup). */
class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("switchboard", Context.MODE_PRIVATE)

    var url: String
        get() = p.getString("url", "") ?: ""
        set(v) = p.edit().putString("url", v.trim().trimEnd('/')).apply()

    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v.trim()).apply()

    val configured get() = url.isNotBlank() && token.isNotBlank()

    /** "all" = every message to you, "flagged" = only ones sent with speak=true, "off". */
    var speakMode: String
        get() = p.getString("speakMode", "flagged") ?: "flagged"
        set(v) = p.edit().putString("speakMode", v).apply()

    var speechRate: Float
        get() = p.getFloat("speechRate", 1.1f)
        set(v) = p.edit().putFloat("speechRate", v).apply()

    /** Who push-to-talk speaks to. "" = the orchestrator. */
    var target: String
        get() = p.getString("target", "") ?: ""
        set(v) = p.edit().putString("target", v).apply()

    var autoUpdate: Boolean
        get() = p.getBoolean("autoUpdate", true)
        set(v) = p.edit().putBoolean("autoUpdate", v).apply()

    /** Last version this install ran, to announce "updated to …" once. */
    var lastRunVersion: Int
        get() = p.getInt("lastRunVersion", 0)
        set(v) = p.edit().putInt("lastRunVersion", v).apply()
}
