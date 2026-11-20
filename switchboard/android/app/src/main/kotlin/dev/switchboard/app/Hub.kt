package dev.switchboard.app

import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Something the service wants to react to (speak it, update the app …). */
sealed interface HubEvent {
    data class NewMessage(val message: Message) : HubEvent
    data class NewPermission(val request: PermissionRequest) : HubEvent
    data class Release(val release: AppRelease) : HubEvent
}

/**
 * The phone's connection to the switchboard: one WebSocket for live events,
 * plain HTTPS calls for everything else. State is exposed as flows for the UI.
 */
class Hub(private val prefs: Prefs) {
    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private val main = Handler(Looper.getMainLooper())

    val connected = MutableStateFlow(false)
    val lastError = MutableStateFlow<String?>(null)
    val sessions = MutableStateFlow<List<Session>>(emptyList())
    /** Recent messages across every session, oldest first. */
    val messages = MutableStateFlow<List<Message>>(emptyList())
    val permissions = MutableStateFlow<List<PermissionRequest>>(emptyList())
    val latestRelease = MutableStateFlow<AppRelease?>(null)
    /** Bumped whenever a task changes so task screens reload. */
    val taskVersion = MutableStateFlow(0)

    private val _events = MutableSharedFlow<HubEvent>(extraBufferCapacity = 64)
    val events = _events.asSharedFlow()

    private var socket: WebSocket? = null
    private var wanted = false
    private var backoffMs = 1000L

    // ---- live connection -------------------------------------------------

    fun start() {
        if (!prefs.configured) return
        wanted = true
        if (socket == null) open()
    }

    fun stop() {
        wanted = false
        socket?.close(1000, "bye")
        socket = null
        connected.value = false
    }

    fun restart() {
        stop()
        start()
    }

