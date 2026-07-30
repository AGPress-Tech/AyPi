package it.agpress.aypi.calendar.ui

import android.app.DatePickerDialog
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import it.agpress.aypi.calendar.ModulesUiState
import it.agpress.aypi.calendar.ModulesViewModel
import it.agpress.aypi.calendar.PlannerJobDraft
import it.agpress.aypi.calendar.PurchaseDraft
import it.agpress.aypi.calendar.TicketDraft
import it.agpress.aypi.calendar.data.AdminSession
import it.agpress.aypi.calendar.data.PlannerJob
import it.agpress.aypi.calendar.data.PurchaseRequest
import it.agpress.aypi.calendar.data.SupportTicket
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModuleScaffold(
    title: String,
    loading: Boolean,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    floating: (@Composable () -> Unit)? = null,
    content: @Composable (PaddingValues) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Indietro") }
                },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !loading) {
                        Icon(Icons.Default.Refresh, "Aggiorna")
                    }
                },
            )
        },
        floatingActionButton = { floating?.invoke() },
    ) { padding ->
        Box(Modifier.fillMaxSize()) {
            content(padding)
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }
}

@Composable
fun PurchasingScreen(
    session: AdminSession,
    state: ModulesUiState,
    viewModel: ModulesViewModel,
    onBack: () -> Unit,
) {
    var section by remember { mutableStateOf("requests") }
    var search by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<PurchaseRequest?>(null) }
    val intervention = section == "interventions"
    LaunchedEffect(Unit) { viewModel.loadPurchasing(session) }
    ModuleScaffold(
        title = "Purchasing",
        loading = state.loading,
        onBack = onBack,
        onRefresh = { viewModel.loadPurchasing(session, true) },
        floating = if (section == "catalog") null else {
            { FloatingActionButton(onClick = { creating = true }) { Icon(Icons.Default.Add, "Nuova") } }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                AssistChip(onClick = { section = "requests" }, label = { Text("Acquisti") })
                AssistChip(onClick = { section = "interventions" }, label = { Text("Interventi") })
                AssistChip(onClick = { section = "catalog" }, label = { Text("Catalogo") })
            }
            OutlinedTextField(
                search,
                { search = it },
                label = { Text("Cerca") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                singleLine = true,
            )
            val query = search.trim().lowercase()
            if (section == "catalog") {
                val rows = state.purchasing.catalog.filter {
                    query.isBlank() || listOf(it.name, it.description, it.category, it.supplier)
                        .any { field -> field.lowercase().contains(query) }
                }
                LazyColumn(
                    contentPadding = PaddingValues(12.dp, 10.dp, 12.dp, 80.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(rows, key = { it.id }) { item ->
                        Card {
                            Column(Modifier.padding(14.dp)) {
                                Text(item.name, fontWeight = FontWeight.Bold)
                                Text("${item.category} · ${item.supplier}".trim(' ', '·'))
                                if (item.description.isNotBlank()) {
                                    Text(item.description, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            } else {
                val source = if (intervention) state.purchasing.interventions else state.purchasing.requests
                val rows = source.filter {
                    query.isBlank() || listOf(it.employee, it.department, it.notes)
                        .plus(it.lines.flatMap { line -> listOf(line.product, line.description, line.supplier) })
                        .any { field -> field.lowercase().contains(query) }
                }.sortedByDescending { it.createdAt }
                LazyColumn(
                    contentPadding = PaddingValues(12.dp, 10.dp, 12.dp, 90.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (rows.isEmpty()) item { MobileEmpty("Nessuna richiesta trovata.") }
                    items(rows, key = { it.id }) { request ->
                        PurchaseCard(request) { selected = request }
                    }
                }
            }
        }
    }
    if (creating) {
        PurchaseEditorDialog(
            intervention = intervention,
            departments = state.purchasing.departments,
            employees = state.purchasing.employees,
            categories = state.purchasing.categories,
            interventionTypes = state.purchasing.interventionTypes,
            onDismiss = { creating = false },
        ) {
            viewModel.createPurchase(session, intervention, it)
            creating = false
        }
    }
    selected?.let { request ->
        PurchaseDetailsDialog(
            request,
            intervention,
            onDismiss = { selected = null },
            onConfirmLine = { index ->
                viewModel.confirmPurchaseLine(session, intervention, request.id, index)
                selected = null
            },
            onDelete = {
                viewModel.deletePurchase(session, intervention, request.id)
                selected = null
            },
        )
    }
    ModuleError(state, viewModel)
}

@Composable
private fun PurchaseCard(request: PurchaseRequest, onClick: () -> Unit) {
    val confirmed = request.lines.count { it.confirmed }
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row {
                Text(
                    request.employee.ifBlank { request.department.ifBlank { "Richiesta" } },
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                Text("$confirmed/${request.lines.size}", color = MaterialTheme.colorScheme.primary)
            }
            Text(request.lines.joinToString { it.product.ifBlank { it.description } }.ifBlank { "Nessuna riga" })
            Text(formatRemoteDate(request.createdAt), style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun PurchaseDetailsDialog(
    request: PurchaseRequest,
    intervention: Boolean,
    onDismiss: () -> Unit,
    onConfirmLine: (Int) -> Unit,
    onDelete: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (intervention) "Intervento" else "Richiesta acquisto") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("${request.employee} · ${request.department}")
                if (request.notes.isNotBlank()) Text(request.notes)
                request.lines.forEachIndexed { index, line ->
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (line.confirmed) Color(0xFFE1F5E9)
                            else MaterialTheme.colorScheme.surfaceVariant,
                        ),
                    ) {
                        Column(Modifier.padding(12.dp)) {
                            Text(
                                if (intervention) line.interventionType else line.product,
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                if (intervention) line.description
                                else "${formatNumber(line.quantity)} ${line.unit} · ${line.supplier}",
                            )
                            if (line.note.isNotBlank()) Text(line.note, style = MaterialTheme.typography.bodySmall)
                            if (!line.confirmed) {
                                TextButton(onClick = { onConfirmLine(index) }) {
                                    Icon(Icons.Default.Check, null)
                                    Text("Convalida")
                                }
                            } else {
                                Text("Convalidata", color = Color(0xFF16865A), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                TextButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, null)
                    Text("Elimina richiesta")
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Chiudi") } },
    )
}

@Composable
private fun PurchaseEditorDialog(
    intervention: Boolean,
    departments: List<String>,
    employees: List<String>,
    categories: List<String>,
    interventionTypes: List<String>,
    onDismiss: () -> Unit,
    onSave: (PurchaseDraft) -> Unit,
) {
    var department by remember { mutableStateOf(departments.firstOrNull().orEmpty()) }
    var employee by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var product by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(categories.firstOrNull().orEmpty()) }
    var quantity by remember { mutableStateOf("1") }
    var unit by remember { mutableStateOf("pz") }
    var urgency by remember { mutableStateOf("Normale") }
    var supplier by remember { mutableStateOf("") }
    var lineNote by remember { mutableStateOf("") }
    var interventionType by remember { mutableStateOf(interventionTypes.firstOrNull().orEmpty()) }
    var description by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (intervention) "Nuovo intervento" else "Nuovo acquisto") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                MobileChoice("Richiedente", employee, employees) { employee = it }
                MobileChoice("Reparto", department, departments) { department = it }
                if (intervention) {
                    MobileChoice("Tipologia", interventionType, interventionTypes) { interventionType = it }
                    OutlinedTextField(description, { description = it }, label = { Text("Descrizione") }, minLines = 2)
                } else {
                    OutlinedTextField(product, { product = it }, label = { Text("Prodotto") })
                    MobileChoice("Categoria", category, categories) { category = it }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(quantity, { quantity = it }, label = { Text("Quantità") }, modifier = Modifier.weight(1f))
                        OutlinedTextField(unit, { unit = it }, label = { Text("Unità") }, modifier = Modifier.weight(1f))
                    }
                    OutlinedTextField(supplier, { supplier = it }, label = { Text("Fornitore") })
                }
                MobileChoice("Urgenza", urgency, listOf("Bassa", "Normale", "Alta", "Urgente")) { urgency = it }
                OutlinedTextField(lineNote, { lineNote = it }, label = { Text("Nota riga") })
                OutlinedTextField(notes, { notes = it }, label = { Text("Note generali") })
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(
                        PurchaseDraft(
                            department, employee, notes, product, category,
                            quantity.replace(',', '.').toDoubleOrNull() ?: 1.0,
                            unit, urgency, supplier, lineNote, interventionType, description,
                        ),
                    )
                },
                enabled = employee.isNotBlank() &&
                    (if (intervention) interventionType.isNotBlank() && description.isNotBlank()
                    else product.isNotBlank()),
            ) { Text("Crea") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

@Composable
fun TicketSupportScreen(
    session: AdminSession,
    state: ModulesUiState,
    viewModel: ModulesViewModel,
    onBack: () -> Unit,
) {
    var search by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Tutti") }
    var creating by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<SupportTicket?>(null) }
    LaunchedEffect(Unit) { viewModel.loadTickets(session) }
    ModuleScaffold(
        "Ticket Support",
        state.loading,
        onBack,
        { viewModel.loadTickets(session, true) },
        floating = {
            FloatingActionButton(onClick = { creating = true }) {
                Icon(Icons.Default.Add, "Nuovo ticket")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding)) {
            OutlinedTextField(
                search,
                { search = it },
                label = { Text("Cerca ticket") },
                modifier = Modifier.fillMaxWidth().padding(12.dp, 6.dp),
            )
            MobileChoice(
                "Stato",
                status,
                listOf("Tutti", "Da prendere in carico", "Presa in carico", "In Attesa", "Risolto", "Chiuso"),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            ) { status = it }
            val query = search.trim().lowercase()
            val rows = state.tickets.tickets.filter {
                (status == "Tutti" || it.status == status) &&
                    (query.isBlank() || listOf(
                        it.id, it.requesterName, it.requesterSurname, it.department,
                        it.issueType, it.area, it.description,
                    ).any { field -> field.lowercase().contains(query) })
            }.sortedByDescending { it.updatedAt }
            LazyColumn(
                contentPadding = PaddingValues(12.dp, 10.dp, 12.dp, 90.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (rows.isEmpty()) item { MobileEmpty("Nessun ticket trovato.") }
                items(rows, key = { it.id }) {
                    TicketCard(it) { selected = it }
                }
            }
        }
    }
    if (creating) {
        TicketEditorDialog(
            state.tickets.issueTypes,
            state.tickets.areas,
            onDismiss = { creating = false },
        ) {
            viewModel.createTicket(session, it)
            creating = false
        }
    }
    selected?.let { ticket ->
        TicketDetailsDialog(
            ticket,
            onDismiss = { selected = null },
            onChangeStatus = { next, note ->
                viewModel.updateTicketStatus(session, ticket.id, next, note)
                selected = null
            },
            onDelete = {
                viewModel.deleteTicket(session, ticket.id)
                selected = null
            },
        )
    }
    ModuleError(state, viewModel)
}

@Composable
private fun TicketCard(ticket: SupportTicket, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row {
                Text(ticket.id, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                MobileBadge(ticket.status)
            }
            Text("${ticket.issueType} · ${ticket.area}")
            Text(ticket.description, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                "${ticket.requesterName} ${ticket.requesterSurname} · ${formatRemoteDate(ticket.updatedAt)}",
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun TicketDetailsDialog(
    ticket: SupportTicket,
    onDismiss: () -> Unit,
    onChangeStatus: (String, String) -> Unit,
    onDelete: () -> Unit,
) {
    var nextStatus by remember { mutableStateOf(ticket.status) }
    var note by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(ticket.id) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                MobileBadge(ticket.status)
                Text("${ticket.requesterName} ${ticket.requesterSurname} · ${ticket.department}")
                Text("${ticket.issueType} · ${ticket.area} · priorità ${ticket.priority}")
                Text(ticket.description)
                HorizontalDivider()
                Text("Cronologia", fontWeight = FontWeight.Bold)
                ticket.history.asReversed().take(12).forEach {
                    Text(
                        "${formatRemoteDate(it.at)} · ${it.event} ${it.fromStatus} → ${it.toStatus}\n${it.note}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                HorizontalDivider()
                MobileChoice(
                    "Nuovo stato",
                    nextStatus,
                    listOf("Da prendere in carico", "Presa in carico", "In Attesa", "Risolto", "Chiuso"),
                ) { nextStatus = it }
                OutlinedTextField(note, { note = it }, label = { Text("Nota aggiornamento") })
                Button(
                    onClick = { onChangeStatus(nextStatus, note.trim()) },
                    enabled = nextStatus != ticket.status,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Aggiorna stato") }
                TextButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, null)
                    Text("Elimina ticket")
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Chiudi") } },
    )
}

@Composable
private fun TicketEditorDialog(
    issueTypes: List<String>,
    areas: List<String>,
    onDismiss: () -> Unit,
    onSave: (TicketDraft) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    var surname by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var department by remember { mutableStateOf("") }
    var issueType by remember { mutableStateOf(issueTypes.firstOrNull().orEmpty()) }
    var area by remember { mutableStateOf(areas.firstOrNull().orEmpty()) }
    var priority by remember { mutableStateOf("Normale") }
    var description by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Nuovo ticket") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(name, { name = it }, label = { Text("Nome") }, modifier = Modifier.weight(1f))
                    OutlinedTextField(surname, { surname = it }, label = { Text("Cognome") }, modifier = Modifier.weight(1f))
                }
                OutlinedTextField(email, { email = it }, label = { Text("Email") })
                OutlinedTextField(department, { department = it }, label = { Text("Reparto") })
                MobileChoice("Problema", issueType, issueTypes) { issueType = it }
                MobileChoice("Ambito", area, areas) { area = it }
                MobileChoice("Priorità", priority, listOf("Bassa", "Normale", "Alta", "Urgente")) { priority = it }
                OutlinedTextField(description, { description = it }, label = { Text("Descrizione") }, minLines = 3)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(TicketDraft(name, surname, email, department, issueType, area, priority, description))
                },
                enabled = name.isNotBlank() && issueType.isNotBlank() && description.isNotBlank(),
            ) { Text("Crea ticket") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

@Composable
fun PlannerScreen(
    session: AdminSession,
    state: ModulesUiState,
    viewModel: ModulesViewModel,
    onBack: () -> Unit,
) {
    var search by remember { mutableStateOf("") }
    var machine by remember { mutableStateOf("Tutte") }
    var section by remember { mutableStateOf("jobs") }
    var selected by remember { mutableStateOf<PlannerJob?>(null) }
    var editing by remember { mutableStateOf<PlannerJob?>(null) }
    var creating by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.loadPlanner(session) }
    ModuleScaffold(
        "Pianificazione",
        state.loading,
        onBack,
        { viewModel.loadPlanner(session, true) },
        floating = if (section == "jobs") {
            {
                FloatingActionButton(onClick = { creating = true }) {
                    Icon(Icons.Default.Add, "Nuova lavorazione")
                }
            }
        } else null,
    ) { padding ->
        Column(Modifier.padding(padding)) {
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AssistChip(onClick = { section = "jobs" }, label = { Text("Lavorazioni") })
                AssistChip(onClick = { section = "stops" }, label = { Text("Fermi/chiusure") })
            }
            if (section == "jobs") {
                OutlinedTextField(
                    search,
                    { search = it },
                    label = { Text("Articolo, cliente o fase") },
                    modifier = Modifier.fillMaxWidth().padding(12.dp, 6.dp),
                )
                MobileChoice(
                    "Macchina",
                    machine,
                    listOf("Tutte", "Da pianificare") + state.planner.machines.map { it.name },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                ) { machine = it }
                val machineId = state.planner.machines.firstOrNull { it.name == machine }?.id
                val query = search.trim().lowercase()
                val rows = state.planner.jobs.filter {
                    (machine == "Tutte" ||
                        (machine == "Da pianificare" && it.machineId.isBlank()) ||
                        it.machineId == machineId) &&
                        (query.isBlank() || listOf(it.article, it.customer, it.phase, it.materialAlloy)
                            .any { field -> field.lowercase().contains(query) })
                }.sortedWith(compareBy({ it.start.ifBlank { "9999" } }, { it.article }))
                LazyColumn(
                    contentPadding = PaddingValues(12.dp, 10.dp, 12.dp, 90.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        Text(
                            "Revisione ${state.planner.revision} · ${state.planner.updatedBy}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    if (rows.isEmpty()) item { MobileEmpty("Nessuna lavorazione trovata.") }
                    items(rows, key = { it.id }) { job ->
                        PlannerJobCard(
                            job,
                            state.planner.machines.firstOrNull { it.id == job.machineId }?.name
                                ?: "Da pianificare",
                        ) { selected = job }
                    }
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(12.dp, 10.dp, 12.dp, 80.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (state.planner.unavailabilities.isEmpty()) {
                        item { MobileEmpty("Nessun fermo o chiusura.") }
                    }
                    items(state.planner.unavailabilities, key = { it.id }) { stop ->
                        Card {
                            Column(Modifier.padding(14.dp)) {
                                Text(stop.title.ifBlank { stop.type }, fontWeight = FontWeight.Bold)
                                Text("${stop.start} → ${stop.end}")
                                Text(
                                    state.planner.machines.firstOrNull { it.id == stop.machineId }?.name
                                        ?: "Più macchine/reparti",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
    if (creating || editing != null) {
        PlannerJobEditor(
            job = editing,
            machines = state.planner.machines,
            onDismiss = {
                creating = false
                editing = null
            },
        ) {
            viewModel.savePlannerJob(session, it)
            creating = false
            editing = null
        }
    }
    selected?.let { job ->
        PlannerJobDetails(
            job,
            state.planner.machines.firstOrNull { it.id == job.machineId }?.name ?: "Da pianificare",
            onDismiss = { selected = null },
            onEdit = {
                selected = null
                editing = job
            },
            onState = { material, work, progress ->
                viewModel.updatePlannerJobState(session, job, material, work, progress)
                selected = null
            },
            onDelete = {
                viewModel.deletePlannerJob(session, job.id)
                selected = null
            },
        )
    }
    ModuleError(state, viewModel)
}

@Composable
private fun PlannerJobCard(job: PlannerJob, machine: String, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row {
                Text(job.article.ifBlank { "Senza articolo" }, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                MobileBadge(workLabel(job.workStatus))
            }
            Text("${job.customer} · ${job.phase}".trim(' ', '·'))
            Text("$machine · ${job.start.ifBlank { "Da pianificare" }} · ${job.durationDays} gg")
            LinearProgressIndicator(
                progress = { job.progressDays.toFloat() / job.durationDays.coerceAtLeast(1).toFloat() },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun PlannerJobDetails(
    job: PlannerJob,
    machine: String,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onState: (String, String, Int) -> Unit,
    onDelete: () -> Unit,
) {
    var material by remember { mutableStateOf(job.materialStatus) }
    var work by remember { mutableStateOf(job.workStatus) }
    var progress by remember { mutableFloatStateOf(job.progressDays.toFloat()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(job.article.ifBlank { "Lavorazione" }) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                Text("${job.customer} · ${job.phase}")
                Text("$machine · ${job.start.ifBlank { "Da pianificare" }} → ${job.end}")
                Text("${formatNumber(job.quantity)} ${job.unit} · ${job.materialAlloy}")
                if (job.notes.isNotBlank()) Text(job.notes)
                MobileChoice(
                    "Materiale",
                    materialLabel(material),
                    listOf("available", "partial", "incoming", "unavailable", "verification"),
                    display = ::materialLabel,
                ) { material = it }
                MobileChoice(
                    "Lavorazione",
                    workLabel(work),
                    listOf("not_started", "running", "done"),
                    display = ::workLabel,
                ) { work = it }
                if (work == "running") {
                    Text("${progress.toInt()}/${job.durationDays} giorni completati")
                    Slider(
                        value = progress,
                        onValueChange = { progress = it },
                        valueRange = 0f..job.durationDays.toFloat(),
                        steps = (job.durationDays - 1).coerceAtLeast(0),
                    )
                }
                Button(
                    onClick = { onState(material, work, progress.toInt()) },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Aggiorna stati") }
                OutlinedButton(onClick = onEdit, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Edit, null)
                    Text("Modifica lavorazione")
                }
                TextButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, null)
                    Text("Elimina")
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Chiudi") } },
    )
}

@Composable
private fun PlannerJobEditor(
    job: PlannerJob?,
    machines: List<it.agpress.aypi.calendar.data.PlannerMachine>,
    onDismiss: () -> Unit,
    onSave: (PlannerJobDraft) -> Unit,
) {
    var customer by remember { mutableStateOf(job?.customer.orEmpty()) }
    var article by remember { mutableStateOf(job?.article.orEmpty()) }
    var phase by remember { mutableStateOf(job?.phase.orEmpty()) }
    var alloy by remember { mutableStateOf(job?.materialAlloy.orEmpty()) }
    var quantity by remember { mutableStateOf(job?.quantity?.let(::formatNumber) ?: "") }
    var unit by remember { mutableStateOf(job?.unit ?: "pz") }
    var machineId by remember { mutableStateOf(job?.machineId.orEmpty()) }
    var start by remember { mutableStateOf(job?.start?.takeIf(String::isNotBlank)?.let(LocalDate::parse)) }
    var duration by remember { mutableStateOf(job?.durationDays?.toString() ?: "1") }
    var dueDate by remember { mutableStateOf(job?.dueDate?.takeIf(String::isNotBlank)?.let(LocalDate::parse)) }
    var firstDelivery by remember {
        mutableStateOf(job?.firstDeliveryDate?.takeIf(String::isNotBlank)?.let(LocalDate::parse))
    }
    var material by remember { mutableStateOf(job?.materialStatus ?: "available") }
    var work by remember { mutableStateOf(job?.workStatus ?: "not_started") }
    var notes by remember { mutableStateOf(job?.notes.orEmpty()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (job == null) "Nuova lavorazione" else "Modifica lavorazione") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(article, { article = it }, label = { Text("Articolo") })
                OutlinedTextField(customer, { customer = it }, label = { Text("Cliente") })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(phase, { phase = it }, label = { Text("Fase") }, modifier = Modifier.weight(1f))
                    OutlinedTextField(alloy, { alloy = it }, label = { Text("Materiale/Lega") }, modifier = Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(quantity, { quantity = it }, label = { Text("Quantità") }, modifier = Modifier.weight(1f))
                    OutlinedTextField(unit, { unit = it }, label = { Text("Unità") }, modifier = Modifier.weight(1f))
                }
                MobileChoice(
                    "Macchina",
                    machines.firstOrNull { it.id == machineId }?.name ?: "Da pianificare",
                    listOf("") + machines.map { it.id },
                    display = { id -> machines.firstOrNull { it.id == id }?.name ?: "Da pianificare" },
                ) { machineId = it }
                MobileNullableDate("Inizio previsto", start) { start = it }
                OutlinedTextField(duration, { duration = it }, label = { Text("Durata (giorni lavorativi)") })
                MobileNullableDate("Prima consegna", firstDelivery) { firstDelivery = it }
                MobileNullableDate("Consegna finale (opzionale)", dueDate) { dueDate = it }
                MobileChoice(
                    "Materiale",
                    materialLabel(material),
                    listOf("available", "partial", "incoming", "unavailable", "verification"),
                    display = ::materialLabel,
                ) { material = it }
                MobileChoice(
                    "Lavorazione",
                    workLabel(work),
                    listOf("not_started", "running", "done"),
                    display = ::workLabel,
                ) { work = it }
                OutlinedTextField(notes, { notes = it }, label = { Text("Note") }, minLines = 2)
            }
        },
        confirmButton = {
            val days = duration.toIntOrNull()?.coerceAtLeast(1) ?: 1
            Button(
                onClick = {
                    onSave(
                        PlannerJobDraft(
                            job?.id, customer, article, phase, alloy,
                            quantity.replace(',', '.').toDoubleOrNull() ?: 0.0,
                            unit, machineId, start, days, dueDate, firstDelivery,
                            material, work, job?.progressDays ?: 0, notes,
                        ),
                    )
                },
                enabled = article.isNotBlank(),
            ) { Text("Salva") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}

@Composable
private fun MobileNullableDate(
    label: String,
    value: LocalDate?,
    onSelect: (LocalDate?) -> Unit,
) {
    val context = LocalContext.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(
            onClick = {
                val base = value ?: LocalDate.now()
                DatePickerDialog(
                    context,
                    { _, year, month, day -> onSelect(LocalDate.of(year, month + 1, day)) },
                    base.year,
                    base.monthValue - 1,
                    base.dayOfMonth,
                ).show()
            },
            modifier = Modifier.weight(1f),
        ) { Text("$label: ${value?.format(DateTimeFormatter.ofPattern("dd/MM/yyyy")) ?: "—"}") }
        if (value != null) {
            IconButton(onClick = { onSelect(null) }) { Icon(Icons.Default.Delete, "Rimuovi data") }
        }
    }
}

@Composable
private fun MobileChoice(
    label: String,
    value: String,
    choices: List<String>,
    modifier: Modifier = Modifier,
    display: (String) -> String = { it },
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text("$label: ${value.ifBlank { "—" }}", modifier = Modifier.weight(1f))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            choices.distinct().forEach {
                DropdownMenuItem(
                    text = { Text(display(it)) },
                    onClick = {
                        onSelect(it)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun MobileBadge(text: String) {
    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = CircleShape) {
        Text(text, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun MobileEmpty(text: String) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Text(text, Modifier.fillMaxWidth().padding(18.dp))
    }
}

@Composable
private fun ModuleError(state: ModulesUiState, viewModel: ModulesViewModel) {
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

private fun formatRemoteDate(value: String): String =
    runCatching {
        java.time.Instant.parse(value)
            .atZone(java.time.ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm"))
    }.getOrDefault(value.take(10))

private fun formatNumber(value: Double): String =
    if (value % 1.0 == 0.0) value.toInt().toString() else "%.2f".format(value)

private fun materialLabel(value: String): String = when (value) {
    "available" -> "Disponibile"
    "partial" -> "Parzialmente disponibile"
    "incoming" -> "In arrivo"
    "unavailable" -> "Non disponibile"
    "verification" -> "Da verificare"
    else -> value
}

private fun workLabel(value: String): String = when (value) {
    "not_started" -> "Non iniziato"
    "running" -> "In corso"
    "done" -> "Terminato"
    else -> value
}
