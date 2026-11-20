package dev.switchboard.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.switchboard.app.Hub
import kotlinx.coroutines.launch

@Composable
fun SetupScreen(hub: Hub, initialUrl: String, onDone: (String, String) -> Unit) {
    var url by remember { mutableStateOf(initialUrl.ifBlank { "http://" }) }
    var token by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Switchboard", style = MaterialTheme.typography.headlineMedium)
            Text(
                "On the computer running your sessions, `sb info` prints the URL and token. " +
                    "Away from home, use a Tailscale address (e.g. http://my-box:7777).",
                style = MaterialTheme.typography.bodyMedium,
            )
            OutlinedTextField(url, { url = it }, Modifier.fillMaxWidth(), label = { Text("Server URL") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            OutlinedTextField(token, { token = it }, Modifier.fillMaxWidth(), label = { Text("Token") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                enabled = !busy && url.length > 8 && token.isNotBlank(),
                onClick = {
                    busy = true
                    error = null
                    scope.launch {
                        hub.probe(url, token)
                            .onSuccess { onDone(url, token) }
                            .onFailure { error = "Couldn't connect: ${it.message}" }
                        busy = false
                    }
                },
            ) { Text(if (busy) "Checking…" else "Connect") }
        }
    }
}