    private fun open() {
        val url = prefs.url.toHttpUrl().newBuilder()
            .encodedPath("/ws")
            .addQueryParameter("role", "client")
            .addQueryParameter("token", prefs.token)
            .build().toString().replaceFirst("http", "ws")
        socket = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                backoffMs = 1000
                connected.value = true
                lastError.value = null
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    handle(json.parseToJsonElement(text).jsonObject)
                } catch (e: Exception) {
                    Log.w(TAG, "bad event", e)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket, null)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                dropped(webSocket, if (response?.code == 401) "Wrong token" else t.message)
        })
    }

    private fun dropped(ws: WebSocket, error: String?) {
        if (socket !== ws) return
        socket = null
        connected.value = false
        if (error != null) lastError.value = error
        if (!wanted) return
        main.postDelayed({ if (wanted && socket == null) open() }, backoffMs)
        backoffMs = (backoffMs * 2).coerceAtMost(30_000)
    }

    private fun handle(ev: JsonObject) {
        when (ev["type"]?.jsonPrimitive?.content) {
            "hello" -> {
                val hello = json.decodeFromJsonElement<Hello>(ev)
                sessions.value = hello.sessions
                permissions.value = hello.pending_permissions
                latestRelease.value = hello.latest_release
                hello.latest_release?.let { _events.tryEmit(HubEvent.Release(it)) }
                Thread { runCatching { messages.value = historyBlocking(null, null, 200) } }.start()
            }
            "sessions" -> sessions.value = json.decodeFromJsonElement(ListSerializer(Session.serializer()), ev["sessions"]!!)
            "message" -> {
                val m = json.decodeFromJsonElement<Message>(ev["message"]!!)
                messages.update { list ->
                    val i = list.indexOfFirst { it.id == m.id }
                    if (i >= 0) list.toMutableList().also { it[i] = m } else (list + m).takeLast(1000)
                }
                _events.tryEmit(HubEvent.NewMessage(m))
            }
            "permission" -> {
                val p = json.decodeFromJsonElement<PermissionRequest>(ev["request"]!!)
                permissions.update { list ->
                    val rest = list.filterNot { it.session == p.session && it.request_id == p.request_id }
                    if (p.status == "pending") rest + p else rest
                }
                if (p.status == "pending") _events.tryEmit(HubEvent.NewPermission(p))
            }
            "task" -> taskVersion.update { it + 1 }
            "app_release" -> {
                val r = json.decodeFromJsonElement<AppRelease>(ev["release"]!!)
                latestRelease.value = r
                _events.tryEmit(HubEvent.Release(r))
            }
        }
    }

    // ---- REST ------------------------------------------------------------

    private fun request(method: String, path: String, body: JsonElement? = null): String {
        val req = Request.Builder()
            .url(prefs.url + path)
            .header("Authorization", "Bearer ${prefs.token}")
            .method(method, body?.toString()?.toRequestBody(JSON))
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                val msg = runCatching { json.parseToJsonElement(text).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
                throw IOException(msg ?: "HTTP ${res.code}")
            }
            return text
        }
    }

    private suspend fun call(method: String, path: String, body: JsonElement? = null) =
        withContext(Dispatchers.IO) { request(method, path, body) }

    /** Check URL + token before saving them. */
    suspend fun probe(url: String, token: String): Result<Int> = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder().url(url.trimEnd('/') + "/api/sessions").header("Authorization", "Bearer $token").build()
            http.newCall(req).execute().use { res ->
                if (res.code == 401) error("Wrong token")
                if (!res.isSuccessful) error("HTTP ${res.code}")
                json.parseToJsonElement(res.body!!.string()).let { (it as kotlinx.serialization.json.JsonArray).size }
            }
        }
    }

    /** Send something to a session; null target = the orchestrator. */
    suspend fun say(to: String?, text: String, viaVoice: Boolean = false): Message {
        val body = buildJsonObject {
            if (!to.isNullOrBlank()) put("to", to)
            put("body", text)
            put("meta", buildJsonObject { put("via", if (viaVoice) "voice" else "phone") })
        }
        return json.decodeFromString(call("POST", "/api/messages", body))
    }

    private fun historyBlocking(session: String?, before: Long?, limit: Int): List<Message> {
        val q = buildString {
            append("/api/messages?limit=$limit")
            if (session != null) append("&session=").append(java.net.URLEncoder.encode(session, "UTF-8"))
            if (before != null) append("&before=$before")
        }
        return json.decodeFromString(ListSerializer(Message.serializer()), request("GET", q))
    }

    suspend fun history(session: String?, before: Long? = null, limit: Int = 100) =
        withContext(Dispatchers.IO) { historyBlocking(session, before, limit) }

    suspend fun decide(p: PermissionRequest, allow: Boolean) {
        call("POST", "/api/permissions/${p.session}/${p.request_id}", buildJsonObject { put("behavior", if (allow) "allow" else "deny") })
        permissions.update { list -> list.filterNot { it.session == p.session && it.request_id == p.request_id } }
    }

    suspend fun tasks(status: String?, project: String?): List<Task> {
        val q = buildString {
            append("/api/tasks?limit=1000")
            if (!status.isNullOrBlank()) append("&status=$status")
            if (!project.isNullOrBlank()) append("&project=").append(java.net.URLEncoder.encode(project, "UTF-8"))
        }
        return json.decodeFromString(ListSerializer(Task.serializer()), call("GET", q))
    }

    suspend fun addTask(title: String, project: String?, priority: Int) {
        call("POST", "/api/tasks", buildJsonObject {
            put("title", title)
            if (!project.isNullOrBlank()) put("project", project)
            put("priority", priority)
            put("status", "todo")
        })
    }

    suspend fun patchTask(id: Int, status: String? = null, priority: Int? = null) {
        call("PATCH", "/api/tasks/$id", buildJsonObject {
            if (status != null) put("status", status)
            if (priority != null) put("priority", priority)
        })
    }

    suspend fun screen(session: String): String =
        json.parseToJsonElement(call("GET", "/api/sessions/$session/screen?lines=80")).jsonObject["screen"]!!.jsonPrimitive.content

    suspend fun keys(session: String, vararg keys: String) {
        call("POST", "/api/sessions/$session/keys", buildJsonObject {
            put("keys", kotlinx.serialization.json.JsonArray(keys.map { kotlinx.serialization.json.JsonPrimitive(it) }))
        })
    }

    suspend fun latest(): AppRelease? {
        val text = call("GET", "/api/app/latest")
        return if (text.trim() == "null") null else json.decodeFromString(text)
    }

    /** Download a release into [dest], verifying its sha256. */
    suspend fun download(release: AppRelease, dest: File) = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("${prefs.url}/api/app/download/${release.version_code}")
            .header("Authorization", "Bearer ${prefs.token}").build()
        val digest = MessageDigest.getInstance("SHA-256")
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IOException("download failed: HTTP ${res.code}")
            dest.outputStream().use { out ->
                res.body!!.byteStream().use { input ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                    }
                }
            }
        }
        val hex = digest.digest().joinToString("") { "%02x".format(it) }
        if (hex != release.sha256) {
            dest.delete()
            throw IOException("checksum mismatch; refusing to install")
        }
    }

    companion object {
        private const val TAG = "Hub"
        private val JSON = "application/json".toMediaType()
    }
}
