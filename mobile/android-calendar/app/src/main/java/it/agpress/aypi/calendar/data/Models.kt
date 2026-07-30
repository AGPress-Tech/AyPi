package it.agpress.aypi.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeParseException

data class AdminSession(
    val token: String,
    val adminName: String,
    val expiresAt: String,
    val calendar: Boolean = true,
    val purchasing: Boolean = true,
    val ticketSupport: Boolean = true,
    val productionPlanner: Boolean = true,
)

data class CalendarRequest(
    val id: String,
    val employee: String,
    val department: String,
    val type: String,
    val note: String,
    val status: String,
    val start: String,
    val end: String,
    val allDay: Boolean,
    val createdAt: String = "",
    val updatedAt: String = "",
    val approvedAt: String = "",
    val approvedBy: String = "",
    val rejectedAt: String = "",
    val rejectedBy: String = "",
    val modifiedAt: String = "",
    val modifiedBy: String = "",
    val balanceHours: Double? = null,
) {
    val startDate: LocalDate? get() = parseDate(start)
    val endDate: LocalDate? get() = parseDate(end)
    val startTime: LocalTime? get() = parseTime(start)
    val endTime: LocalTime? get() = parseTime(end)

    fun covers(day: LocalDate): Boolean {
        val first = startDate ?: return false
        val last = endDate ?: first
        return !day.isBefore(first) && !day.isAfter(last)
    }

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("employee", employee)
        .put("department", department)
        .put("type", type)
        .put("note", note)
        .put("status", status)
        .put("start", start)
        .put("end", end)
        .put("allDay", allDay)

    companion object {
        fun fromJson(source: JSONObject): CalendarRequest {
            val employeeValue = source.opt("employee")
            val employee = when (employeeValue) {
                is JSONObject -> employeeValue.optString("name")
                else -> employeeValue?.toString().orEmpty()
            }
            return CalendarRequest(
                id = source.optString("id"),
                employee = employee,
                department = source.optString("department"),
                type = source.optString("type", "ferie"),
                note = source.optString("note"),
                status = source.optString("status", "pending"),
                start = source.optString("start"),
                end = source.optString("end", source.optString("start")),
                allDay = source.optBoolean("allDay", true),
                createdAt = source.optString("createdAt"),
                updatedAt = source.optString("updatedAt"),
                approvedAt = source.optString("approvedAt"),
                approvedBy = source.optString("approvedBy"),
                rejectedAt = source.optString("rejectedAt"),
                rejectedBy = source.optString("rejectedBy"),
                modifiedAt = source.optString("modifiedAt"),
                modifiedBy = source.optString("modifiedBy"),
                balanceHours = source.opt("balanceHours")
                    ?.takeUnless { it == JSONObject.NULL }
                    ?.toString()
                    ?.toDoubleOrNull(),
            )
        }
    }
}

data class Holiday(val date: LocalDate, val name: String) {
    companion object {
        fun fromJson(value: Any?): Holiday? {
            val rawDate: String
            val name: String
            when (value) {
                is JSONObject -> {
                    rawDate = value.optString("date")
                    name = value.optString("name", "Festività")
                }
                is String -> {
                    rawDate = value
                    name = "Festività"
                }
                else -> return null
            }
            return runCatching { Holiday(LocalDate.parse(rawDate), name) }.getOrNull()
        }
    }
}

data class Closure(val start: LocalDate, val end: LocalDate, val name: String) {
    fun toJson(): JSONObject = JSONObject()
        .put("start", start.toString())
        .put("end", end.toString())
        .put("name", name)

    companion object {
        fun fromJson(value: Any?): Closure? {
            val rawStart: String
            val rawEnd: String
            val name: String
            when (value) {
                is JSONObject -> {
                    rawStart = value.optString("start")
                    rawEnd = value.optString("end", rawStart)
                    name = value.optString("name", "Chiusura")
                }
                is String -> {
                    rawStart = value
                    rawEnd = value
                    name = "Chiusura"
                }
                else -> return null
            }
            return runCatching {
                Closure(LocalDate.parse(rawStart), LocalDate.parse(rawEnd), name)
            }.getOrNull()
        }
    }
}

data class CalendarSnapshot(
    val requests: List<CalendarRequest> = emptyList(),
    val holidays: List<Holiday> = emptyList(),
    val closures: List<Closure> = emptyList(),
    val employees: List<String> = emptyList(),
    val departments: List<String> = emptyList(),
    val groups: Map<String, List<String>> = emptyMap(),
    val emails: Map<String, String> = emptyMap(),
    val balances: Map<String, BalanceEntry> = emptyMap(),
)

