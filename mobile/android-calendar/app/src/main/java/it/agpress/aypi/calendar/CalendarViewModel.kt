package it.agpress.aypi.calendar

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import it.agpress.aypi.calendar.data.AdminSession
import it.agpress.aypi.calendar.data.ApiException
import it.agpress.aypi.calendar.data.AyPiApi
import it.agpress.aypi.calendar.data.CalendarSnapshot
import it.agpress.aypi.calendar.data.BalanceEntry
import it.agpress.aypi.calendar.data.Closure
import it.agpress.aypi.calendar.data.RequestDraft
import it.agpress.aypi.calendar.data.SecureSessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZonedDateTime

enum class RealtimeState { CONNECTING, CONNECTED, DISCONNECTED }

data class CalendarUiState(
    val restoringSession: Boolean = true,
    val session: AdminSession? = null,
    val snapshot: CalendarSnapshot = CalendarSnapshot(),
    val selectedDate: LocalDate = LocalDate.now(),
    val visibleMonth: YearMonth = YearMonth.now(),
    val loading: Boolean = false,
    val message: String? = null,
    val realtime: RealtimeState = RealtimeState.DISCONNECTED,
    val lastSync: ZonedDateTime? = null,
    val realtimeModule: String = "",
    val realtimeSequence: Long = 0,
)

class CalendarViewModel(application: Application) : AndroidViewModel(application) {
    private val api = AyPiApi()
    private val store = SecureSessionStore(application)
    private val _state = MutableStateFlow(CalendarUiState())
    val state: StateFlow<CalendarUiState> = _state.asStateFlow()
    private var reconnectJob: Job? = null
    private var realtimeGeneration = 0

    init {
        restoreSession()
    }

    fun login(adminName: String, password: String) = perform {
        val session = withContext(Dispatchers.IO) { api.login(adminName.trim(), password) }
        store.save(session)
        _state.update { it.copy(session = session, restoringSession = false) }
        refreshInternal(session)
        connectRealtime(session)
    }

    fun logout() {
        val session = state.value.session
        realtimeGeneration++
        reconnectJob?.cancel()
        api.closeRealtime()
        store.clear()
        _state.value = CalendarUiState(restoringSession = false)
        if (session != null) viewModelScope.launch(Dispatchers.IO) { api.logout(session) }
    }

    fun refresh() = perform {
        val session = requireSession()
        refreshInternal(session)
        if (_state.value.realtime != RealtimeState.CONNECTED) connectRealtime(session)
    }

    fun selectDate(date: LocalDate) {
        _state.update { it.copy(selectedDate = date, visibleMonth = YearMonth.from(date)) }
    }

    fun previousMonth() {
        _state.update { it.copy(visibleMonth = it.visibleMonth.minusMonths(1)) }
    }

    fun nextMonth() {
        _state.update { it.copy(visibleMonth = it.visibleMonth.plusMonths(1)) }
    }

    fun today() {
        val today = LocalDate.now()
        _state.update { it.copy(selectedDate = today, visibleMonth = YearMonth.from(today)) }
    }

    fun saveRequest(draft: RequestDraft) = mutate {
        if (draft.id == null) api.createRequest(it, draft) else api.updateRequest(it, draft)
    }

    fun approve(id: String) = mutate { api.approve(it, id) }
    fun reject(id: String) = mutate { api.reject(it, id) }
    fun deleteRequest(id: String) = mutate { api.deleteRequest(it, id) }
    fun addHoliday(date: LocalDate, name: String) =
        mutate { api.addHoliday(it, date.toString(), name) }
    fun deleteHoliday(date: LocalDate) =
        mutate { api.deleteHoliday(it, date.toString()) }
    fun updateHoliday(originalDate: LocalDate, nextDate: LocalDate, name: String) =
        mutate { api.updateHoliday(it, originalDate.toString(), nextDate.toString(), name) }
    fun addClosure(closure: Closure) =
        mutate { api.addClosure(it, closure) }
    fun deleteClosure(closure: Closure) =
        mutate { api.deleteClosure(it, closure) }
    fun updateClosure(original: Closure, next: Closure) =
        mutate { api.updateClosure(it, original, next) }
    fun saveAssignees(
        groups: Map<String, List<String>>,
        emails: Map<String, String>,
    ) = mutate { api.saveAssignees(it, groups, emails) }
    fun saveBalances(entries: List<BalanceEntry>) =
        mutate { api.saveBalances(it, entries) }

