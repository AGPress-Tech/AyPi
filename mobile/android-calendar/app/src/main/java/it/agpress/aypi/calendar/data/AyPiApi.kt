package it.agpress.aypi.calendar.data

import it.agpress.aypi.calendar.BuildConfig
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val statusCode: Int, message: String) : IOException(message)

class AyPiApi {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()
    private val baseUrl = BuildConfig.AYPI_API_BASE_URL.trimEnd('/')
    private var socket: WebSocket? = null

    suspend fun login(adminName: String, password: String): AdminSession {
        val body = JSONObject()
            .put("adminName", adminName)
            .put("password", password)
        val json = execute("POST", "/api/mobile/auth/login", body = body)
        val admin = json.getJSONObject("admin")
        val modules = admin.optJSONObject("modules") ?: JSONObject()
        return AdminSession(
            token = json.getString("accessToken"),
            adminName = admin.getString("name"),
            expiresAt = json.getString("expiresAt"),
            calendar = modules.optBoolean("calendar", true),
            purchasing = modules.optBoolean("purchasing", true),
            ticketSupport = modules.optBoolean("ticketSupport", true),
            productionPlanner = modules.optBoolean("productionPlanner", true),
        )
    }

    suspend fun validate(session: AdminSession) {
        execute("GET", "/api/mobile/auth/me", session.token)
    }

    suspend fun logout(session: AdminSession) {
        runCatching { execute("POST", "/api/mobile/auth/logout", session.token, JSONObject()) }
        closeRealtime()
    }

    suspend fun bootstrap(session: AdminSession): CalendarSnapshot =
        parseBootstrap(execute("GET", "/api/mobile/calendar/bootstrap", session.token))

    suspend fun purchasing(session: AdminSession): PurchasingSnapshot =
        parsePurchasing(execute("GET", "/api/product-manager/bootstrap", session.token))

    suspend fun savePurchasingRequests(
        session: AdminSession,
        interventions: Boolean,
        items: List<JSONObject>,
    ) {
        executeArray(
            "PUT",
            if (interventions) "/api/product-manager/interventions"
            else "/api/product-manager/requests",
            session.token,
            JSONArray(items),
        )
    }

    suspend fun tickets(session: AdminSession): TicketSnapshot {
        val store = execute("GET", "/api/ticket-support/store", session.token)
        val categories = execute("GET", "/api/ticket-support/categories", session.token)
        return parseTickets(store, categories)
    }

    suspend fun saveTickets(
        session: AdminSession,
        version: Int,
        tickets: List<JSONObject>,
    ) {
        execute(
            "PUT",
            "/api/ticket-support/store",
            session.token,
            JSONObject().put("version", version).put("tickets", JSONArray(tickets)),
        )
    }

    suspend fun planner(session: AdminSession): PlannerSnapshot =
        parsePlanner(execute("GET", "/api/production-planner/state", session.token))

    suspend fun savePlanner(
        session: AdminSession,
        state: JSONObject,
        baseRevision: Int,
    ): PlannerSnapshot = parsePlanner(
        execute(
            "PUT",
            "/api/production-planner/state",
            session.token,
            JSONObject().put("state", state).put("baseRevision", baseRevision),
        ),
    )

    suspend fun createRequest(session: AdminSession, draft: RequestDraft) {
        execute("POST", "/api/ferie-permessi/requests", session.token, draft.toJson())
    }

    suspend fun updateRequest(session: AdminSession, draft: RequestDraft) {
        val id = requireNotNull(draft.id)
        execute(
            "PUT",
            "/api/ferie-permessi/requests/${encodeSegment(id)}",
            session.token,
            draft.toJson(),
        )
    }

    suspend fun approve(session: AdminSession, requestId: String) {
        execute(
            "POST",
            "/api/ferie-permessi/requests/${encodeSegment(requestId)}/approve",
            session.token,
            JSONObject().put("actor", session.adminName),
        )
    }

    suspend fun reject(session: AdminSession, requestId: String) {
        execute(
            "POST",
            "/api/ferie-permessi/requests/${encodeSegment(requestId)}/reject",
            session.token,
            JSONObject().put("actor", session.adminName),
        )
    }

    suspend fun deleteRequest(session: AdminSession, requestId: String) {
        execute(
            "DELETE",
            "/api/ferie-permessi/requests/${encodeSegment(requestId)}",
            session.token,
            JSONObject().put("actor", session.adminName),
        )
    }

    suspend fun addHoliday(session: AdminSession, date: String, name: String) {
        execute(
            "POST",
            "/api/ferie-permessi/holidays",
            session.token,
            JSONObject().put("dates", org.json.JSONArray().put(date)).put("name", name),
        )
    }

