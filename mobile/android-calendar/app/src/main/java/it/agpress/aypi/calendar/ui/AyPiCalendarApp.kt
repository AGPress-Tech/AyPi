package it.agpress.aypi.calendar.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.ProductionQuantityLimits
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import it.agpress.aypi.calendar.CalendarUiState
import it.agpress.aypi.calendar.CalendarViewModel
import it.agpress.aypi.calendar.ModulesViewModel
import it.agpress.aypi.calendar.RealtimeState
import it.agpress.aypi.calendar.data.CalendarRequest
import it.agpress.aypi.calendar.data.BalanceEntry
import it.agpress.aypi.calendar.data.Closure
import it.agpress.aypi.calendar.data.RequestDraft
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

private enum class MainPage { CALENDAR, PENDING, ANALYSIS, ADMIN }
private enum class AppModule { CALENDAR, PURCHASING, TICKETS, PLANNER }

@Composable
fun AyPiCalendarApp(
    viewModel: CalendarViewModel,
    modulesViewModel: ModulesViewModel,
) {
    val state by viewModel.state.collectAsState()
    val modulesState by modulesViewModel.state.collectAsState()
    var selectedModule by remember(state.session) { mutableStateOf<AppModule?>(null) }
    LaunchedEffect(state.realtimeSequence, selectedModule) {
        val session = state.session ?: return@LaunchedEffect
        when (state.realtimeModule) {
            "purchasing" -> if (selectedModule == AppModule.PURCHASING) {
                modulesViewModel.loadPurchasing(session, true)
            }
            "ticket" -> if (selectedModule == AppModule.TICKETS) {
                modulesViewModel.loadTickets(session, true)
            }
            "production-planner" -> if (selectedModule == AppModule.PLANNER) {
                modulesViewModel.loadPlanner(session, true)
            }
        }
    }
    when {
        state.restoringSession -> LoadingScreen()
        state.session == null -> LoginScreen(state, viewModel)
        selectedModule == null -> ModuleHome(
            state = state,
            onOpen = { selectedModule = it },
            onLogout = viewModel::logout,
        )
        selectedModule == AppModule.CALENDAR ->
            CalendarShell(state, viewModel, onBack = { selectedModule = null })
        selectedModule == AppModule.PURCHASING ->
            PurchasingScreen(
                requireNotNull(state.session),
                modulesState,
                modulesViewModel,
            ) { selectedModule = null }
        selectedModule == AppModule.TICKETS ->
            TicketSupportScreen(
                requireNotNull(state.session),
                modulesState,
                modulesViewModel,
            ) { selectedModule = null }
        else ->
            PlannerScreen(
                requireNotNull(state.session),
                modulesState,
                modulesViewModel,
            ) { selectedModule = null }
    }
}

@Composable
private fun ModuleHome(
    state: CalendarUiState,
    onOpen: (AppModule) -> Unit,
    onLogout: () -> Unit,
) {
    val permissions = state.session
    Scaffold(
        topBar = {
            Surface(color = MaterialTheme.colorScheme.primary) {
                Row(
                    Modifier.fillMaxWidth().padding(20.dp, 18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "AyPi",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Black,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Text(
                            "Ciao, ${state.session?.adminName.orEmpty()}",
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = .8f),
                        )
                    }
                    IconButton(onClick = onLogout) {
                        Icon(Icons.Default.Logout, "Esci", tint = MaterialTheme.colorScheme.onPrimary)
                    }
                }
            }
        },
    ) { padding ->
        LazyColumn(
            Modifier.padding(padding).fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Text("Moduli", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Scegli la sezione di AyPi da utilizzare.")
            }
            item {
                ModuleCard(
                    title = "Calendar",
                    subtitle = "Ferie, permessi, ore e analisi",
                    icon = Icons.Default.CalendarMonth,
                    enabled = permissions?.calendar != false,
                    onClick = { onOpen(AppModule.CALENDAR) },
                )
            }
            item {
                ModuleCard(
                    "Purchasing",
                    "Richieste, interventi e catalogo",
                    Icons.Default.ShoppingCart,
                    permissions?.purchasing != false,
                ) { onOpen(AppModule.PURCHASING) }
            }
            item {
                ModuleCard(
                    "Ticket Support",
                    "Assistenza, stati e cronologia",
                    Icons.Default.SupportAgent,
                    permissions?.ticketSupport != false,
                ) { onOpen(AppModule.TICKETS) }
            }
            item {
                ModuleCard(
                    "Pianificazione",
                    "Lavorazioni, macchine e avanzamento",
                    Icons.Default.Build,
                    permissions?.productionPlanner != false,
                ) { onOpen(AppModule.PLANNER) }
            }
        }
    }
}

@Composable
private fun ModuleCard(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (enabled) MaterialTheme.colorScheme.primaryContainer
            else MaterialTheme.colorScheme.surfaceVariant,
        ),
        shape = RoundedCornerShape(20.dp),
    ) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                color = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                shape = RoundedCornerShape(14.dp),
            ) {
                Icon(
                    icon,
                    null,
                    tint = Color.White,
                    modifier = Modifier.padding(12.dp).size(28.dp),
                )
            }
            Spacer(Modifier.size(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall)
            }
            if (enabled) Icon(Icons.Default.ChevronRight, null)
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(Modifier.height(16.dp))
            Text("Connessione ad AyPi…")
        }
    }
}

