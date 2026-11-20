package dev.switchboard.app

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Runs while you want the switchboard in your ear: keeps the socket open, reads
 * messages aloud, owns push-to-talk and the Flic button, applies app updates.
 */
class SwitchboardService : LifecycleService() {
    private val app get() = application as SwitchboardApp
    private lateinit var speaker: Speaker
    private lateinit var talk: Talk
    private lateinit var flic: Flic

    override fun onCreate() {
        super.onCreate()
        speaker = Speaker(this, app.prefs)
        talk = Talk(this, onText = ::sendSpoken, onState = { listening.value = it; refreshNotification() })
        talk.onError { speaker.say(it, remember = false) }
        flic = Flic(this, onDown = ::pttDown, onUp = ::pttUp)
        instance = this
        app.hub.start()

        lifecycleScope.launch {
            app.hub.events.collect { ev ->
                when (ev) {
                    is HubEvent.NewMessage -> Speech.utterance(ev.message, app.prefs.speakMode)?.let {
                        if (!talk.listening) speaker.say(it)
                    }
                    is HubEvent.NewPermission -> notifyPermission(ev.request)
                    is HubEvent.Release -> if (app.prefs.autoUpdate && Updater.isNewer(ev.release)) Updater.update(this@SwitchboardService, app.hub, ev.release)
                }
            }
        }
        lifecycleScope.launch {
            combine(app.hub.connected, app.hub.permissions) { _, _ -> }.collect { refreshNotification() }
        }

        val v = BuildConfig.VERSION_CODE
        if (app.prefs.lastRunVersion in 1 until v) speaker.say("Switchboard updated to version ${BuildConfig.VERSION_NAME}.", remember = false)
        app.prefs.lastRunVersion = v
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        goForeground(fromBackground = intent?.getBooleanExtra(EXTRA_BACKGROUND, false) == true)
        flic.start()
        when (intent?.action) {
            ACTION_PTT_TOGGLE -> if (talk.listening) talk.finish() else pttDown()
            ACTION_PTT_START -> pttDown()
            ACTION_PTT_STOP -> talk.finish()
            ACTION_REPEAT -> speaker.repeatLast()
            ACTION_QUIET -> speaker.stop()
            ACTION_STOP -> {
                app.hub.stop()
                stopSelf()
            }
        }
        return START_STICKY
    }

    // ---- push-to-talk ----------------------------------------------------

    private fun pttDown() {
        speaker.stop()
        talk.start()
    }

    private fun pttUp(heldMs: Long) {
        if (heldMs >= HOLD_MS) return talk.finish()
        // A tap, not a hold: don't send anything.
        talk.cancel()
        if (speaker.speaking) speaker.stop() else speaker.repeatLast()
    }

    private fun sendSpoken(text: String) {
        lifecycleScope.launch {
            val target = app.prefs.target.ifBlank { null }
            try {
                app.hub.say(target, text, viaVoice = true)
                // A yes/no answers a permission prompt; say which way it went.
                if (Speech.isVerdict(text) && app.hub.permissions.value.isNotEmpty()) speaker.say("Answered.", remember = false)
            } catch (e: Exception) {
                speaker.say("Couldn't send that: ${e.message}", remember = false)
            }
        }
    }

    fun pairFlic() = flic.pair()
    fun forgetFlic() = flic.forgetAll()
    val flicButtons get() = flic.buttons
    val flicStatus get() = flic.status
    fun test(text: String) = speaker.say(text, remember = false)

    // ---- notifications -------------------------------------------------

    private fun goForeground(fromBackground: Boolean) {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        // After a reboot Android won't let us start the mic/media types from
        // the background; they're added the next time the app is opened.
        if (!fromBackground) {
            types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), types)
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun refreshNotification() {
        if (granted(Manifest.permission.POST_NOTIFICATIONS) || android.os.Build.VERSION.SDK_INT < 33) {
            getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification())
        }
    }

    private fun buildNotification(): Notification {
        val hub = app.hub
        val state = when {
            listening.value -> "Listening…"
            hub.connected.value -> "Connected" + (app.prefs.target.takeIf { it.isNotBlank() }?.let { " · talking to $it" } ?: "")
            else -> "Reconnecting…"
        }
        val pending = hub.permissions.value.size
        return NotificationCompat.Builder(this, SwitchboardApp.CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Switchboard")
            .setContentText(if (pending > 0) "$state · $pending waiting for approval" else state)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(activityIntent())
            .addAction(0, if (listening.value) "Send" else "Talk", serviceIntent(ACTION_PTT_TOGGLE))
            .addAction(0, "Repeat", serviceIntent(ACTION_REPEAT))
            .addAction(0, "Quiet", serviceIntent(ACTION_QUIET))
            .build()
    }

    private fun notifyPermission(p: PermissionRequest) {
        if (!granted(Manifest.permission.POST_NOTIFICATIONS) && android.os.Build.VERSION.SDK_INT >= 33) return
        val id = (p.session + p.request_id).hashCode()
        fun action(allow: Boolean) = PendingIntent.getBroadcast(
            this, id * 2 + if (allow) 1 else 0,
            Intent(this, ActionReceiver::class.java)
                .putExtra("session", p.session).putExtra("request_id", p.request_id)
                .putExtra("allow", allow).putExtra("notif", id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(this, SwitchboardApp.CHANNEL_APPROVALS)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("${p.session} wants to use ${p.tool_name}")
            .setContentText(p.description)
            .setStyle(NotificationCompat.BigTextStyle().bigText("${p.description}\n\n${p.input_preview.take(400)}"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(activityIntent())
            .setAutoCancel(true)
            .addAction(0, "Allow", action(true))
            .addAction(0, "Deny", action(false))
            .build()
        getSystemService(NotificationManager::class.java).notify(id, n)
    }

    private fun activityIntent() = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE,
    )

    private fun serviceIntent(action: String) = PendingIntent.getService(
        this, action.hashCode(), Intent(this, SwitchboardService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE,
    )

    override fun onDestroy() {
        instance = null
        flic.stopScan()
        talk.shutdown()
        speaker.shutdown()
        super.onDestroy()
    }

    companion object {
        const val ACTION_PTT_TOGGLE = "dev.switchboard.PTT_TOGGLE"
        const val ACTION_PTT_START = "dev.switchboard.PTT_START"
        const val ACTION_PTT_STOP = "dev.switchboard.PTT_STOP"
        const val ACTION_REPEAT = "dev.switchboard.REPEAT"
        const val ACTION_QUIET = "dev.switchboard.QUIET"
        const val ACTION_STOP = "dev.switchboard.STOP"
        const val EXTRA_BACKGROUND = "background"
        private const val NOTIF_ID = 1
        private const val HOLD_MS = 350L

        /** True while push-to-talk is recording; drives the big button in the UI. */
        val listening = MutableStateFlow(false)
        var instance: SwitchboardService? = null
            private set

        fun start(ctx: Context, action: String? = null, background: Boolean = false) {
            val i = Intent(ctx, SwitchboardService::class.java).setAction(action).putExtra(EXTRA_BACKGROUND, background)
            ContextCompat.startForegroundService(ctx, i)
        }
    }
}