    suspend fun deleteHoliday(session: AdminSession, date: String) {
        execute(
            "DELETE",
            "/api/ferie-permessi/holidays/${encodeSegment(date)}",
            session.token,
            JSONObject(),
        )
    }

    suspend fun updateHoliday(
        session: AdminSession,
        originalDate: String,
        nextDate: String,
        nextName: String,
    ) {
        execute(
            "PUT",
            "/api/ferie-permessi/holidays/${encodeSegment(originalDate)}",
            session.token,
            JSONObject().put("nextDate", nextDate).put("nextName", nextName),
        )
    }

    suspend fun addClosure(session: AdminSession, closure: Closure) {
        execute("POST", "/api/ferie-permessi/closures", session.token, closure.toJson())
    }

    suspend fun deleteClosure(session: AdminSession, closure: Closure) {
        execute("DELETE", "/api/ferie-permessi/closures", session.token, closure.toJson())
    }

    suspend fun updateClosure(
        session: AdminSession,
        original: Closure,
        next: Closure,
    ) {
        execute(
            "PUT",
            "/api/ferie-permessi/closures",
            session.token,
            JSONObject().put("entry", original.toJson()).put("next", next.toJson()),
        )
    }

    suspend fun saveAssignees(
        session: AdminSession,
        groups: Map<String, List<String>>,
        emails: Map<String, String>,
    ) {
        val groupsJson = JSONObject()
        groups.forEach { (department, employees) ->
            groupsJson.put(department, org.json.JSONArray(employees))
        }
        execute(
            "PUT",
            "/api/mobile/calendar/assignees",
            session.token,
            JSONObject().put("groups", groupsJson).put("emails", JSONObject(emails)),
        )
    }

    suspend fun saveBalances(session: AdminSession, entries: List<BalanceEntry>) {
        val array = org.json.JSONArray()
        entries.forEach { entry ->
            array.put(
                JSONObject()
                    .put("key", entry.key)
                    .put("hoursAvailable", entry.hoursAvailable)
                    .put("monthlyAccrualHours", entry.monthlyAccrualHours),
            )
        }
        execute(
            "PUT",
            "/api/mobile/calendar/balances",
            session.token,
            JSONObject().put("entries", array),
        )
    }

    fun connectRealtime(
        session: AdminSession,
        onConnected: () -> Unit,
        onChanged: (String) -> Unit,
        onDisconnected: () -> Unit,
    ) {
        closeRealtime()
        val wsUrl = baseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://") + "/ws"
        val request = Request.Builder()
            .url(wsUrl)
            .header("Authorization", "Bearer ${session.token}")
            .build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = onConnected()

            override fun onMessage(webSocket: WebSocket, text: String) {
                val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                if (message.optString("type") == "module.changed") {
                    onChanged(message.optString("module"))
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) =
                onDisconnected()

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
                onDisconnected()
        })
    }

    fun closeRealtime() {
        socket?.close(1000, "Client closed")
        socket = null
    }

    private suspend fun executeArray(
        method: String,
        path: String,
        token: String,
        body: JSONArray,
    ): JSONObject {
        val builder = Request.Builder()
            .url("$baseUrl$path")
            .header("Accept", "application/json")
            .header("Authorization", "Bearer $token")
        val requestBody = body.toString().toRequestBody(jsonMedia)
        when (method) {
            "PUT" -> builder.put(requestBody)
            "POST" -> builder.post(requestBody)
            else -> error("Unsupported method")
        }
        val response = client.newCall(builder.build()).await()
        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw ApiException(it.code, errorMessage(text, it.code))
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private suspend fun execute(
        method: String,
        path: String,
        token: String? = null,
        body: JSONObject? = null,
    ): JSONObject {
        val builder = Request.Builder()
            .url("$baseUrl$path")
            .header("Accept", "application/json")
        if (!token.isNullOrBlank()) builder.header("Authorization", "Bearer $token")
        val requestBody = (body ?: JSONObject()).toString().toRequestBody(jsonMedia)
        when (method) {
            "GET" -> builder.get()
            "POST" -> builder.post(requestBody)
            "PUT" -> builder.put(requestBody)
            "DELETE" -> builder.delete(requestBody)
            else -> error("Unsupported method")
        }
        val response = client.newCall(builder.build()).await()
        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw ApiException(it.code, errorMessage(text, it.code))
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        }
    }

    private fun errorMessage(text: String, statusCode: Int): String =
        runCatching {
            JSONObject(text).optString("message")
                .ifBlank { JSONObject(text).optString("error") }
        }.getOrDefault("").ifBlank { "Errore $statusCode" }

    private fun encodeSegment(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response)
            }
        })
        continuation.invokeOnCancellation { cancel() }
    }
}
