package dev.switchboard.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private val receiverScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

/**
 * Push-to-talk from outside the app. In the Flic app: add an action
 * Advanced → Intent → broadcast "dev.switchboard.PTT_TOGGLE" for click, or use
 * the app's built-in Flic pairing for true hold-to-talk.
 * Also: `adb shell am broadcast -a dev.switchboard.PTT_TOGGLE -n dev.switchboard.app/.PttReceiver`.
 */
class PttReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val action = intent.action ?: return
        SwitchboardService.start(ctx, action)
    }
}

/** Allow / Deny tapped on a permission notification. */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext as SwitchboardApp
        val p = PermissionRequest(
            request_id = intent.getStringExtra("request_id") ?: return,
            session = intent.getStringExtra("session") ?: return,
            tool_name = "", description = "",
        )
        val allow = intent.getBooleanExtra("allow", false)
        ctx.getSystemService(NotificationManager::class.java).cancel(intent.getIntExtra("notif", 0))
        val pending = goAsync()
        receiverScope.launch {
            runCatching { app.hub.decide(p, allow) }
            pending.finish()
        }
    }
}

/** Result of a self-update install. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // First self-update (or Android < 12): Android wants a tap.
                val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                confirm ?: return
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { ctx.startActivity(confirm) }
                val n = NotificationCompat.Builder(ctx, SwitchboardApp.CHANNEL_APPROVALS)
                    .setSmallIcon(R.drawable.ic_stat)
                    .setContentTitle("Switchboard update ready")
                    .setContentText("Tap to install. Later updates install by themselves.")
                    .setAutoCancel(true)
                    .setContentIntent(PendingIntent.getActivity(ctx, 7, confirm, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                    .build()
                ctx.getSystemService(NotificationManager::class.java).notify(7, n)
                Updater.status.value = "Waiting for you to confirm the update"
            }
            PackageInstaller.STATUS_SUCCESS -> Updater.status.value = "Updated"
            else -> Updater.status.value = "Install failed ($status): ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}"
        }
    }
}

/** Come back after a reboot or after updating ourselves. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext as SwitchboardApp
        if (!app.prefs.configured) return
        // After a self-update the app was in use, so the full service is allowed.
        val background = intent.action == Intent.ACTION_BOOT_COMPLETED
        runCatching { SwitchboardService.start(ctx, background = background) }
    }
}
