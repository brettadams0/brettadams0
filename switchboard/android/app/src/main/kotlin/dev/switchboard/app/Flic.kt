package dev.switchboard.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import io.flic.flic2libandroid.Flic2Button
import io.flic.flic2libandroid.Flic2ButtonListener
import io.flic.flic2libandroid.Flic2Manager
import io.flic.flic2libandroid.Flic2ScanCallback
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * A Flic 2 button as a walkie-talkie key, through Flic's own SDK so we get the
 * raw press and release (the Flic app's actions only offer click/hold).
 *
 *   hold      talk; released = send
 *   tap       stop speaking, or if nothing is playing, repeat the last message
 *
 * A button paired here is paired to this app, not to the Flic app.
 */
class Flic(private val ctx: Context, private val onDown: () -> Unit, private val onUp: (heldMs: Long) -> Unit) {
    private val manager: Flic2Manager by lazy { Flic2Manager.initAndGetInstance(ctx.applicationContext, Handler(Looper.getMainLooper())) }
    val buttons = MutableStateFlow<List<String>>(emptyList())
    val status = MutableStateFlow("")
    private var downAt = 0L

    private val listener = object : Flic2ButtonListener() {
        override fun onButtonUpOrDown(button: Flic2Button, wasQueued: Boolean, lastQueued: Boolean, timestamp: Long, isUp: Boolean, isDown: Boolean) {
            // Presses made while disconnected arrive later, queued. A stale
            // "talk" press is worse than a missed one, so drop those.
            if (wasQueued && button.readyTimestamp - timestamp > 2000) return
            if (isDown) {
                downAt = SystemClock.elapsedRealtime()
                onDown()
            } else if (isUp && downAt != 0L) {
                onUp(SystemClock.elapsedRealtime() - downAt)
                downAt = 0L
            }
        }
        override fun onReady(button: Flic2Button, timestamp: Long) = refresh("${label(button)} ready")
        override fun onDisconnect(button: Flic2Button) = refresh("${label(button)} disconnected")
        override fun onUnpaired(button: Flic2Button) = refresh("${label(button)} unpaired")
    }

    /** Connect to buttons paired earlier. Needs Bluetooth permission on Android 12+. */
    fun start() {
        try {
            for (b in manager.buttons) {
                b.removeListener(listener)
                b.addListener(listener)
                b.connect()
            }
            refresh()
        } catch (e: SecurityException) {
            status.value = "Bluetooth permission needed"
        } catch (e: Exception) {
            Log.w("Flic", "start", e)
        }
    }

    fun pair() {
        status.value = "Press and hold your Flic button for 7 seconds…"
        try {
            manager.startScan(object : Flic2ScanCallback {
                override fun onDiscoveredAlreadyPairedButton(button: Flic2Button) {
                    status.value = "Found ${label(button)}, already paired"
                }
                override fun onDiscovered(bdAddr: String) {
                    status.value = "Found a button, connecting…"
                }
                override fun onConnected() {
                    status.value = "Connected, verifying…"
                }
                override fun onComplete(result: Int, subCode: Int, button: Flic2Button?) {
                    if (result == Flic2ScanCallback.RESULT_SUCCESS && button != null) {
                        button.addListener(listener)
                        button.connect()
                        refresh("Paired ${label(button)}. Hold it to talk.")
                    } else {
                        status.value = "Pairing failed: ${Flic2Manager.errorCodeToString(result)}"
                    }
                }
            })
        } catch (e: SecurityException) {
            status.value = "Bluetooth permission needed"
        }
    }

    fun stopScan() = runCatching { manager.stopScan() }

    fun forgetAll() {
        runCatching { manager.buttons.toList().forEach { manager.forgetButton(it) } }
        refresh("Forgot all buttons")
    }

    private fun refresh(msg: String? = null) {
        buttons.value = runCatching {
            manager.buttons.map { "${label(it)} — " + if (it.connectionState == Flic2Button.CONNECTION_STATE_CONNECTED_READY) "connected" else "not connected" }
        }.getOrDefault(emptyList())
        if (msg != null) status.value = msg
    }

    private fun label(b: Flic2Button) = b.name?.takeIf { it.isNotBlank() } ?: b.serialNumber ?: b.bdAddr
}
