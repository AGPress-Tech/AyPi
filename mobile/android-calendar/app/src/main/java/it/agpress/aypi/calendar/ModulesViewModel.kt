package it.agpress.aypi.calendar

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import it.agpress.aypi.calendar.data.AdminSession
import it.agpress.aypi.calendar.data.ApiException
import it.agpress.aypi.calendar.data.AyPiApi
import it.agpress.aypi.calendar.data.PlannerJob
import it.agpress.aypi.calendar.data.PlannerSnapshot
import it.agpress.aypi.calendar.data.PurchasingSnapshot
import it.agpress.aypi.calendar.data.SupportTicket
import it.agpress.aypi.calendar.data.TicketSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.DayOfWeek
import java.time.LocalDate

data class ModulesUiState(
    val purchasing: PurchasingSnapshot = PurchasingSnapshot(),
    val tickets: TicketSnapshot = TicketSnapshot(),
    val planner: PlannerSnapshot = PlannerSnapshot(),
    val purchasingLoaded: Boolean = false,
    val ticketsLoaded: Boolean = false,
    val plannerLoaded: Boolean = false,
    val loading: Boolean = false,
    val message: String? = null,
)

data class PurchaseDraft(
    val department: String,
    val employee: String,
    val notes: String,
    val product: String,
    val category: String,
    val quantity: Double,
    val unit: String,
    val urgency: String,
    val supplier: String,
    val lineNote: String,
    val interventionType: String = "",
    val description: String = "",
)

data class TicketDraft(
    val name: String,
    val surname: String,
    val email: String,
    val department: String,
    val issueType: String,
    val area: String,
    val priority: String,
    val description: String,
)

data class PlannerJobDraft(
    val id: String? = null,
    val customer: String,
    val article: String,
    val phase: String,
    val materialAlloy: String,
    val quantity: Double,
    val unit: String,
    val machineId: String,
    val start: LocalDate?,
    val durationDays: Int,
    val dueDate: LocalDate?,
    val firstDeliveryDate: LocalDate?,
    val materialStatus: String,
    val workStatus: String,
    val progressDays: Int,
    val notes: String,
)

class ModulesViewModel(application: Application) : AndroidViewModel(application) {
    private val api = AyPiApi()
    private val _state = MutableStateFlow(ModulesUiState())
    val state: StateFlow<ModulesUiState> = _state.asStateFlow()

    fun loadPurchasing(session: AdminSession, force: Boolean = false) {
        if (_state.value.purchasingLoaded && !force) return
        perform {
            val value = withContext(Dispatchers.IO) { api.purchasing(session) }
            _state.update { it.copy(purchasing = value, purchasingLoaded = true) }
        }
    }

    fun loadTickets(session: AdminSession, force: Boolean = false) {
        if (_state.value.ticketsLoaded && !force) return
        perform {
            val value = withContext(Dispatchers.IO) { api.tickets(session) }
            _state.update { it.copy(tickets = value, ticketsLoaded = true) }
        }
    }

    fun loadPlanner(session: AdminSession, force: Boolean = false) {
        if (_state.value.plannerLoaded && !force) return
        perform {
            val value = withContext(Dispatchers.IO) { api.planner(session) }
            _state.update { it.copy(planner = value, plannerLoaded = true) }
        }
    }

    fun createPurchase(
        session: AdminSession,
        intervention: Boolean,
        draft: PurchaseDraft,
    ) = mutatePurchasing(session, intervention) { items ->
        val now = Instant.now().toString()
        val line = JSONObject()
            .put("product", draft.product)
            .put("category", draft.category)
            .put("quantity", draft.quantity)
            .put("unit", draft.unit)
            .put("urgency", draft.urgency)
            .put("supplier", draft.supplier)
            .put("note", draft.lineNote)
            .put("interventionType", draft.interventionType)
            .put("description", draft.description)
            .put("confirmed", false)
        val request = JSONObject()
            .put("id", "mobile-${System.currentTimeMillis()}")
            .put("createdAt", now)
            .put("status", "pending")
            .put("department", draft.department)
            .put("employee", draft.employee)
            .put("createdBy", session.adminName)
            .put("adminName", session.adminName)
            .put("notes", draft.notes)
            .put("lines", JSONArray().put(line))
            .put(
                "history",
                JSONArray().put(
                    JSONObject()
                        .put("at", now)
                        .put("by", session.adminName)
                        .put("adminName", session.adminName)
                        .put("action", "Creata da AyPi mobile"),
                ),
            )
        items.add(request)
    }