@Composable
private fun LoginScreen(state: CalendarUiState, viewModel: CalendarViewModel) {
    var admin by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    Box(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.primary),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier.padding(24.dp).fillMaxWidth(),
            shape = RoundedCornerShape(28.dp),
            elevation = CardDefaults.cardElevation(12.dp),
        ) {
            Column(
                Modifier.padding(28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    "AyPi",
                    style = MaterialTheme.typography.displaySmall,
                    fontWeight = FontWeight.Black,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text("Calendar Admin", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "Accedi con un amministratore autorizzato al Calendar.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = admin,
                    onValueChange = { admin = it },
                    label = { Text("Nome amministratore") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    singleLine = true,
                    visualTransformation =
                        if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                null,
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                state.message?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                }
                Button(
                    onClick = { viewModel.login(admin, password) },
                    enabled = admin.isNotBlank() && password.isNotBlank() && !state.loading,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    if (state.loading) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Accedi")
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CalendarShell(
    state: CalendarUiState,
    viewModel: CalendarViewModel,
    onBack: () -> Unit,
) {
    var page by remember { mutableStateOf(MainPage.CALENDAR) }
    var editor by remember { mutableStateOf<CalendarRequest?>(null) }
    var details by remember { mutableStateOf<CalendarRequest?>(null) }
    var creating by remember { mutableStateOf(false) }
    var confirmAction by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Torna ai moduli")
                    }
                },
                title = {
                    Column {
                        Text("AyPi", fontWeight = FontWeight.Bold)
                        Text(
                            when (state.realtime) {
                                RealtimeState.CONNECTED -> "Sincronizzato in tempo reale"
                                RealtimeState.CONNECTING -> "Connessione…"
                                RealtimeState.DISCONNECTED -> "Offline · riconnessione automatica"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = when (state.realtime) {
                                RealtimeState.CONNECTED -> Color(0xFF16865A)
                                else -> MaterialTheme.colorScheme.error
                            },
                        )
                    }
                },
                actions = {
                    IconButton(onClick = viewModel::refresh, enabled = !state.loading) {
                        Icon(Icons.Default.Refresh, "Aggiorna")
                    }
                    IconButton(onClick = {
                        confirmAction = "Uscire dall'account?" to viewModel::logout
                    }) {
                        Icon(Icons.Default.Logout, "Esci")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar(Modifier.navigationBarsPadding()) {
                NavigationBarItem(
                    selected = page == MainPage.CALENDAR,
                    onClick = { page = MainPage.CALENDAR },
                    icon = { Icon(Icons.Default.CalendarMonth, null) },
                    label = { Text("Calendario") },
                )
                NavigationBarItem(
                    selected = page == MainPage.PENDING,
                    onClick = { page = MainPage.PENDING },
                    icon = { Icon(Icons.Default.Schedule, null) },
                    label = { Text("In attesa") },
                )
                NavigationBarItem(
                    selected = page == MainPage.ANALYSIS,
                    onClick = { page = MainPage.ANALYSIS },
                    icon = { Icon(Icons.Default.Analytics, null) },
                    label = { Text("Analisi") },
                )
                NavigationBarItem(
                    selected = page == MainPage.ADMIN,
                    onClick = { page = MainPage.ADMIN },
                    icon = { Icon(Icons.Default.AdminPanelSettings, null) },
                    label = { Text("Gestione") },
                )
            }
        },
        floatingActionButton = {
            if (page == MainPage.CALENDAR) {
                FloatingActionButton(onClick = { creating = true }) {
                    Icon(Icons.Default.Add, "Nuova richiesta")
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (page) {
                MainPage.CALENDAR -> CalendarPage(
                    state = state,
                    onPrevious = viewModel::previousMonth,
                    onNext = viewModel::nextMonth,
                    onToday = viewModel::today,
                    onSelect = viewModel::selectDate,
                    onEdit = { editor = it },
                    onDetails = { details = it },
                    onApprove = {
                        confirmAction = "Approvare la richiesta di ${it.employee}?" to {
                            viewModel.approve(it.id)
                        }
                    },
                    onReject = {
                        confirmAction = "Rifiutare la richiesta di ${it.employee}?" to {
                            viewModel.reject(it.id)
                        }
                    },
                    onDelete = {
                        confirmAction = "Eliminare definitivamente questa richiesta?" to {
                            viewModel.deleteRequest(it.id)
                        }
                    },
                )
                MainPage.PENDING -> PendingPage(
                    state.snapshot.requests.filter { it.status == "pending" },
                    onDetails = { details = it },
                    onEdit = { editor = it },
                    onApprove = {
                        confirmAction = "Approvare la richiesta di ${it.employee}?" to {
                            viewModel.approve(it.id)
                        }
                    },
                    onReject = {
                        confirmAction = "Rifiutare la richiesta di ${it.employee}?" to {
                            viewModel.reject(it.id)
                        }
                    },
                )
                MainPage.ANALYSIS -> AnalysisPage(state.snapshot)
                MainPage.ADMIN -> AdminPage(state, viewModel) { text, action ->
                    confirmAction = text to action
                }
            }
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }

    if (creating || editor != null) {
        RequestEditor(
            request = editor,
            state = state,
            onDismiss = {
                creating = false
                editor = null
            },
            onSave = {
                viewModel.saveRequest(it)
                creating = false
                editor = null
            },
        )
    }
    details?.let {
        RequestDetailsDialog(
            request = it,
            onDismiss = { details = null },
            onEdit = {
                details = null
                editor = it
            },
        )
    }
    confirmAction?.let { (text, action) ->
        AlertDialog(
            onDismissRequest = { confirmAction = null },
            title = { Text("Conferma") },
            text = { Text(text) },
            confirmButton = {
                Button(onClick = {
                    confirmAction = null
                    action()
                }) { Text("Conferma") }
            },
            dismissButton = {
                TextButton(onClick = { confirmAction = null }) { Text("Annulla") }
            },
        )
    }
    state.message?.let {
        AlertDialog(
            onDismissRequest = viewModel::clearMessage,
            title = { Text("AyPi") },
            text = { Text(it) },
            confirmButton = {
                TextButton(onClick = viewModel::clearMessage) { Text("OK") }
            },
        )
    }
}

@Composable
private fun CalendarPage(
    state: CalendarUiState,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
    onSelect: (LocalDate) -> Unit,
    onDetails: (CalendarRequest) -> Unit,
    onEdit: (CalendarRequest) -> Unit,
    onApprove: (CalendarRequest) -> Unit,
    onReject: (CalendarRequest) -> Unit,
    onDelete: (CalendarRequest) -> Unit,
) {
    val selectedRequests = state.snapshot.requests
        .filter { it.covers(state.selectedDate) && it.status != "rejected" }
        .sortedBy { it.employee }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 12.dp, 16.dp, 100.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            MonthCalendar(
                month = state.visibleMonth,
                selected = state.selectedDate,
                requests = state.snapshot.requests,
                holidays = state.snapshot.holidays.map { it.date }.toSet(),
                closures = state.snapshot.closures,
                onPrevious = onPrevious,
                onNext = onNext,
                onToday = onToday,
                onSelect = onSelect,
            )
        }
        item {
            Text(
                state.selectedDate.format(DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.ITALIAN))
                    .replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
        if (selectedRequests.isEmpty()) {
            item { EmptyCard("Nessuna voce per questa giornata.") }
        } else {
            items(selectedRequests, key = { it.id }) {
                RequestCard(it, onDetails, onEdit, onApprove, onReject, onDelete)
            }
        }
    }
}

@Composable
private fun MonthCalendar(
    month: YearMonth,
    selected: LocalDate,
    requests: List<CalendarRequest>,
    holidays: Set<LocalDate>,
    closures: List<Closure>,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onToday: () -> Unit,
    onSelect: (LocalDate) -> Unit,
) {
    Card(shape = RoundedCornerShape(20.dp)) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onPrevious) { Icon(Icons.Default.ChevronLeft, "Mese precedente") }
                Text(
                    month.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ITALIAN))
                        .replaceFirstChar { it.uppercase() },
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center,
                    fontWeight = FontWeight.Bold,
                )
                IconButton(onClick = onNext) { Icon(Icons.Default.ChevronRight, "Mese successivo") }
            }
            TextButton(onClick = onToday, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                Text("Oggi")
            }
            Row(Modifier.fillMaxWidth()) {
                DayOfWeek.entries.forEach {
                    Text(
                        it.getDisplayName(TextStyle.SHORT, Locale.ITALIAN),
                        modifier = Modifier.weight(1f),
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
            val first = month.atDay(1)
            val leading = first.dayOfWeek.value - 1
            val cells = leading + month.lengthOfMonth()
            repeat((cells + 6) / 7) { week ->
                Row(Modifier.fillMaxWidth()) {
                    repeat(7) { column ->
                        val dayNumber = week * 7 + column - leading + 1
                        if (dayNumber !in 1..month.lengthOfMonth()) {
                            Spacer(Modifier.weight(1f).aspectRatio(1f))
                        } else {
                            val day = month.atDay(dayNumber)
                            val count = requests.count { it.covers(day) && it.status != "rejected" }
                            val isClosed = day in holidays ||
                                closures.any { !day.isBefore(it.start) && !day.isAfter(it.end) }
                            DayCell(
                                day = day,
                                selected = day == selected,
                                count = count,
                                closed = isClosed,
                                modifier = Modifier.weight(1f),
                                onClick = { onSelect(day) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    day: LocalDate,
    selected: Boolean,
    count: Int,
    closed: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .aspectRatio(1f)
            .padding(2.dp)
            .clip(CircleShape)
            .background(
                when {
                    selected -> MaterialTheme.colorScheme.primary
                    closed -> MaterialTheme.colorScheme.error.copy(alpha = .10f)
                    else -> Color.Transparent
                },
            )
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                day.dayOfMonth.toString(),
                color = if (selected) MaterialTheme.colorScheme.onPrimary
                else MaterialTheme.colorScheme.onSurface,
                fontWeight = if (day == LocalDate.now()) FontWeight.Black else FontWeight.Normal,
            )
            if (count > 0) {
                Box(
                    Modifier.size(5.dp).clip(CircleShape).background(
                        if (selected) MaterialTheme.colorScheme.onPrimary
                        else MaterialTheme.colorScheme.tertiary,
                    ),
                )
            }
        }
    }
}

@Composable
private fun RequestCard(
    request: CalendarRequest,
    onDetails: (CalendarRequest) -> Unit,
    onEdit: (CalendarRequest) -> Unit,
    onApprove: (CalendarRequest) -> Unit,
    onReject: (CalendarRequest) -> Unit,
    onDelete: (CalendarRequest) -> Unit,
) {
    val color = typeColor(request.type)
    Card(
        modifier = Modifier.fillMaxWidth().clickable { onDetails(request) },
        colors = CardDefaults.cardColors(containerColor = color.copy(alpha = .09f)),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(CircleShape).background(color))
                Spacer(Modifier.size(8.dp))
                Text(request.employee, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                StatusChip(request.status)
            }
            Text("${typeLabel(request.type)} · ${request.department.ifBlank { "Nessun reparto" }}")
            Text(
                "${formatDate(request.startDate)} → ${formatDate(request.endDate)}",
                style = MaterialTheme.typography.bodySmall,
            )
            if (request.note.isNotBlank()) Text(request.note, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                if (request.status == "pending") {
                    IconButton(onClick = { onApprove(request) }) {
                        Icon(Icons.Default.Check, "Approva", tint = Color(0xFF16865A))
                    }
                    IconButton(onClick = { onReject(request) }) {
                        Icon(Icons.Default.Close, "Rifiuta", tint = MaterialTheme.colorScheme.error)
                    }
                }
                IconButton(onClick = { onEdit(request) }) {
                    Icon(Icons.Default.Edit, "Modifica")
                }
                IconButton(onClick = { onDelete(request) }) {
                    Icon(Icons.Default.Delete, "Elimina")
                }
            }
        }
    }
}

@Composable
private fun StatusChip(status: String) {
    val (label, color) = when (status) {
        "approved" -> "Approvata" to Color(0xFF16865A)
        "rejected" -> "Rifiutata" to MaterialTheme.colorScheme.error
        else -> "In attesa" to Color(0xFFB66A00)
    }
    Surface(color = color.copy(alpha = .12f), shape = CircleShape) {
        Text(
            label,
            color = color,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun PendingPage(
    requests: List<CalendarRequest>,
    onDetails: (CalendarRequest) -> Unit,
    onEdit: (CalendarRequest) -> Unit,
    onApprove: (CalendarRequest) -> Unit,
    onReject: (CalendarRequest) -> Unit,
) {
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 16.dp, 16.dp, 100.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("Richieste in attesa", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("${requests.size} richieste da verificare")
        }
        if (requests.isEmpty()) item { EmptyCard("Nessuna richiesta in attesa.") }
        items(requests.sortedBy { it.start }, key = { it.id }) {
            RequestCard(it, onDetails, onEdit, onApprove, onReject) {}
        }
    }
}

@Composable
private fun RequestEditor(
    request: CalendarRequest?,
    state: CalendarUiState,
    onDismiss: () -> Unit,
    onSave: (RequestDraft) -> Unit,
) {
    var employee by remember(request) { mutableStateOf(request?.employee.orEmpty()) }
    var department by remember(request) { mutableStateOf(request?.department.orEmpty()) }
    var type by remember(request) { mutableStateOf(request?.type ?: "ferie") }
    var note by remember(request) { mutableStateOf(request?.note.orEmpty()) }
    var start by remember(request) { mutableStateOf(request?.startDate ?: state.selectedDate) }
    var end by remember(request) { mutableStateOf(request?.endDate ?: start) }
    var allDay by remember(request) { mutableStateOf(request?.allDay ?: true) }
    var startTime by remember(request) {
        mutableStateOf(request?.startTime ?: LocalTime.of(8, 0))
    }
    var endTime by remember(request) {
        mutableStateOf(request?.endTime ?: LocalTime.of(17, 0))
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (request == null) "Nuova richiesta" else "Modifica richiesta") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ChoiceField("Dipendente", employee, state.snapshot.employees) { employee = it }
                ChoiceField("Reparto", department, state.snapshot.departments) { department = it }
                ChoiceField(
                    "Tipologia",
                    typeLabel(type),
                    listOf("ferie", "permesso", "retribuito", "straordinari", "mutua", "infortunio", "speciale"),
                    labels = true,
                ) { type = it }
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                    ),
                ) {
                    Row(
                        Modifier.fillMaxWidth().padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Giornata intera", fontWeight = FontWeight.Bold)
                            Text(
                                if (allDay) "La richiesta copre l’intera giornata"
                                else "Specifica l’orario di inizio e fine",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        Switch(
                            checked = allDay,
                            onCheckedChange = {
                                allDay = it
                                if (!it) end = start
                            },
                        )
                    }
                }
                DateField("Dal", start) {
                    start = it
                    if (!allDay || end.isBefore(start)) end = start
                }
                if (allDay) {
                    DateField("Al", end, minDate = start) { end = it }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TimeField(
                            "Dalle",
                            startTime,
                            Modifier.weight(1f),
                        ) { startTime = it }
                        TimeField(
                            "Alle",
                            endTime,
                            Modifier.weight(1f),
                        ) { endTime = it }
                    }
                    if (!endTime.isAfter(startTime)) {
                        Text(
                            "L’orario finale deve essere successivo a quello iniziale.",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("Note (opzionali)") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(
                        RequestDraft(
                            id = request?.id,
                            employee = employee.trim(),
                            department = department.trim(),
                            type = type,
                            note = note.trim(),
                            start = start,
                            end = end,
                            allDay = allDay,
                            startTime = startTime,
                            endTime = endTime,
                            status = request?.status ?: "pending",
                        ),
                    )
                },
                enabled = employee.isNotBlank() &&
                    !end.isBefore(start) &&
                    (allDay || endTime.isAfter(startTime)),
            ) { Text("Salva") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

@Composable
private fun ChoiceField(
    label: String,
    value: String,
    choices: List<String>,
    labels: Boolean = false,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedTextField(
            value = value,
            onValueChange = onSelect,
            label = { Text(label) },
            modifier = Modifier.fillMaxWidth(),
            trailingIcon = {
                IconButton(onClick = { expanded = true }) {
                    Icon(Icons.Default.ChevronRight, "Scegli")
                }
            },
            singleLine = true,
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            choices.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(if (labels) typeLabel(choice) else choice) },
                    onClick = {
                        onSelect(choice)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun DateField(
    label: String,
    value: LocalDate,
    minDate: LocalDate? = null,
    onSelect: (LocalDate) -> Unit,
) {
    val context = LocalContext.current
    OutlinedButton(
        onClick = {
            DatePickerDialog(
                context,
                { _, year, month, day ->
                    onSelect(LocalDate.of(year, month + 1, day))
                },
                value.year,
                value.monthValue - 1,
                value.dayOfMonth,
            ).apply {
                minDate?.let {
                    datePicker.minDate = it.atStartOfDay(java.time.ZoneId.systemDefault())
                        .toInstant().toEpochMilli()
                }
            }.show()
        },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(Icons.Default.EventAvailable, null)
        Spacer(Modifier.size(8.dp))
        Text("$label: ${formatDate(value)}")
    }
}

@Composable
private fun TimeField(
    label: String,
    value: LocalTime,
    modifier: Modifier = Modifier,
    onSelect: (LocalTime) -> Unit,
) {
    val context = LocalContext.current
    OutlinedButton(
        onClick = {
            TimePickerDialog(
                context,
                { _, hour, minute -> onSelect(LocalTime.of(hour, minute)) },
                value.hour,
                value.minute,
                true,
            ).show()
        },
        modifier = modifier,
    ) {
        Text("$label ${value.format(DateTimeFormatter.ofPattern("HH:mm"))}")
    }
}

@Composable
private fun AdminPage(
    state: CalendarUiState,
    viewModel: CalendarViewModel,
    confirm: (String, () -> Unit) -> Unit,
) {
    var section by remember { mutableStateOf("calendar") }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            AssistChip(
                onClick = { section = "calendar" },
                label = { Text("Calendario") },
                leadingIcon = { Icon(Icons.Default.CalendarMonth, null, Modifier.size(18.dp)) },
            )
            AssistChip(
                onClick = { section = "hours" },
                label = { Text("Ore") },
                leadingIcon = { Icon(Icons.Default.Schedule, null, Modifier.size(18.dp)) },
            )
            AssistChip(
                onClick = { section = "employees" },
                label = { Text("Dipendenti") },
                leadingIcon = { Icon(Icons.Default.Group, null, Modifier.size(18.dp)) },
            )
        }
        Box(Modifier.weight(1f)) {
            when (section) {
                "hours" -> HoursManagementPage(state, viewModel, confirm)
                "employees" -> EmployeesManagementPage(state, viewModel, confirm)
                else -> CalendarManagementPage(state, viewModel, confirm)
            }
        }
    }
}

@Composable
private fun CalendarManagementPage(
    state: CalendarUiState,
    viewModel: CalendarViewModel,
    confirm: (String, () -> Unit) -> Unit,
) {
    var holidayDialog by remember { mutableStateOf(false) }
    var closureDialog by remember { mutableStateOf(false) }
    var holidayEditing by remember { mutableStateOf<it.agpress.aypi.calendar.data.Holiday?>(null) }
    var closureEditing by remember { mutableStateOf<Closure?>(null) }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 16.dp, 16.dp, 100.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("Gestione Calendar", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Festività e chiusure aziendali condivise con tutti i client.")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = { holidayDialog = true }, label = { Text("Aggiungi festività") })
                AssistChip(onClick = { closureDialog = true }, label = { Text("Aggiungi chiusura") })
            }
        }
        item { Text("Festività", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
        if (state.snapshot.holidays.isEmpty()) item { EmptyCard("Nessuna festività configurata.") }
        items(state.snapshot.holidays.sortedBy { it.date }, key = { it.date.toString() }) { holiday ->
            ManagementRow(
                holiday.name,
                formatDate(holiday.date),
                onEdit = { holidayEditing = holiday },
                onDelete = {
                    confirm("Eliminare ${holiday.name} del ${formatDate(holiday.date)}?") {
                        viewModel.deleteHoliday(holiday.date)
                    }
                },
            )
        }
        item { Text("Chiusure", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
        if (state.snapshot.closures.isEmpty()) item { EmptyCard("Nessuna chiusura configurata.") }
        items(state.snapshot.closures.sortedBy { it.start }, key = { "${it.start}-${it.end}-${it.name}" }) { closure ->
            ManagementRow(
                closure.name,
                "${formatDate(closure.start)} → ${formatDate(closure.end)}",
                onEdit = { closureEditing = closure },
                onDelete = {
                    confirm("Eliminare la chiusura ${closure.name}?") {
                        viewModel.deleteClosure(closure)
                    }
                },
            )
        }
    }
    if (holidayDialog) {
        HolidayDialog(
            onDismiss = { holidayDialog = false },
            onSave = { date, name ->
                viewModel.addHoliday(date, name)
                holidayDialog = false
            },
        )
    }
    holidayEditing?.let { original ->
        HolidayDialog(
            initialDate = original.date,
            initialName = original.name,
            title = "Modifica festività",
            onDismiss = { holidayEditing = null },
            onSave = { date, name ->
                viewModel.updateHoliday(original.date, date, name)
                holidayEditing = null
            },
        )
    }
    if (closureDialog) {
        ClosureDialog(
            onDismiss = { closureDialog = false },
            onSave = {
                viewModel.addClosure(it)
                closureDialog = false
            },
        )
    }
    closureEditing?.let { original ->
        ClosureDialog(
            initial = original,
            title = "Modifica chiusura",
            onDismiss = { closureEditing = null },
            onSave = {
                viewModel.updateClosure(original, it)
                closureEditing = null
            },
        )
    }
}

@Composable
private fun ManagementRow(
    title: String,
    subtitle: String,
    onEdit: (() -> Unit)? = null,
    onDelete: () -> Unit,
) {
    Card {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title.ifBlank { "Senza nome" }, fontWeight = FontWeight.Bold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall)
            }
            if (onEdit != null) {
                IconButton(onClick = onEdit) {
                    Icon(Icons.Default.Edit, "Modifica")
                }
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Elimina", tint = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@Composable
private fun HolidayDialog(
    initialDate: LocalDate = LocalDate.now(),
    initialName: String = "Festività",
    title: String = "Nuova festività",
    onDismiss: () -> Unit,
    onSave: (LocalDate, String) -> Unit,
) {
    var date by remember(initialDate) { mutableStateOf(initialDate) }
    var name by remember(initialName) { mutableStateOf(initialName) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                DateField("Data", date) { date = it }
                OutlinedTextField(name, { name = it }, label = { Text("Nome") })
            }
        },
        confirmButton = {
            Button(onClick = { onSave(date, name.trim()) }, enabled = name.isNotBlank()) {
                Text("Aggiungi")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

@Composable
private fun ClosureDialog(
    initial: Closure = Closure(LocalDate.now(), LocalDate.now(), "Chiusura aziendale"),
    title: String = "Nuova chiusura",
    onDismiss: () -> Unit,
    onSave: (Closure) -> Unit,
) {
    var start by remember(initial) { mutableStateOf(initial.start) }
    var end by remember(initial) { mutableStateOf(initial.end) }
    var name by remember(initial) { mutableStateOf(initial.name) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                DateField("Dal", start) {
                    start = it
                    if (end.isBefore(start)) end = start
                }
                DateField("Al", end, minDate = start) { end = it }
                OutlinedTextField(name, { name = it }, label = { Text("Nome") })
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(Closure(start, end, name.trim())) },
                enabled = name.isNotBlank() && !end.isBefore(start),
            ) { Text("Aggiungi") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

private data class HourEdit(
    val source: BalanceEntry,
    val hours: String,
    val accrual: String,
)

@Composable
private fun HoursManagementPage(
    state: CalendarUiState,
    viewModel: CalendarViewModel,
    confirm: (String, () -> Unit) -> Unit,
) {
    var rows by remember(state.snapshot.balances) {
        mutableStateOf(
            state.snapshot.balances.values
                .filter { it.employee.isNotBlank() }
                .sortedWith(compareBy({ it.department }, { it.employee }))
                .map {
                    HourEdit(
                        it,
                        formatDecimal(it.hoursAvailable),
                        formatDecimal(it.monthlyAccrualHours),
                    )
                },
        )
    }
    val valid = rows.all {
        it.hours.replace(',', '.').toDoubleOrNull() != null &&
            (it.accrual.replace(',', '.').toDoubleOrNull() ?: -1.0) >= 0
    }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 8.dp, 16.dp, 100.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("Gestione ore", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Modifica il residuo e l’accredito mensile dei dipendenti.")
        }
        item {
            Button(
                onClick = {
                    confirm("Salvare le modifiche alle ore di ${rows.size} dipendenti?") {
                        viewModel.saveBalances(
                            rows.map {
                                it.source.copy(
                                    hoursAvailable = it.hours.replace(',', '.').toDouble(),
                                    monthlyAccrualHours = it.accrual.replace(',', '.').toDouble(),
                                )
                            },
                        )
                    }
                },
                enabled = rows.isNotEmpty() && valid,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Salva modifiche") }
        }
        if (rows.isEmpty()) item { EmptyCard("Nessun dipendente configurato.") }
        items(rows, key = { it.source.key }) { row ->
            val index = rows.indexOfFirst { it.source.key == row.source.key }
            Card {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(row.source.employee, fontWeight = FontWeight.Bold)
                    Text(
                        row.source.department.ifBlank { "Senza reparto" },
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = row.hours,
                            onValueChange = { value ->
                                rows = rows.toMutableList().also {
                                    it[index] = row.copy(hours = value)
                                }
                            },
                            label = { Text("Ore disponibili") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                        )
                        OutlinedTextField(
                            value = row.accrual,
                            onValueChange = { value ->
                                rows = rows.toMutableList().also {
                                    it[index] = row.copy(accrual = value)
                                }
                            },
                            label = { Text("Accredito/mese") },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                        )
                    }
                    Text(
                        "Ultimo accredito: ${row.source.lastAccrualMonth.ifBlank { "—" }} · " +
                            "Chiusure scalate: ${formatDecimal(row.source.closureAppliedHours)} h",
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

@Composable
private fun EmployeesManagementPage(
    state: CalendarUiState,
    viewModel: CalendarViewModel,
    confirm: (String, () -> Unit) -> Unit,
) {
    var departmentDialog by remember { mutableStateOf(false) }
    var employeeDialog by remember { mutableStateOf<Pair<String, String>?>(null) }
    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 8.dp, 16.dp, 100.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Text("Gestione dipendenti", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Reparti, operatori e indirizzi email condivisi con AyPi desktop.")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip(onClick = { departmentDialog = true }, label = { Text("+ Reparto") })
                AssistChip(
                    onClick = {
                        val first = state.snapshot.groups.keys.sorted().firstOrNull()
                        if (first != null) employeeDialog = first to ""
                    },
                    enabled = state.snapshot.groups.isNotEmpty(),
                    label = { Text("+ Dipendente") },
                )
            }
        }
        if (state.snapshot.groups.isEmpty()) item { EmptyCard("Nessun reparto configurato.") }
        state.snapshot.groups.toSortedMap().forEach { (department, employees) ->
            item(key = "dept-$department") {
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                    Row(
                        Modifier.fillMaxWidth().padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(department, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        Text("${employees.size} dip.", style = MaterialTheme.typography.labelSmall)
                        IconButton(onClick = {
                            confirm("Eliminare il reparto $department e i suoi dipendenti?") {
                                val groups = state.snapshot.groups.toMutableMap().apply { remove(department) }
                                val prefix = "$department|"
                                val emails = state.snapshot.emails.filterKeys { !it.startsWith(prefix) }
                                viewModel.saveAssignees(groups, emails)
                            }
                        }) {
                            Icon(Icons.Default.Delete, "Elimina reparto", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
            items(employees.sorted(), key = { "$department|$it" }) { employee ->
                val email = state.snapshot.emails["$department|$employee"].orEmpty()
                Card(
                    modifier = Modifier.fillMaxWidth().clickable {
                        employeeDialog = department to employee
                    },
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(employee, fontWeight = FontWeight.SemiBold)
                            Text(email.ifBlank { "Nessuna email" }, style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.Default.Edit, "Modifica")
                    }
                }
            }
        }
    }
    if (departmentDialog) {
        TextInputDialog(
            title = "Nuovo reparto",
            label = "Nome reparto",
            onDismiss = { departmentDialog = false },
        ) { name ->
            val groups = state.snapshot.groups.toMutableMap()
            if (!groups.containsKey(name)) groups[name] = emptyList()
            viewModel.saveAssignees(groups, state.snapshot.emails)
            departmentDialog = false
        }
    }
    employeeDialog?.let { (originalDepartment, originalName) ->
        EmployeeDialog(
            departments = state.snapshot.groups.keys.sorted(),
            initialDepartment = originalDepartment,
            initialName = originalName,
            initialEmail = state.snapshot.emails["$originalDepartment|$originalName"].orEmpty(),
            onDismiss = { employeeDialog = null },
            onDelete = if (originalName.isBlank()) null else {
                {
                    confirm("Eliminare il dipendente $originalName?") {
                        val groups = state.snapshot.groups.mapValues { (department, employees) ->
                            if (department == originalDepartment) employees.filterNot { it == originalName }
                            else employees
                        }
                        val emails = state.snapshot.emails.toMutableMap().apply {
                            remove("$originalDepartment|$originalName")
                        }
                        viewModel.saveAssignees(groups, emails)
                    }
                    employeeDialog = null
                }
            },
        ) { department, name, email ->
            val groups = state.snapshot.groups
                .mapValues { (_, employees) -> employees.toMutableList() }
                .toMutableMap()
            if (originalName.isNotBlank()) {
                groups[originalDepartment]?.remove(originalName)
            }
            groups.getOrPut(department) { mutableListOf() }.apply {
                if (none { it.equals(name, ignoreCase = true) }) add(name)
                sort()
            }
            val emails = state.snapshot.emails.toMutableMap().apply {
                if (originalName.isNotBlank()) remove("$originalDepartment|$originalName")
                if (email.isNotBlank()) put("$department|$name", email)
            }
            viewModel.saveAssignees(groups, emails)
            employeeDialog = null
        }
    }
}

@Composable
private fun TextInputDialog(
    title: String,
    label: String,
    onDismiss: () -> Unit,
    onSave: (String) -> Unit,
) {
    var value by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value,
                { value = it },
                label = { Text(label) },
                singleLine = true,
            )
        },
        confirmButton = {
            Button(onClick = { onSave(value.trim()) }, enabled = value.isNotBlank()) {
                Text("Salva")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

@Composable
private fun EmployeeDialog(
    departments: List<String>,
    initialDepartment: String,
    initialName: String,
    initialEmail: String,
    onDismiss: () -> Unit,
    onDelete: (() -> Unit)?,
    onSave: (String, String, String) -> Unit,
) {
    var department by remember { mutableStateOf(initialDepartment) }
    var name by remember { mutableStateOf(initialName) }
    var email by remember { mutableStateOf(initialEmail) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initialName.isBlank()) "Nuovo dipendente" else "Modifica dipendente") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ChoiceField("Reparto", department, departments) { department = it }
                OutlinedTextField(name, { name = it }, label = { Text("Nome") }, singleLine = true)
                OutlinedTextField(email, { email = it }, label = { Text("Email (opzionale)") }, singleLine = true)
                if (onDelete != null) {
                    TextButton(onClick = onDelete) {
                        Icon(Icons.Default.Delete, null)
                        Text("Elimina dipendente")
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(department, name.trim(), email.trim()) },
                enabled = department.isNotBlank() && name.isNotBlank(),
            ) { Text("Salva") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

@Composable
private fun RequestDetailsDialog(
    request: CalendarRequest,
    onDismiss: () -> Unit,
    onEdit: (CalendarRequest) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(request.employee) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                StatusChip(request.status)
                DetailRow("Tipologia", typeLabel(request.type))
                DetailRow("Reparto", request.department.ifBlank { "—" })
                DetailRow(
                    "Periodo",
                    if (request.allDay) {
                        "${formatDate(request.startDate)} → ${formatDate(request.endDate)} · giornata intera"
                    } else {
                        "${formatDate(request.startDate)} · " +
                            "${formatTime(request.startTime)}–${formatTime(request.endTime)}"
                    },
                )
                if (request.balanceHours != null) {
                    DetailRow("Ore conteggiate", "${formatDecimal(request.balanceHours)} h")
                }
                if (request.note.isNotBlank()) DetailRow("Note", request.note)
                if (request.approvedBy.isNotBlank()) DetailRow("Approvata da", request.approvedBy)
                if (request.approvedAt.isNotBlank()) DetailRow("Approvata il", formatTimestamp(request.approvedAt))
                if (request.rejectedBy.isNotBlank()) DetailRow("Rifiutata da", request.rejectedBy)
                if (request.modifiedBy.isNotBlank()) DetailRow("Modificata da", request.modifiedBy)
                if (request.createdAt.isNotBlank()) DetailRow("Creata il", formatTimestamp(request.createdAt))
            }
        },
        confirmButton = {
            Button(onClick = { onEdit(request) }) {
                Icon(Icons.Default.Edit, null)
                Text("Modifica")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Chiudi") } },
    )
}

@Composable
private fun DetailRow(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        Text(value)
    }
    HorizontalDivider()
}

@Composable
private fun AnalysisPage(snapshot: it.agpress.aypi.calendar.data.CalendarSnapshot) {
    var start by remember { mutableStateOf(YearMonth.now().atDay(1)) }
    var end by remember { mutableStateOf(YearMonth.now().atEndOfMonth()) }
    var department by remember { mutableStateOf("Tutti") }
    var type by remember { mutableStateOf("Tutti") }
    val approved = snapshot.requests.filter { request ->
        request.status == "approved" &&
            request.startDate?.let { !it.isAfter(end) } == true &&
            request.endDate?.let { !it.isBefore(start) } == true &&
            (department == "Tutti" || request.department == department) &&
            (type == "Tutti" || request.type == type)
    }
    val totalHours = approved.sumOf(::estimateHours)
    val people = approved.map { it.employee }.filter { it.isNotBlank() }.distinct().size
    val byType = approved.groupingBy { typeLabel(it.type) }.eachCount().toList().sortedByDescending { it.second }
    val byDepartment = approved.groupingBy { it.department.ifBlank { "Senza reparto" } }
        .eachCount().toList().sortedByDescending { it.second }

    LazyColumn(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp, 16.dp, 16.dp, 100.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Analisi Calendar", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Dati approvati nel periodo selezionato.")
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DateField("Dal", start, onSelect = { start = it })
            }
            Spacer(Modifier.height(8.dp))
            DateField("Al", end, minDate = start, onSelect = { end = it })
        }
        item {
            ChoiceField("Reparto", department, listOf("Tutti") + snapshot.departments) { department = it }
            Spacer(Modifier.height(8.dp))
            ChoiceField(
                "Tipologia",
                if (type == "Tutti") type else typeLabel(type),
                listOf("Tutti", "ferie", "permesso", "retribuito", "straordinari", "mutua", "infortunio", "speciale"),
                labels = false,
            ) { type = it }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MetricCard("Richieste", approved.size.toString(), Modifier.weight(1f))
                MetricCard("Persone", people.toString(), Modifier.weight(1f))
                MetricCard("Ore", formatDecimal(totalHours), Modifier.weight(1f))
            }
        }
        item { BreakdownCard("Per tipologia", byType) }
        item { BreakdownCard("Per reparto", byDepartment) }
        if (approved.isEmpty()) item { EmptyCard("Nessun dato per i filtri selezionati.") }
    }
}

@Composable
private fun MetricCard(label: String, value: String, modifier: Modifier) {
    Card(modifier) {
        Column(Modifier.fillMaxWidth().padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun BreakdownCard(title: String, rows: List<Pair<String, Int>>) {
    if (rows.isEmpty()) return
    val max = rows.maxOf { it.second }.coerceAtLeast(1)
    Card {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            rows.take(10).forEach { (label, value) ->
                Row {
                    Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    Text(value.toString(), fontWeight = FontWeight.Bold)
                }
                LinearProgressIndicator(
                    progress = { value.toFloat() / max.toFloat() },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun EmptyCard(text: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Text(text, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun typeLabel(type: String): String = when (type) {
    "permesso" -> "Permesso"
    "retribuito", "giustificato" -> "Permesso retribuito"
    "straordinari" -> "Straordinari"
    "mutua" -> "Mutua"
    "infortunio" -> "Infortunio"
    "speciale" -> "Permesso chiusura aziendale"
    else -> "Ferie"
}

private fun typeColor(type: String): Color = when (type) {
    "permesso" -> Color(0xFFF08C00)
    "retribuito", "giustificato" -> Color(0xFFC2185B)
    "straordinari" -> Color(0xFF1A73E8)
    "mutua" -> Color(0xFF00ACC1)
    "infortunio" -> Color(0xFFD84315)
    "speciale" -> Color(0xFF9E9D24)
    else -> Color(0xFF2F9E44)
}

private fun formatDate(date: LocalDate?): String =
    date?.format(DateTimeFormatter.ofPattern("dd/MM/yyyy")) ?: "—"

private fun formatTime(time: LocalTime?): String =
    time?.format(DateTimeFormatter.ofPattern("HH:mm")) ?: "—"

private fun formatDecimal(value: Double): String =
    if (value % 1.0 == 0.0) value.toInt().toString()
    else String.format(Locale.ITALIAN, "%.2f", value)

private fun formatTimestamp(value: String): String =
    runCatching {
        java.time.Instant.parse(value)
            .atZone(java.time.ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm"))
    }.getOrDefault(value)

private fun estimateHours(request: CalendarRequest): Double {
    request.balanceHours?.let { return kotlin.math.abs(it) }
    if (!request.allDay) {
        val start = request.startTime ?: return 0.0
        val end = request.endTime ?: return 0.0
        return java.time.Duration.between(start, end).toMinutes().coerceAtLeast(0) / 60.0
    }
    val first = request.startDate ?: return 0.0
    val last = request.endDate ?: first
    var day = first
    var workdays = 0
    while (!day.isAfter(last)) {
        if (day.dayOfWeek != DayOfWeek.SATURDAY && day.dayOfWeek != DayOfWeek.SUNDAY) {
            workdays++
        }
        day = day.plusDays(1)
    }
    return workdays * 8.0
}
