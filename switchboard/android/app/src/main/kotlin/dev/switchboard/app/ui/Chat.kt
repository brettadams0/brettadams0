package dev.switchboard.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.switchboard.app.Hub
import dev.switchboard.app.Message
import dev.switchboard.app.PermissionRequest
import dev.switchboard.app.Prefs
import dev.switchboard.app.SwitchboardService
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(hub: Hub, prefs: Prefs, modifier: Modifier) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val sessions by hub.sessions.collectAsState()
    val all by hub.messages.collectAsState()
    val perms by hub.permissions.collectAsState()
    val connected by hub.connected.collectAsState()
    val error by hub.lastError.collectAsState()
    val listening by SwitchboardService.listening.collectAsState()
    var target by remember { mutableStateOf(prefs.target) }
    var older by remember(target) { mutableStateOf<List<Message>>(emptyList()) }
    var draft by remember { mutableStateOf("") }
    var showScreen by remember(target) { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    // A specific session's thread: fetch its own history (the live list is everything, recent only).
    LaunchedEffect(target) {
        older = if (target.isBlank()) emptyList() else runCatching { hub.history(target, limit = 150) }.getOrDefault(emptyList())
    }
    val inThread = { m: Message -> target.isBlank() || m.from_name == target || m.to_name == target }
    val thread = remember(all, older, target) {
        (older + all.filter(inThread)).associateBy { it.id }.values.sortedBy { it.id }
    }
    val list = rememberLazyListState()
    LaunchedEffect(thread.size) { if (thread.isNotEmpty()) list.animateScrollToItem(thread.size - 1) }

    val orchestrator = sessions.firstOrNull { it.role == "orchestrator" }?.name
    val current = sessions.firstOrNull { it.name == target }

    Column(modifier.fillMaxSize().imePadding()) {
        // ---- header: who you're talking to
        Surface(tonalElevation = 2.dp) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(if (connected) Ok else Bad))
                Spacer(Modifier.size(10.dp))
                Box(Modifier.weight(1f)) {
                    TextButton(onClick = { menu = true }) {
                        Column {
                            Text(if (target.isBlank()) "Everything" else target, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                            Text(
                                when {
                                    !connected -> error ?: "Connecting…"
                                    target.isBlank() -> "Talking to ${orchestrator ?: "no orchestrator yet"}"
                                    current?.online == true -> "connected · ${current.cwd ?: ""}"
                                    current?.tmux_alive == true -> "starting…"
                                    else -> "stopped"
                                },
                                style = MaterialTheme.typography.bodySmall, maxLines = 1,
                            )
                        }
                        Icon(Icons.Default.ArrowDropDown, null)
                    }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem({ Text("Everything (orchestrator)") }, { target = ""; prefs.target = ""; menu = false })
                        sessions.forEach { s ->
                            DropdownMenuItem(
                                text = { Text("${s.name}${if (s.role == "orchestrator") " · lead" else ""}") },
                                leadingIcon = { Box(Modifier.size(9.dp).clip(CircleShape).background(if (s.online) Ok else if (s.tmux_alive) Warn else Bad)) },
                                onClick = { target = s.name; prefs.target = s.name; menu = false },
                            )
                        }
                    }
                }
                if (current?.tmux_alive == true) IconButton({ showScreen = !showScreen }) { Icon(Icons.Default.Terminal, "Screen") }
            }
        }

        if (showScreen && current != null) TerminalPeek(hub, current.name)

        perms.filter { target.isBlank() || it.session == target }.forEach { p ->
            PermissionCard(p, onAllow = { scope.launch { runCatching { hub.decide(p, true) } } }, onDeny = { scope.launch { runCatching { hub.decide(p, false) } } })
        }

        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(thread, key = { it.id }) { MessageBubble(it) }
        }

        // ---- composer + hold-to-talk
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                draft, { draft = it }, Modifier.weight(1f).heightIn(max = 160.dp),
                placeholder = { Text(if (listening) "Listening…" else "Message ${target.ifBlank { orchestrator ?: "…" }}") },
            )
            if (draft.isNotBlank()) {
                IconButton({
                    val text = draft
                    draft = ""
                    scope.launch { runCatching { hub.say(target.ifBlank { null }, text) } }
                }) { Icon(Icons.AutoMirrored.Filled.Send, "Send") }
            }
            Spacer(Modifier.size(8.dp))
            Box(
                Modifier.size(64.dp).clip(CircleShape)
                    .background(if (listening) Bad else MaterialTheme.colorScheme.primary)
                    .pointerInput(Unit) {
                        detectTapGestures(onPress = {
                            SwitchboardService.start(ctx, SwitchboardService.ACTION_PTT_START)
                            tryAwaitRelease()
                            SwitchboardService.start(ctx, SwitchboardService.ACTION_PTT_STOP)
                        })
                    },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Default.Mic, "Hold to talk", tint = Color.White, modifier = Modifier.size(30.dp)) }
        }
    }
}

@Composable
private fun MessageBubble(m: Message) {
    if (m.isSystem) {
        Text(m.body, Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        return
    }
    val mine = m.fromUser
    val peer = !mine && !m.toUser
    val colors = when {
        mine -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary)
        peer -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)
        m.kind == "permission" -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
        else -> CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    }
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        val route = when {
            mine -> "→ ${m.to_name}"
            peer -> "${m.from_name} → ${m.to_name}"
            else -> m.from_name
        }
        val time = m.created_at.substringAfter('T').take(5)
        Text("$route · $time${if (m.kind == "verdict") " · answered prompt" else ""}", style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(horizontal = 6.dp))
        Card(Modifier.widthIn(max = 340.dp), colors = colors, shape = RoundedCornerShape(16.dp)) {
            Text(m.body, Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
        }
        if (m.to_kind == "session" && !m.delivered && m.kind == "chat") {
            Text("queued until it connects", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
private fun PermissionCard(p: PermissionRequest, onAllow: () -> Unit, onDeny: () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${p.session} wants to use ${p.tool_name}", fontWeight = FontWeight.Bold)
            Text(p.description)
            if (p.input_preview.isNotBlank()) {
                Text(p.input_preview.take(300), fontFamily = FontFamily.Monospace, fontSize = 12.sp, maxLines = 6)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onAllow) { Text("Allow") }
                OutlinedButton(onDeny) { Text("Deny") }
            }
        }
    }
}

@Composable
private fun TerminalPeek(hub: Hub, session: String) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("…") }
    LaunchedEffect(session) {
        while (true) {
            text = runCatching { hub.screen(session) }.getOrElse { it.message ?: "error" }
            delay(2000)
        }
    }
    Column(Modifier.fillMaxWidth().background(Color(0xFF0B0D12))) {
        Box(Modifier.fillMaxWidth().heightIn(max = 280.dp).verticalScroll(rememberScrollState(Int.MAX_VALUE)).horizontalScroll(rememberScrollState())) {
            Text(text, Modifier.padding(8.dp), color = Color(0xFFD7DAE0), fontFamily = FontFamily.Monospace, fontSize = 10.sp, softWrap = false)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("Enter", "Escape", "Up", "Down", "1", "2").forEach { k ->
                AssistChip(onClick = { scope.launch { runCatching { hub.keys(session, k) } } }, label = { Text(k, color = Color(0xFFD7DAE0)) })
            }
        }
    }
}