    fun confirmPurchaseLine(
        session: AdminSession,
        intervention: Boolean,
        requestId: String,
        lineIndex: Int,
    ) = mutatePurchasing(session, intervention) { items ->
        val request = items.firstOrNull { it.optString("id") == requestId } ?: return@mutatePurchasing
        val line = request.optJSONArray("lines")?.optJSONObject(lineIndex) ?: return@mutatePurchasing
        line.put("confirmed", true)
            .put("confirmedAt", Instant.now().toString())
            .put("confirmedBy", session.adminName)
    }

    fun deletePurchase(
        session: AdminSession,
        intervention: Boolean,
        requestId: String,
    ) = mutatePurchasing(session, intervention) { items ->
        items.removeAll { it.optString("id") == requestId }
    }

    fun createTicket(session: AdminSession, draft: TicketDraft) =
        mutateTickets(session) { items ->
            val now = Instant.now().toString()
            items.add(
                JSONObject()
                    .put("id", "TS-${System.currentTimeMillis()}")
                    .put(
                        "requester",
                        JSONObject()
                            .put("name", draft.name)
                            .put("surname", draft.surname)
                            .put("email", draft.email)
                            .put("department", draft.department),
                    )
                    .put("issueType", draft.issueType)
                    .put("area", draft.area)
                    .put("priority", draft.priority)
                    .put("description", draft.description)
                    .put("status", "Da prendere in carico")
                    .put("createdAt", now)
                    .put("updatedAt", now)
                    .put("resolvedAt", "")
                    .put("closedAt", "")
                    .put("lastStatusChangeAt", now)
                    .put("createdByKey", session.adminName)
                    .put(
                        "history",
                        JSONArray().put(
                            JSONObject()
                                .put("at", now)
                                .put("event", "Ticket creato da AyPi mobile")
                                .put("actor", session.adminName)
                                .put("fromStatus", "")
                                .put("toStatus", "Da prendere in carico")
                                .put("note", ""),
                        ),
                    ),
            )
        }

    fun updateTicketStatus(
        session: AdminSession,
        ticketId: String,
        nextStatus: String,
        note: String,
    ) = mutateTickets(session) { items ->
        val ticket = items.firstOrNull { it.optString("id") == ticketId } ?: return@mutateTickets
        val previous = ticket.optString("status")
        val now = Instant.now().toString()
        ticket.put("status", nextStatus)
            .put("updatedAt", now)
            .put("lastStatusChangeAt", now)
        if (nextStatus == "Risolto") ticket.put("resolvedAt", now)
        if (nextStatus == "Chiuso") ticket.put("closedAt", now)
        val history = ticket.optJSONArray("history") ?: JSONArray().also {
            ticket.put("history", it)
        }
        history.put(
            JSONObject()
                .put("at", now)
                .put("event", "Cambio stato")
                .put("actor", session.adminName)
                .put("fromStatus", previous)
                .put("toStatus", nextStatus)
                .put("note", note),
        )
    }

    fun deleteTicket(session: AdminSession, ticketId: String) =
        mutateTickets(session) { items ->
            items.removeAll { it.optString("id") == ticketId }
        }

    fun savePlannerJob(session: AdminSession, draft: PlannerJobDraft) =
        mutatePlanner(session) { state ->
            val jobs = state.optJSONArray("jobs") ?: JSONArray().also { state.put("jobs", it) }
            val objects = (0 until jobs.length()).mapNotNull { jobs.optJSONObject(it) }.toMutableList()
            val existingIndex = objects.indexOfFirst { it.optString("id") == draft.id }
            val existing = objects.getOrNull(existingIndex) ?: JSONObject()
            val start = draft.start?.toString().orEmpty()
            val end = draft.start?.let {
                calculatePlannerEnd(
                    it,
                    draft.durationDays,
                    draft.machineId,
                    _state.value.planner,
                )
            }?.toString().orEmpty()
            val next = JSONObject(existing.toString())
                .put("id", draft.id ?: "job-${System.currentTimeMillis()}")
                .put("customer", draft.customer)
                .put("article", draft.article)
                .put("phase", draft.phase)
                .put("materialAlloy", draft.materialAlloy)
                .put("quantity", draft.quantity)
                .put("unit", draft.unit)
                .put("machineId", draft.machineId)
                .put("start", start)
                .put("end", end)
                .put("durationDays", draft.durationDays)
                .put("baseSpanDays", draft.durationDays)
                .put("dueDate", draft.dueDate?.toString().orEmpty())
                .put("firstDeliveryDate", draft.firstDeliveryDate?.toString().orEmpty())
                .put("materialStatus", draft.materialStatus)
                .put("workStatus", draft.workStatus)
                .put("progressDays", draft.progressDays.coerceIn(0, draft.durationDays))
                .put("notes", draft.notes)
            if (existingIndex >= 0) objects[existingIndex] = next else objects.add(next)
            state.put("jobs", JSONArray(objects))
        }

