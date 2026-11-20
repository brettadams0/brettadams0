package dev.switchboard.app

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

// Mirrors switchboard/src/protocol.ts. Change both together.

val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

@Serializable
data class Message(
    val id: Long,
    val created_at: String,
    val kind: String = "chat",
    val from_kind: String,
    val from_name: String,
    val to_kind: String,
    val to_name: String,
    val body: String,
    val speak: Boolean = false,
    val delivered: Boolean = false,
    val meta: JsonObject = JsonObject(emptyMap()),
) {
    val fromUser get() = from_kind == "user"
    val toUser get() = to_kind == "user"
    val isSystem get() = from_kind == "system" || kind == "system"
}

@Serializable
data class Session(
    val name: String,
    val cwd: String? = null,
    val role: String = "worker",
    val description: String = "",
    val online: Boolean = false,
    val tmux_alive: Boolean = false,
    val last_seen_at: String? = null,
)

@Serializable
data class Task(
    val id: Int,
    val title: String,
    val notes: String = "",
    val project: String = "inbox",
    val status: String = "backlog",
    val priority: Int = 2,
    val assignee: String? = null,
    val updated_at: String = "",
)

@Serializable
data class PermissionRequest(
    val request_id: String,
    val session: String,
    val tool_name: String,
    val description: String,
    val input_preview: String = "",
    val status: String = "pending",
)

@Serializable
data class AppRelease(
    val version_code: Int,
    val version_name: String,
    val sha256: String,
    val size_bytes: Long = 0,
    val notes: String = "",
)

@Serializable
data class Hello(
    val sessions: List<Session>,
    val pending_permissions: List<PermissionRequest>,
    val latest_release: AppRelease? = null,
)

val TASK_STATUSES = listOf("doing", "todo", "backlog", "blocked", "done")
