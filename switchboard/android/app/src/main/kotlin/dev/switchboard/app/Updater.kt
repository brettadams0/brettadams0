package dev.switchboard.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

/**
 * The app updates itself from the switchboard server. A Claude session builds
 * a new APK and calls release_app; the server tells every phone; this
 * downloads it, checks the sha256, and hands it to PackageInstaller.
 *
 * On Android 12+ the install is silent once this app is the installer of
 * record for itself — i.e. from the second self-update on. The very first one
 * (replacing the copy you sideloaded by hand) asks you to tap "Update".
 */
object Updater {
    val status = MutableStateFlow("")
    private val lock = Mutex()

    fun isNewer(r: AppRelease?) = r != null && r.version_code > BuildConfig.VERSION_CODE

    suspend fun update(ctx: Context, hub: Hub, release: AppRelease? = null): String = lock.withLock {
        val r = release ?: runCatching { hub.latest() }.getOrElse { return set("Couldn't check: ${it.message}") }
        if (!isNewer(r)) return set("Up to date (build ${BuildConfig.VERSION_CODE})")
        r!!
        if (!ctx.packageManager.canRequestPackageInstalls()) {
            return set("Update ${r.version_name} is ready. Allow \"Install unknown apps\" for Switchboard in Settings first.")
        }
        set("Downloading ${r.version_name}…")
        val apk = File(ctx.cacheDir, "update-${r.version_code}.apk")
        try {
            hub.download(r, apk)
            withContext(Dispatchers.IO) { install(ctx, apk) }
        } catch (e: Exception) {
            return set("Update failed: ${e.message}")
        } finally {
            apk.delete()
        }
        set("Installing ${r.version_name}…")
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            if (Build.VERSION.SDK_INT >= 34) setPackageSource(PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val done = PendingIntent.getBroadcast(
                ctx, id, Intent(ctx, InstallReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(done.intentSender)
        }
    }

    private fun set(s: String): String {
        status.value = s
        return s
    }
}