    fun updatePlannerJobState(
        session: AdminSession,
        job: PlannerJob,
        materialStatus: String = job.materialStatus,
        workStatus: String = job.workStatus,
        progressDays: Int = job.progressDays,
    ) = mutatePlanner(session) { state ->
        val jobs = state.optJSONArray("jobs") ?: return@mutatePlanner
        (0 until jobs.length()).mapNotNull { jobs.optJSONObject(it) }
            .firstOrNull { it.optString("id") == job.id }
            ?.apply {
                put("materialStatus", materialStatus)
                put("workStatus", workStatus)
                put(
                    "progressDays",
                    when (workStatus) {
                        "done" -> job.durationDays
                        "not_started" -> 0
                        else -> progressDays.coerceIn(0, job.durationDays)
                    },
                )
                if (workStatus == "done") put("completedAt", Instant.now().toString())
            }
    }

    fun deletePlannerJob(session: AdminSession, jobId: String) =
        mutatePlanner(session) { state ->
            val jobs = state.optJSONArray("jobs") ?: return@mutatePlanner
            val remaining = (0 until jobs.length())
                .mapNotNull { jobs.optJSONObject(it) }
                .filterNot { it.optString("id") == jobId }
            state.put("jobs", JSONArray(remaining))
        }

    fun clearMessage() = _state.update { it.copy(message = null) }

    private fun mutatePurchasing(
        session: AdminSession,
        intervention: Boolean,
        change: (MutableList<JSONObject>) -> Unit,
    ) = perform {
        val source = if (intervention) _state.value.purchasing.interventions
        else _state.value.purchasing.requests
        val items = source.map { JSONObject(it.raw) }.toMutableList()
        change(items)
        withContext(Dispatchers.IO) {
            api.savePurchasingRequests(session, intervention, items)
        }
        val next = withContext(Dispatchers.IO) { api.purchasing(session) }
        _state.update { it.copy(purchasing = next, purchasingLoaded = true) }
    }

    private fun mutateTickets(
        session: AdminSession,
        change: (MutableList<JSONObject>) -> Unit,
    ) = perform {
        val current = _state.value.tickets
        val items = current.tickets.map { JSONObject(it.raw) }.toMutableList()
        change(items)
        withContext(Dispatchers.IO) { api.saveTickets(session, current.version, items) }
        val next = withContext(Dispatchers.IO) { api.tickets(session) }
        _state.update { it.copy(tickets = next, ticketsLoaded = true) }
    }

    private fun mutatePlanner(
        session: AdminSession,
        change: (JSONObject) -> Unit,
    ) = perform {
        val current = _state.value.planner
        val nextState = JSONObject(current.rawState)
        change(nextState)
        val saved = withContext(Dispatchers.IO) {
            api.savePlanner(session, nextState, current.revision)
        }
        _state.update { it.copy(planner = saved, plannerLoaded = true) }
    }

    private fun perform(operation: suspend () -> Unit) {
        if (_state.value.loading) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, message = null) }
            runCatching { operation() }.onFailure { error ->
                val message = if (error is ApiException && error.statusCode == 409) {
                    "I dati sono stati modificati da un altro operatore. Aggiorna e riprova."
                } else {
                    error.message ?: "Operazione non riuscita."
                }
                _state.update { it.copy(message = message) }
            }
            _state.update { it.copy(loading = false) }
        }
    }

    private fun calculatePlannerEnd(
        start: LocalDate,
        durationDays: Int,
        machineId: String,
        planner: PlannerSnapshot,
    ): LocalDate {
        var cursor = start
        var remaining = durationDays.coerceAtLeast(1)
        while (true) {
            val weekend =
                cursor.dayOfWeek == DayOfWeek.SATURDAY ||
                    cursor.dayOfWeek == DayOfWeek.SUNDAY
            val unavailable = planner.unavailabilities.any {
                (it.machineId.isBlank() || it.machineId == machineId) &&
                    runCatching {
                        val first = LocalDate.parse(it.start.take(10))
                        val last = LocalDate.parse(it.end.take(10))
                        !cursor.isBefore(first) && !cursor.isAfter(last)
                    }.getOrDefault(false)
            }
            if (!weekend && !unavailable) {
                remaining--
                if (remaining == 0) return cursor
            }
            cursor = cursor.plusDays(1)
        }
    }
}