data class BalanceEntry(
    val key: String,
    val employee: String,
    val department: String,
    val employeeEmail: String,
    val hoursAvailable: Double,
    val monthlyAccrualHours: Double,
    val lastAccrualMonth: String,
    val closureAppliedHours: Double,
)

data class RequestDraft(
    val id: String? = null,
    val employee: String,
    val department: String,
    val type: String,
    val note: String,
    val start: LocalDate,
    val end: LocalDate,
    val allDay: Boolean = true,
    val startTime: LocalTime = LocalTime.of(8, 0),
    val endTime: LocalTime = LocalTime.of(17, 0),
    val status: String = "pending",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id ?: "${System.currentTimeMillis()}-mobile")
        .put("employee", employee)
        .put("department", department)
        .put("type", type)
        .put("note", note)
        .put("status", status)
        .put("start", if (allDay) start.toString() else "${start}T${startTime}")
        .put("end", if (allDay) end.toString() else "${end}T${endTime}")
        .put("allDay", allDay)
        .apply {
            if (id == null) put("createdAt", java.time.Instant.now().toString())
        }
}

fun parseBootstrap(source: JSONObject): CalendarSnapshot {
    val payload = source.optJSONObject("payload") ?: JSONObject()
    val requests = payload.optJSONArray("requests").objects()
        .map(CalendarRequest::fromJson)
        .filter { it.id.isNotBlank() }
    val holidays = payload.optJSONArray("holidays").values()
        .mapNotNull(Holiday::fromJson)
    val closures = payload.optJSONArray("closures").values()
        .mapNotNull(Closure::fromJson)

    val assignees = source.optJSONObject("assignees") ?: JSONObject()
    val groupsObject = assignees.optJSONObject("groups") ?: JSONObject()
    val groups = buildMap {
        groupsObject.keys().forEach { department ->
            put(department, groupsObject.optJSONArray(department).strings().distinct().sorted())
        }
    }
    val emailsObject = assignees.optJSONObject("emails") ?: JSONObject()
    val emails = buildMap {
        emailsObject.keys().forEach { key ->
            val email = emailsObject.optString(key).trim()
            if (email.isNotBlank()) put(key, email)
        }
    }
    val employees = buildSet {
        assignees.optJSONArray("options").strings().forEach(::add)
        groups.values.flatten().forEach(::add)
        requests.map { it.employee }.filter { it.isNotBlank() }.forEach(::add)
    }.sorted()
    val departments = buildSet {
        groups.keys.forEach(::add)
        requests.map { it.department }.filter { it.isNotBlank() }.forEach(::add)
    }.sorted()
    val balancesObject = payload.optJSONObject("balances") ?: JSONObject()
    val balances = buildMap {
        balancesObject.keys().forEach { key ->
            val entry = balancesObject.optJSONObject(key) ?: return@forEach
            val fallbackParts = key.split("|", limit = 2)
            put(
                key,
                BalanceEntry(
                    key = key,
                    employee = entry.optString(
                        "employee",
                        fallbackParts.getOrNull(1).orEmpty(),
                    ),
                    department = entry.optString(
                        "department",
                        fallbackParts.firstOrNull().orEmpty(),
                    ),
                    employeeEmail = entry.optString("employeeEmail"),
                    hoursAvailable = entry.optDouble("hoursAvailable", 0.0),
                    monthlyAccrualHours = entry.optDouble("monthlyAccrualHours", 16.0),
                    lastAccrualMonth = entry.optString("lastAccrualMonth"),
                    closureAppliedHours = entry.optDouble("closureAppliedHours", 0.0),
                ),
            )
        }
    }
    return CalendarSnapshot(
        requests,
        holidays,
        closures,
        employees,
        departments,
        groups,
        emails,
        balances,
    )
}

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

private fun JSONArray?.values(): List<Any?> =
    if (this == null) emptyList() else (0 until length()).map { opt(it) }

private fun JSONArray?.strings(): List<String> =
    values().map { it?.toString().orEmpty().trim() }.filter { it.isNotBlank() }

private fun parseDate(value: String): LocalDate? {
    if (value.isBlank()) return null
    return try {
        LocalDate.parse(value.take(10))
    } catch (_: DateTimeParseException) {
        runCatching { LocalDateTime.parse(value).toLocalDate() }.getOrNull()
    }
}

private fun parseTime(value: String): LocalTime? {
    if (!value.contains("T")) return null
    return runCatching { LocalDateTime.parse(value).toLocalTime() }.getOrNull()
}
