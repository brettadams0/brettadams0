package dev.switchboard.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.switchboard.app.Hub
import dev.switchboard.app.TASK_STATUSES
import dev.switchboard.app.Task
import kotlinx.coroutines.launch

@Composable
fun TasksScreen(hub: Hub, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    val version by hub.taskVersion.collectAsState()
    var status by remember { mutableStateOf("open") }
    var tasks by remember { mutableStateOf<List<Task>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var draft by remember { mutableStateOf("") }

    LaunchedEffect(version, status) {
        runCatching { hub.tasks(status.ifBlank { null }, null) }
            .onSuccess { tasks = it; error = null }
            .onFailure { error = it.message }
    }

    Column(modifier.fillMaxSize()) {
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp)) {
                OutlinedTextField(draft, { draft = it }, Modifier.fillMaxWidth(), singleLine = true,
                    placeholder = { Text("New task  #project  !0-3") },
                    trailingIcon = {
                        TextButton({
                            var title = draft
                            var project: String? = null
                            var prio = 2
                            Regex("(^|\\s)#([\\w-]+)").find(title)?.let { project = it.groupValues[2]; title = title.replace(it.value, " ") }
                            Regex("(^|\\s)!([0-3])\\b").find(title)?.let { prio = it.groupValues[2].toInt(); title = title.replace(it.value, " ") }
                            title = title.trim()
                            if (title.isNotEmpty()) scope.launch { runCatching { hub.addTask(title, project, prio) } }
                            draft = ""
                        }) { Text("Add") }
                    })
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (listOf("open") + TASK_STATUSES + "").forEach { s ->
                        FilterChip(status == s, { status = s }, label = { Text(s.ifBlank { "all" }) })
                    }
                }
            }
        }
        error?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) }
        val groups = tasks.groupBy { it.project }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp)) {
            if (tasks.isEmpty()) item { Text("Nothing here.", color = MaterialTheme.colorScheme.outline) }
            groups.forEach { (project, ts) ->
                item(key = "h-$project") {
                    Text("${project.uppercase()} · ${ts.size}", Modifier.padding(top = 12.dp, bottom = 6.dp),
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
                }
                items(ts, key = { it.id }) { t ->
                    TaskRow(t,
                        onPriority = { scope.launch { runCatching { hub.patchTask(t.id, priority = (t.priority + 1) % 4) } } },
                        onStatus = { s -> scope.launch { runCatching { hub.patchTask(t.id, status = s) } } })
                }
            }
        }
    }
}

@Composable
private fun TaskRow(t: Task, onPriority: () -> Unit, onStatus: (String) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val prioColor = when (t.priority) { 0 -> Bad; 1 -> Warn; 2 -> MaterialTheme.colorScheme.outline; else -> MaterialTheme.colorScheme.outlineVariant }
    Card(Modifier.fillMaxWidth().padding(vertical = 3.dp), shape = RoundedCornerShape(12.dp)) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(color = prioColor, shape = RoundedCornerShape(6.dp), modifier = Modifier.clickable(onClick = onPriority)) {
                Text("P${t.priority}", Modifier.padding(horizontal = 6.dp, vertical = 2.dp), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text(t.title, textDecoration = if (t.status == "done") TextDecoration.LineThrough else null)
                val sub = listOfNotNull(t.assignee?.let { "@$it" }, t.notes.takeIf { it.isNotBlank() }?.take(80)).joinToString(" · ")
                if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Box {
                TextButton({ menu = true }) { Text(t.status) }
                DropdownMenu(menu, { menu = false }) {
                    TASK_STATUSES.forEach { s -> DropdownMenuItem({ Text(s) }, { menu = false; onStatus(s) }) }
                }
            }
        }
    }
}
