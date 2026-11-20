package dev.switchboard.app.ui

import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.switchboard.app.BuildConfig
import dev.switchboard.app.Hub
import dev.switchboard.app.MainActivity
import dev.switchboard.app.Prefs
import dev.switchboard.app.SwitchboardService
import dev.switchboard.app.Updater
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(activity: MainActivity, hub: Hub, prefs: Prefs, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    val updateStatus by Updater.status.collectAsState()
    val latest by hub.latestRelease.collectAsState()
    var speakMode by remember { mutableStateOf(prefs.speakMode) }
    var rate by remember { mutableFloatStateOf(prefs.speechRate) }
    var autoUpdate by remember { mutableStateOf(prefs.autoUpdate) }
    val service = SwitchboardService.instance
    val flicButtons by (service?.flicButtons ?: MutableStateFlow(emptyList())).collectAsState()
    val flicStatus by (service?.flicStatus ?: MutableStateFlow("")).collectAsState()

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Section("Read aloud")
        listOf("all" to "Every message to me", "flagged" to "Only messages sessions mark to be spoken", "off" to "Off").forEach { (v, label) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(speakMode == v, { speakMode = v; prefs.speakMode = v })
                Text(label)
            }
        }
        Text("Speed ${"%.1f".format(rate)}×")
        Slider(rate, { rate = it }, valueRange = 0.7f..2.0f, onValueChangeFinished = { prefs.speechRate = rate })
        OutlinedButton({ service?.test("This is how replies will sound.") }) { Text("Test voice") }

        HorizontalDivider()
        Section("Flic button")
        Text("Hold to talk, release to send. Tap to stop speaking or repeat the last message. Pair it here (not in the Flic app).",
            style = MaterialTheme.typography.bodySmall)
        flicButtons.forEach { Text("• $it") }
        if (flicStatus.isNotBlank()) Text(flicStatus, color = MaterialTheme.colorScheme.primary)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ activity.requestBluetooth { SwitchboardService.instance?.pairFlic() } }) { Text("Pair a Flic") }
            if (flicButtons.isNotEmpty()) OutlinedButton({ service?.forgetFlic() }) { Text("Forget") }
        }
        Text("Other buttons: anything that can send the broadcast dev.switchboard.PTT_TOGGLE (Flic app → Intent, Tasker, Bluetooth remotes via Tasker) toggles talk.",
            style = MaterialTheme.typography.bodySmall)

        HorizontalDivider()
        Section("Updates")
        Text("This build: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})" +
            (latest?.let { "\nLatest on server: ${it.version_name} (${it.version_code})" } ?: ""))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(autoUpdate, { autoUpdate = it; prefs.autoUpdate = it })
            Text("  Install new versions automatically")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ scope.launch { Updater.update(activity, hub) } }) { Text("Check now") }
            if (!activity.packageManager.canRequestPackageInstalls()) {
                OutlinedButton({
                    activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                }) { Text("Allow installs") }
            }
        }
        if (updateStatus.isNotBlank()) Text(updateStatus, color = MaterialTheme.colorScheme.primary)

        HorizontalDivider()
        Section("Staying connected")
        val power = activity.getSystemService(PowerManager::class.java)
        if (!power.isIgnoringBatteryOptimizations(activity.packageName)) {
            Text("Android may cut the connection when the screen is off. Exempt Switchboard from battery optimisation to keep hearing your sessions on a walk.",
                style = MaterialTheme.typography.bodySmall)
            OutlinedButton({
                activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}")))
            }) { Text("Keep running in background") }
        } else {
            Text("Exempt from battery optimisation ✓", style = MaterialTheme.typography.bodySmall)
        }

        HorizontalDivider()
        Section("Server")
        Text(prefs.url)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton({ hub.restart() }) { Text("Reconnect") }
            OutlinedButton({ activity.signOut() }) { Text("Change server") }
            OutlinedButton({ SwitchboardService.start(activity, SwitchboardService.ACTION_STOP) }) { Text("Stop") }
        }
    }
}

@Composable
private fun Section(title: String) = Text(title, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
