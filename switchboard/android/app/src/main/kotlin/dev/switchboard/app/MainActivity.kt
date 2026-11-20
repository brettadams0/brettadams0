package dev.switchboard.app

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import dev.switchboard.app.ui.ChatScreen
import dev.switchboard.app.ui.SettingsScreen
import dev.switchboard.app.ui.SetupScreen
import dev.switchboard.app.ui.SwitchboardTheme
import dev.switchboard.app.ui.TasksScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val app get() = application as SwitchboardApp
    private var configured by mutableStateOf(false)

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        // Restart so the service picks up the microphone type now that it's allowed.
        if (app.prefs.configured) SwitchboardService.start(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        configured = app.prefs.configured
        if (configured) onConfigured()
        setContent {
            SwitchboardTheme {
                if (!configured) {
                    SetupScreen(app.hub, initialUrl = app.prefs.url) { url, token ->
                        app.prefs.url = url
                        app.prefs.token = token
                        configured = true
                        app.hub.restart()
                        onConfigured()
                    }
                } else {
                    Main()
                }
            }
        }
    }

    private fun onConfigured() {
        val wanted = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        askPermissions.launch(wanted.toTypedArray())
        SwitchboardService.start(this)
        lifecycleScope.launch { if (app.prefs.autoUpdate) Updater.update(this@MainActivity, app.hub) }
    }

    fun requestBluetooth(then: () -> Unit) {
        if (Build.VERSION.SDK_INT < 31) return then()
        pendingBluetooth = then
        bluetooth.launch(arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT))
    }
    private var pendingBluetooth: (() -> Unit)? = null
    private val bluetooth = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res.values.all { it }) pendingBluetooth?.invoke()
        pendingBluetooth = null
    }

    fun signOut() {
        app.hub.stop()
        app.prefs.token = ""
        configured = false
    }

    @androidx.compose.runtime.Composable
    private fun Main() {
        var tab by rememberSaveable { mutableStateOf(0) }
        Scaffold(
            bottomBar = {
                NavigationBar {
                    NavigationBarItem(tab == 0, { tab = 0 }, { Icon(Icons.AutoMirrored.Filled.Chat, null) }, label = { Text("Chat") })
                    NavigationBarItem(tab == 1, { tab = 1 }, { Icon(Icons.Default.Checklist, null) }, label = { Text("Tasks") })
                    NavigationBarItem(tab == 2, { tab = 2 }, { Icon(Icons.Default.Settings, null) }, label = { Text("Settings") })
                }
            },
        ) { pad ->
            val m = Modifier.padding(pad)
            when (tab) {
                0 -> ChatScreen(app.hub, app.prefs, m)
                1 -> TasksScreen(app.hub, m)
                else -> SettingsScreen(this, app.hub, app.prefs, m)
            }
        }
    }
}