    fun clearMessage() {
        _state.update { it.copy(message = null) }
    }

    override fun onCleared() {
        realtimeGeneration++
        api.closeRealtime()
        super.onCleared()
    }

    private fun restoreSession() = viewModelScope.launch {
        val saved = withContext(Dispatchers.IO) { store.load() }
        if (saved == null) {
            _state.update { it.copy(restoringSession = false) }
            return@launch
        }
        runCatching {
            withContext(Dispatchers.IO) { api.validate(saved) }
            _state.update { it.copy(session = saved, restoringSession = false) }
            refreshInternal(saved)
            connectRealtime(saved)
        }.onFailure { error ->
            if (error is ApiException && error.statusCode == 401) {
                store.clear()
                _state.update {
                    CalendarUiState(
                        restoringSession = false,
                        message = "La sessione è scaduta. Accedi nuovamente.",
                    )
                }
            } else {
                _state.update { current ->
                    current.copy(
                        session = saved,
                        restoringSession = false,
                        message = friendlyError(error),
                    )
                }
            }
        }
    }

    private fun mutate(operation: suspend (AdminSession) -> Unit) = perform {
        val session = requireSession()
        withContext(Dispatchers.IO) { operation(session) }
        refreshInternal(session)
    }

    private fun perform(operation: suspend () -> Unit) {
        if (_state.value.loading) return
        viewModelScope.launch {
            _state.update { it.copy(loading = true, message = null) }
            runCatching { operation() }
                .onFailure { error ->
                    if (error is ApiException && error.statusCode == 401) {
                        store.clear()
                        api.closeRealtime()
                        _state.value = CalendarUiState(
                            restoringSession = false,
                            message = "Sessione non valida o scaduta.",
                        )
                    } else {
                        _state.update { it.copy(message = friendlyError(error)) }
                    }
                }
            _state.update { it.copy(loading = false) }
        }
    }

    private suspend fun refreshInternal(session: AdminSession) {
        val snapshot = withContext(Dispatchers.IO) { api.bootstrap(session) }
        _state.update { it.copy(snapshot = snapshot, lastSync = ZonedDateTime.now()) }
    }

    private fun connectRealtime(session: AdminSession) {
        val generation = ++realtimeGeneration
        reconnectJob?.cancel()
        _state.update { it.copy(realtime = RealtimeState.CONNECTING) }
        api.connectRealtime(
            session,
            onConnected = {
                if (generation == realtimeGeneration) {
                    _state.update { it.copy(realtime = RealtimeState.CONNECTED) }
                }
            },
            onChanged = { module ->
                if (generation == realtimeGeneration) {
                    _state.update {
                        it.copy(
                            realtimeModule = module,
                            realtimeSequence = it.realtimeSequence + 1,
                        )
                    }
                    if (module != "calendar" && module != "shared" && module != "*") {
                        return@connectRealtime
                    }
                    viewModelScope.launch {
                        runCatching { refreshInternal(session) }
                            .onFailure { error ->
                                _state.update { it.copy(message = friendlyError(error)) }
                            }
                    }
                }
            },
            onDisconnected = {
                if (generation == realtimeGeneration) scheduleReconnect(session, generation)
            },
        )
    }

    private fun scheduleReconnect(session: AdminSession, generation: Int) {
        _state.update { it.copy(realtime = RealtimeState.DISCONNECTED) }
        if (reconnectJob?.isActive == true) return
        reconnectJob = viewModelScope.launch {
            var waitMillis = 2_000L
            while (generation == realtimeGeneration && state.value.session != null) {
                delay(waitMillis)
                if (generation != realtimeGeneration) return@launch
                connectRealtime(session)
                return@launch
            }
        }
    }

    private fun requireSession(): AdminSession =
        requireNotNull(_state.value.session) { "Accesso richiesto" }

    private fun friendlyError(error: Throwable): String = when (error) {
        is ApiException -> error.message ?: "Richiesta non riuscita."
        is java.net.UnknownHostException -> "Server non raggiungibile. Controlla Internet."
        is java.net.SocketTimeoutException -> "Il server non ha risposto in tempo."
        else -> error.message ?: "Operazione non riuscita."
    }
}
