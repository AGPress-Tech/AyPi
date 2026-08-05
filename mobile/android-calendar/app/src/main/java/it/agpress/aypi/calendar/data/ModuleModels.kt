package it.agpress.aypi.calendar.data

import org.json.JSONArray
import org.json.JSONObject

data class PurchaseLine(
    val product: String,
    val category: String,
    val quantity: Double,
    val unit: String,
    val urgency: String,
    val supplier: String,
    val note: String,
    val interventionType: String,
    val description: String,
    val confirmed: Boolean,
    val raw: String,
)

data class PurchaseRequest(
    val id: String,
    val createdAt: String,
    val status: String,
    val department: String,
    val employee: String,
    val notes: String,
    val lines: List<PurchaseLine>,
    val raw: String,
)

data class CatalogItem(
    val id: String,
    val name: String,
    val description: String,
    val category: String,
    val unit: String,
    val supplier: String,
    val url: String,
)

data class PurchasingSnapshot(
    val requests: List<PurchaseRequest> = emptyList(),
    val interventions: List<PurchaseRequest> = emptyList(),
    val catalog: List<CatalogItem> = emptyList(),
    val categories: List<String> = emptyList(),
    val interventionTypes: List<String> = emptyList(),
    val departments: List<String> = emptyList(),
    val employees: List<String> = emptyList(),
)

data class TicketHistory(
    val at: String,
    val event: String,
    val actor: String,
    val fromStatus: String,
    val toStatus: String,
    val note: String,
)

data class SupportTicket(
    val id: String,
    val requesterName: String,
    val requesterSurname: String,
    val requesterEmail: String,
    val department: String,
    val issueType: String,
    val area: String,
    val priority: String,
    val description: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
    val history: List<TicketHistory>,
    val raw: String,
)

data class TicketSnapshot(
    val version: Int = 1,
    val tickets: List<SupportTicket> = emptyList(),
    val issueTypes: List<String> = emptyList(),
    val areas: List<String> = emptyList(),
)

data class PlannerMachine(
    val id: String,
    val name: String,
    val department: String,
    val category: String,
    val color: String,
    val closedWeekdays: List<Int>,
)

data class PlannerJob(
    val id: String,
    val customer: String,
    val article: String,
    val phase: String,
    val materialAlloy: String,
    val quantity: Double,
    val unit: String,
    val machineId: String,
    val start: String,
    val end: String,
    val durationDays: Int,
    val dueDate: String,
    val firstDeliveryDate: String,
    val materialStatus: String,
    val workStatus: String,
    val progressDays: Int,
    val notes: String,
    val raw: String,
)

data class PlannerUnavailability(
    val id: String,
    val machineId: String,
    val type: String,
    val start: String,
    val end: String,
    val title: String,
)

data class PlannerSnapshot(
    val revision: Int = 0,
    val updatedAt: String = "",
    val updatedBy: String = "",
    val machines: List<PlannerMachine> = emptyList(),
    val jobs: List<PlannerJob> = emptyList(),
    val unavailabilities: List<PlannerUnavailability> = emptyList(),
    val rawState: String = "{}",
)

fun parsePurchasing(source: JSONObject): PurchasingSnapshot {
    val assignees = source.optJSONObject("assignees") ?: JSONObject()
    val groups = assignees.optJSONObject("groups") ?: JSONObject()
    val departments = groups.keys().asSequence().toList().sorted()
    val employees = departments
        .flatMap { groups.optJSONArray(it).stringValues() }
        .distinct()
        .sorted()
    return PurchasingSnapshot(
        requests = source.optJSONArray("requests").purchaseRequests(),
        interventions = source.optJSONArray("interventions").purchaseRequests(),
        catalog = source.optJSONArray("catalog").jsonObjects().map {
            CatalogItem(
                id = it.optString("id"),
                name = it.optString("name"),
                description = it.optString("description"),
                category = it.optString("category"),
                unit = it.optString("unit", "pz"),
                supplier = it.optString("supplier"),
                url = it.optString("url"),
            )
        },
        categories = source.optJSONArray("categories").stringValues(),
        interventionTypes = source.optJSONArray("interventionTypes").stringValues(),
        departments = departments,
        employees = employees,
    )
}

