package dev.switchboard.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class SwitchboardApp : Application() {
    lateinit var prefs: Prefs
        private set
    lateinit var hub: Hub
        private set

    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        hub = Hub(prefs)
        getSystemService(NotificationManager::class.java).createNotificationChannels(listOf(
            NotificationChannel(CHANNEL_SERVICE, "Connection", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while Switchboard is listening for your sessions"
            },
            NotificationChannel(CHANNEL_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "A session wants permission to run a tool"
            },
        ))
    }

    companion object {
        const val CHANNEL_SERVICE = "service"
        const val CHANNEL_APPROVALS = "approvals"
    }
}