private fun JSONArray?.purchaseRequests(): List<PurchaseRequest> =
    jsonObjects().map { request ->
        PurchaseRequest(
            id = request.optString("id"),
            createdAt = request.optString("createdAt"),
            status = request.optString("status", "pending"),
            department = request.optString("department"),
            employee = request.optString("employee"),
            notes = request.optString("notes"),
            lines = request.optJSONArray("lines").jsonObjects().map { line ->
                PurchaseLine(
                    product = line.optString("product"),
                    category = line.optString("category"),
                    quantity = line.optDouble("quantity", 0.0),
                    unit = line.optString("unit", "pz"),
                    urgency = line.optString("urgency"),
                    supplier = line.optString("supplier"),
                    note = line.optString("note"),
                    interventionType = line.optString("interventionType"),
                    description = line.optString("description"),
                    confirmed = line.optBoolean("confirmed") ||
                        line.optString("confirmedAt").isNotBlank(),
                    raw = line.toString(),
                )
            },
            raw = request.toString(),
        )
    }

fun parseTickets(store: JSONObject, categories: JSONObject): TicketSnapshot =
    TicketSnapshot(
        version = store.optInt("version", 1),
        tickets = store.optJSONArray("tickets").jsonObjects().map { ticket ->
            val requester = ticket.optJSONObject("requester") ?: JSONObject()
            SupportTicket(
                id = ticket.optString("id"),
                requesterName = requester.optString("name"),
                requesterSurname = requester.optString("surname"),
                requesterEmail = requester.optString("email"),
                department = requester.optString("department"),
                issueType = ticket.optString("issueType"),
                area = ticket.optString("area"),
                priority = ticket.optString("priority"),
                description = ticket.optString("description"),
                status = ticket.optString("status", "Da prendere in carico"),
                createdAt = ticket.optString("createdAt"),
                updatedAt = ticket.optString("updatedAt"),
                history = ticket.optJSONArray("history").jsonObjects().map {
                    TicketHistory(
                        at = it.optString("at"),
                        event = it.optString("event"),
                        actor = it.optString("actor"),
                        fromStatus = it.optString("fromStatus"),
                        toStatus = it.optString("toStatus"),
                        note = it.optString("note"),
                    )
                },
                raw = ticket.toString(),
            )
        },
        issueTypes = categories.optJSONArray("issueTypes").stringValues(),
        areas = categories.optJSONArray("areas").stringValues(),
    )

fun parsePlanner(source: JSONObject): PlannerSnapshot {
    val state = source.optJSONObject("state") ?: JSONObject()
    return PlannerSnapshot(
        revision = source.optInt("revision"),
        updatedAt = source.optString("updatedAt"),
        updatedBy = source.optString("updatedBy"),
        machines = state.optJSONArray("machines").jsonObjects().map {
            val closedWeekdays = it.optJSONArray("closedWeekdays")?.let { days ->
                (0 until days.length())
                    .map { index -> days.optInt(index, -1) }
                    .filter { day -> day in 0..6 }
                    .distinct()
                    .takeIf { daysList -> daysList.size < 7 }
                    ?: listOf(0, 6)
            } ?: listOf(0, 6)
            PlannerMachine(
                id = it.optString("id"),
                name = it.optString("name"),
                department = it.optString("department"),
                category = it.optString("category"),
                color = it.optString("color", "#2386D8"),
                closedWeekdays = closedWeekdays,
            )
        },
        jobs = state.optJSONArray("jobs").jsonObjects().map {
            PlannerJob(
                id = it.optString("id"),
                customer = it.optString("customer"),
                article = it.optString("article"),
                phase = it.optString("phase"),
                materialAlloy = it.optString("materialAlloy"),
                quantity = it.optDouble("quantity"),
                unit = it.optString("unit", "pz"),
                machineId = it.optString("machineId"),
                start = it.optString("start"),
                end = it.optString("end"),
                durationDays = it.optInt("durationDays", 1).coerceAtLeast(1),
                dueDate = it.optString("dueDate"),
                firstDeliveryDate = it.optString("firstDeliveryDate"),
                materialStatus = it.optString("materialStatus", "available"),
                workStatus = it.optString("workStatus", "not_started"),
                progressDays = it.optInt("progressDays"),
                notes = it.optString("notes"),
                raw = it.toString(),
            )
        },
        unavailabilities = state.optJSONArray("unavailabilities").jsonObjects().map {
            PlannerUnavailability(
                id = it.optString("id"),
                machineId = it.optString("machineId"),
                type = it.optString("type"),
                start = it.optString("start"),
                end = it.optString("end"),
                title = it.optString("title"),
            )
        },
        rawState = state.toString(),
    )
}

internal fun JSONArray?.jsonObjects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

internal fun JSONArray?.stringValues(): List<String> =
    if (this == null) emptyList()
    else (0 until length()).map { optString(it).trim() }.filter { it.isNotBlank() }
