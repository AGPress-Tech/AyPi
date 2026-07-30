package it.agpress.aypi.calendar.ui

import android.app.DatePickerDialog
import android.content.pm.ActivityInfo
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.clickable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import it.agpress.aypi.calendar.ModulesUiState
import it.agpress.aypi.calendar.ModulesViewModel
import it.agpress.aypi.calendar.PlannerJobDraft
import it.agpress.aypi.calendar.PurchaseDraft
import it.agpress.aypi.calendar.TicketDraft
import it.agpress.aypi.calendar.data.AdminSession
import it.agpress.aypi.calendar.data.CatalogItem
import it.agpress.aypi.calendar.data.PlannerJob
import it.agpress.aypi.calendar.data.PlannerMachine
import it.agpress.aypi.calendar.data.PlannerSnapshot
import it.agpress.aypi.calendar.data.PurchaseLine
import it.agpress.aypi.calendar.data.PurchaseRequest
import it.agpress.aypi.calendar.data.SupportTicket
import java.time.LocalDate
import java.time.DayOfWeek
import java.time.temporal.ChronoUnit
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.flow.distinctUntilChanged
import androidx.compose.runtime.snapshotFlow

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
    var categoryFilter by remember { mutableStateOf("Tutte") }
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
            val activeRequests = if (intervention) state.purchasing.interventions
            else state.purchasing.requests
            val totalLines = activeRequests.sumOf { it.lines.size }
            val confirmedLines = activeRequests.sumOf { request -> request.lines.count { it.confirmed } }
            Row(
                Modifier.fillMaxWidth().padding(12.dp, 8.dp, 12.dp, 2.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                PurchasingMetric("Richieste", activeRequests.size, Modifier.weight(1f))
                PurchasingMetric("Da gestire", totalLines - confirmedLines, Modifier.weight(1f))
                PurchasingMetric("Convalidate", confirmedLines, Modifier.weight(1f))
            }
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
            if (section != "interventions") {
                MobileChoice(
                    "Categoria",
                    categoryFilter,
                    listOf("Tutte") + state.purchasing.categories,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                ) { categoryFilter = it }
            }
            val query = search.trim().lowercase()
            if (section == "catalog") {
                val rows = state.purchasing.catalog.filter {
                    (categoryFilter == "Tutte" || it.category == categoryFilter) &&
                        (query.isBlank() || listOf(it.name, it.description, it.category, it.supplier)
                            .any { field -> field.lowercase().contains(query) })
                }
                LazyColumn(
                    contentPadding = PaddingValues(12.dp, 10.dp, 12.dp, 80.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(rows, key = { it.id }) { item ->
                        CatalogDesktopCard(item)
                    }
                }
            } else {
                val source = if (intervention) state.purchasing.interventions else state.purchasing.requests
                val rows = source
                    .flatMap { request -> request.lines.mapIndexed { index, line -> Triple(request, index, line) } }
                    .filter { (request, _, line) ->
                        (intervention || categoryFilter == "Tutte" || line.category == categoryFilter) &&
                            (query.isBlank() || listOf(
                                request.employee,
                                request.department,
                                request.notes,
                                line.product,
                                line.description,
                                line.supplier,
                            ).any { field -> field.lowercase().contains(query) })
                    }
                    .sortedByDescending { it.first.createdAt }
                LazyColumn(
                    contentPadding = PaddingValues(12.dp, 10.dp, 12.dp, 90.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (rows.isEmpty()) item { MobileEmpty("Nessuna richiesta trovata.") }
                    item { PurchasingTableHeader(intervention) }
                    items(
                        rows,
                        key = { "${it.first.id}-${it.second}" },
                    ) { (request, _, line) ->
                        PurchasingLineRow(request, line, intervention) {
                            selected = request
                        }
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
private fun PurchasingMetric(label: String, value: Int, modifier: Modifier) {
    Card(
        modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(9.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(value.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
            Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
        }
    }
}

@Composable
private fun PurchasingTableHeader(intervention: Boolean) {
    Surface(
        color = MaterialTheme.colorScheme.primary,
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(10.dp, 8.dp)) {
            Text(
                if (intervention) "INTERVENTO / RICHIEDENTE" else "ARTICOLO / RICHIEDENTE",
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (intervention) "URGENZA" else "Q.TÀ / STATO",
                color = MaterialTheme.colorScheme.onPrimary,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun PurchasingLineRow(
    request: PurchaseRequest,
    line: PurchaseLine,
    intervention: Boolean,
    onClick: () -> Unit,
) {
    val urgencyColor = when (line.urgency.lowercase()) {
        "urgente" -> Color(0xFFD32F2F)
        "alta" -> Color(0xFFF57C00)
        "bassa" -> Color(0xFF607D8B)
        else -> Color(0xFF1976D2)
    }
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (line.confirmed) Color(0xFFE4F5EA)
            else MaterialTheme.colorScheme.surface,
        ),
    ) {
        Row(Modifier.fillMaxWidth()) {
            Surface(color = urgencyColor, modifier = Modifier.size(5.dp).height(78.dp)) {}
            Column(
                Modifier.weight(1f).padding(11.dp, 9.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    if (intervention) line.interventionType else line.product,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${request.employee} · ${request.department}".trim(' ', '·'),
                    style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    if (intervention) line.description
                    else listOf(line.category, line.supplier).filter(String::isNotBlank).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Column(
                Modifier.padding(10.dp),
                horizontalAlignment = Alignment.End,
            ) {
                Text(
                    if (intervention) line.urgency
                    else "${formatNumber(line.quantity)} ${line.unit}",
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    if (line.confirmed) "CONVALIDATA" else "DA GESTIRE",
                    color = if (line.confirmed) Color(0xFF16865A) else urgencyColor,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun CatalogDesktopCard(item: CatalogItem) {
    Card {
        Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.size(48.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        item.name.take(2).uppercase(),
                        fontWeight = FontWeight.Black,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Spacer(Modifier.size(11.dp))
            Column(Modifier.weight(1f)) {
                Text(item.name, fontWeight = FontWeight.Bold)
                Text(
                    listOf(item.category, item.supplier).filter(String::isNotBlank).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                )
                if (item.description.isNotBlank()) {
                    Text(
                        item.description,
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Text(item.unit, style = MaterialTheme.typography.labelSmall)
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
    val activity = LocalActivity.current
    DisposableEffect(activity) {
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }
    var search by remember { mutableStateOf("") }
    var machine by remember { mutableStateOf("Tutte") }
    var section by remember { mutableStateOf("gantt") }
    var backlogOpen by remember { mutableStateOf(false) }
    var machineFiltersOpen by remember { mutableStateOf(false) }
    var articleFiltersOpen by remember { mutableStateOf(false) }
    var departments by remember { mutableStateOf(emptySet<String>()) }
    var categories by remember { mutableStateOf(emptySet<String>()) }
    var machineIds by remember { mutableStateOf(emptySet<String>()) }
    var articlePattern by remember { mutableStateOf("") }
    var articleDetails by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<PlannerJob?>(null) }
    var editing by remember { mutableStateOf<PlannerJob?>(null) }
    var creating by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { viewModel.loadPlanner(session) }
    val filteredMachines = state.planner.machines.filter { item ->
        (departments.isEmpty() || item.department in departments) &&
            (categories.isEmpty() || item.category in categories) &&
            (machineIds.isEmpty() || item.id in machineIds)
    }
    val articleFilterActive = articlePattern.isNotBlank() || articleDetails.isNotBlank()
    val filteredJobs = state.planner.jobs.filter { job ->
        matchesArticlePattern(job.article, articlePattern) &&
            matchesPlannerDetails(job, articleDetails)
    }
    val visibleMachines = if (articleFilterActive) {
        filteredMachines.filter { item -> filteredJobs.any { it.machineId == item.id } }
    } else {
        filteredMachines
    }
    val filteredSnapshot = state.planner.copy(
        machines = visibleMachines,
        jobs = filteredJobs.filter { it.machineId.isBlank() || visibleMachines.any { machine -> machine.id == it.machineId } },
    )
    Scaffold(
        floatingActionButton = {
            FloatingActionButton(onClick = { creating = true }) {
                Icon(Icons.Default.Add, "Nuova lavorazione")
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Surface(tonalElevation = 2.dp) {
                Row(
                    Modifier.fillMaxWidth().height(46.dp).padding(horizontal = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Indietro")
                    }
                    OutlinedButton(onClick = { articleFiltersOpen = true }) {
                        Text(if (articleFilterActive) "Filtri articoli •" else "Filtri articoli")
                    }
                    OutlinedButton(onClick = { backlogOpen = true }) {
                        Text("Da pianificare (${filteredJobs.count { it.machineId.isBlank() }})")
                    }
                    AssistChip(onClick = { section = "gantt" }, label = { Text("Gantt") })
                    AssistChip(onClick = { section = "jobs" }, label = { Text("Lista") })
                    Spacer(Modifier.weight(1f))
                    IconButton(
                        onClick = { viewModel.loadPlanner(session, true) },
                        enabled = !state.loading,
                    ) {
                        Icon(Icons.Default.Refresh, "Aggiorna")
                    }
                }
            }
            if (section == "gantt") {
                PlannerGantt(
                    snapshot = filteredSnapshot,
                    onJob = { selected = it },
                    onMachineFilter = { machineFiltersOpen = true },
                    machineFilterActive =
                        departments.isNotEmpty() || categories.isNotEmpty() || machineIds.isNotEmpty(),
                    modifier = Modifier.weight(1f),
                )
            } else {
                val machineId = state.planner.machines.firstOrNull { it.name == machine }?.id
                val query = search.trim().lowercase()
                val rows = filteredJobs.filter {
                    (machine == "Tutte" ||
                        (machine == "Da pianificare" && it.machineId.isBlank()) ||
                        it.machineId == machineId) &&
                        (query.isBlank() || listOf(it.article, it.customer, it.phase, it.materialAlloy)
                            .any { field -> field.lowercase().contains(query) })
                }.sortedWith(compareBy({ it.start.ifBlank { "9999" } }, { it.article }))
                Row(
                    Modifier.fillMaxSize().padding(10.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Card(Modifier.weight(.3f).fillMaxHeight()) {
                        Column(
                            Modifier.fillMaxSize().padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(9.dp),
                        ) {
                            Text("FILTRI", fontWeight = FontWeight.Bold)
                            OutlinedTextField(
                                search,
                                { search = it },
                                label = { Text("Articolo, cliente o fase") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                            )
                            MobileChoice(
                                "Macchina",
                                machine,
                                listOf("Tutte", "Da pianificare") +
                                    state.planner.machines.map { it.name },
                                modifier = Modifier.fillMaxWidth(),
                            ) { machine = it }
                            Text(
                                "${rows.size} lavorazioni",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                    LazyColumn(
                        modifier = Modifier.weight(.7f).fillMaxHeight(),
                        contentPadding = PaddingValues(0.dp, 0.dp, 0.dp, 80.dp),
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
                }
            }
            if (state.loading) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
    }
    if (backlogOpen) {
        AlertDialog(
            onDismissRequest = { backlogOpen = false },
            title = { Text("Articoli da pianificare") },
            text = {
                val backlog = filteredJobs.filter { it.machineId.isBlank() }
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (backlog.isEmpty()) item { MobileEmpty("Nessun articolo da pianificare.") }
                    items(backlog, key = { it.id }) { job ->
                        Card(
                            Modifier.fillMaxWidth().clickable {
                                backlogOpen = false
                                selected = job
                            },
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(11.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        job.article.ifBlank { "Senza articolo" },
                                        fontWeight = FontWeight.Bold,
                                    )
                                    Text(
                                        listOf(job.customer, job.phase)
                                            .filter(String::isNotBlank).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                    Text(
                                        "${job.durationDays} gg · ${formatNumber(job.quantity)} ${job.unit}",
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                                Icon(Icons.Default.Edit, "Apri e modifica")
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { backlogOpen = false }) { Text("Chiudi") }
            },
        )
    }
    if (machineFiltersOpen) {
        PlannerMachineFilterDialog(
            machines = state.planner.machines,
            departments = departments,
            categories = categories,
            machineIds = machineIds,
            onDismiss = { machineFiltersOpen = false },
            onApply = { newDepartments, newCategories, newMachines ->
                departments = newDepartments
                categories = newCategories
                machineIds = newMachines
                machineFiltersOpen = false
            },
        )
    }
    if (articleFiltersOpen) {
        PlannerArticleFilterDialog(
            articlePattern = articlePattern,
            details = articleDetails,
            onDismiss = { articleFiltersOpen = false },
            onApply = { newPattern, newDetails ->
                articlePattern = newPattern
                articleDetails = newDetails
                articleFiltersOpen = false
            },
        )
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
private fun PlannerMachineFilterDialog(
    machines: List<PlannerMachine>,
    departments: Set<String>,
    categories: Set<String>,
    machineIds: Set<String>,
    onDismiss: () -> Unit,
    onApply: (Set<String>, Set<String>, Set<String>) -> Unit,
) {
    var draftDepartments by remember { mutableStateOf(departments) }
    var draftCategories by remember { mutableStateOf(categories) }
    var draftMachines by remember { mutableStateOf(machineIds) }
    val departmentOptions = machines.map { it.department }.filter(String::isNotBlank).distinct().sorted()
    val categoryOptions = machines
        .filter { draftDepartments.isEmpty() || it.department in draftDepartments }
        .map { it.category }.filter(String::isNotBlank).distinct().sorted()
    val effectiveCategories = draftCategories.intersect(categoryOptions.toSet())
    val machineOptions = machines
        .filter { draftDepartments.isEmpty() || it.department in draftDepartments }
        .filter { effectiveCategories.isEmpty() || it.category in effectiveCategories }
        .sortedBy { it.name }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(.96f).fillMaxHeight(.9f),
            shape = RoundedCornerShape(18.dp),
            tonalElevation = 6.dp,
        ) {
            Column(
                Modifier.fillMaxSize().padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            "Filtra macchine",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "Nessuna selezione equivale a mostrare tutto",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    TextButton(onClick = { onApply(emptySet(), emptySet(), emptySet()) }) {
                        Text("Azzera filtri")
                    }
                }
            Row(
                    Modifier.fillMaxWidth().weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                PlannerFilterColumn(
                    title = "REPARTI",
                    options = departmentOptions.map { it to it },
                    selected = draftDepartments,
                    modifier = Modifier.weight(1f),
                ) { value ->
                    draftDepartments = draftDepartments.toggle(value)
                }
                PlannerFilterColumn(
                    title = "CATEGORIE",
                    options = categoryOptions.map { it to it },
                    selected = draftCategories,
                    modifier = Modifier.weight(1f),
                ) { value ->
                    draftCategories = draftCategories.toggle(value)
                }
                PlannerFilterColumn(
                    title = "MACCHINE",
                    options = machineOptions.map { it.id to it.name },
                    selected = draftMachines,
                        modifier = Modifier.weight(1.35f),
                ) { value ->
                    draftMachines = draftMachines.toggle(value)
                }
            }
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = onDismiss) { Text("Annulla") }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            val validCategories = effectiveCategories
                            val validMachines =
                                draftMachines.intersect(machineOptions.map { it.id }.toSet())
                            onApply(draftDepartments, validCategories, validMachines)
                        },
                    ) {
                        Text("Applica filtri")
                    }
                }
            }
        }
    }
}

@Composable
private fun PlannerFilterColumn(
    title: String,
    options: List<Pair<String, String>>,
    selected: Set<String>,
    modifier: Modifier,
    onToggle: (String) -> Unit,
) {
    Card(modifier.fillMaxHeight()) {
        Column(Modifier.fillMaxSize().padding(6.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(5.dp),
            )
            LazyColumn(Modifier.weight(1f)) {
                items(options, key = { it.first }) { (value, label) ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable { onToggle(value) }
                            .padding(vertical = 1.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = value in selected,
                            onCheckedChange = { onToggle(value) },
                        )
                        Text(
                            label,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(end = 5.dp),
                        )
                    }
                }
                if (options.isEmpty()) {
                    item { Text("Nessuna voce", style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
    }
}

@Composable
private fun PlannerArticleFilterDialog(
    articlePattern: String,
    details: String,
    onDismiss: () -> Unit,
    onApply: (String, String) -> Unit,
) {
    var draftPattern by remember { mutableStateOf(articlePattern) }
    var draftDetails by remember { mutableStateOf(details) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Filtri articoli") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
                OutlinedTextField(
                    value = draftPattern,
                    onValueChange = { draftPattern = it },
                    label = { Text("Codice articolo") },
                    supportingText = {
                        Text("Wildcard: %, _, [], [^], intervalli con - e chiusura esatta con |")
                    },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                OutlinedTextField(
                    value = draftDetails,
                    onValueChange = { draftDetails = it },
                    label = { Text("Cliente, fase o materiale") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Text(
                    "Esempi: 1144 · %1144 · %1144| · 1144| · T%50|",
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        },
        confirmButton = {
            Button(onClick = { onApply(draftPattern.trim(), draftDetails.trim()) }) {
                Text("Applica")
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { onApply("", "") }) { Text("Azzera") }
                TextButton(onClick = onDismiss) { Text("Annulla") }
            }
        },
    )
}

private fun Set<String>.toggle(value: String): Set<String> =
    if (value in this) this - value else this + value

private fun matchesPlannerDetails(job: PlannerJob, query: String): Boolean {
    val normalized = query.trim()
    if (normalized.isBlank()) return true
    return listOf(job.customer, job.phase, job.materialAlloy, job.notes)
        .any { it.contains(normalized, ignoreCase = true) }
}

private fun matchesArticlePattern(article: String, query: String): Boolean {
    val source = query.trim()
    if (source.isBlank()) return true
    val exactEnd = source.endsWith("|")
    val pattern = if (exactEnd) source.dropLast(1) else source
    val regex = StringBuilder("^")
    var index = 0
    while (index < pattern.length) {
        when (val character = pattern[index]) {
            '%' -> regex.append(".*")
            '_' -> regex.append('.')
            '[' -> {
                val close = pattern.indexOf(']', index + 1)
                if (close > index + 1) {
                    regex.append(pattern.substring(index, close + 1))
                    index = close
                } else {
                    regex.append("\\[")
                }
            }
            '{' -> {
                val close = pattern.indexOf('}', index + 1)
                if (close > index + 1) {
                    regex.append(Regex.escape(pattern.substring(index + 1, close)))
                    index = close
                } else {
                    regex.append("\\{")
                }
            }
            else -> regex.append(Regex.escape(character.toString()))
        }
        index += 1
    }
    if (!exactEnd) regex.append(".*")
    regex.append('$')
    return runCatching {
        Regex(regex.toString(), RegexOption.IGNORE_CASE).matches(article)
    }.getOrDefault(false)
}

private data class PlannerGanttItem(
    val job: PlannerJob,
    val start: LocalDate,
    val end: LocalDate,
    val lane: Int,
)

@Composable
private fun PlannerGantt(
    snapshot: PlannerSnapshot,
    onJob: (PlannerJob) -> Unit,
    onMachineFilter: () -> Unit,
    machineFilterActive: Boolean,
    modifier: Modifier = Modifier,
) {
    val rangeStart = remember { LocalDate.now().minusDays(90) }
    val rangeDays = 365
    val horizontalScroll = rememberScrollState()
    val machineListState = rememberLazyListState()
    val ganttListState = rememberLazyListState()
    val density = LocalDensity.current
    val dayWidth = with(density) { 58.dp.roundToPx().toDp() }
    val machineWidth = 148.dp
    val rangeEnd = rangeStart.plusDays(rangeDays.toLong() - 1)
    val days = (0 until rangeDays).map { rangeStart.plusDays(it.toLong()) }
    val machineRows = snapshot.machines.map { machine ->
        val items = plannerGanttLanes(snapshot.jobs.filter { it.machineId == machine.id })
        val laneCount = (items.maxOfOrNull { it.lane } ?: 0) + 1
        Triple(machine, items, (laneCount * 36 + 8).coerceAtLeast(58).dp)
    }
    LaunchedEffect(Unit) {
        val initialDay = ChronoUnit.DAYS.between(rangeStart, LocalDate.now()).toInt() - 1
        horizontalScroll.scrollTo(with(density) { (dayWidth * initialDay).roundToPx() })
    }
    LaunchedEffect(ganttListState) {
        snapshotFlow {
            ganttListState.firstVisibleItemIndex to ganttListState.firstVisibleItemScrollOffset
        }.distinctUntilChanged().collect { (index, offset) ->
            machineListState.scrollToItem(index, offset)
        }
    }

    Surface(
        modifier = modifier.fillMaxSize().padding(6.dp),
        shape = RoundedCornerShape(12.dp),
        tonalElevation = 1.dp,
    ) {
        Row(Modifier.fillMaxSize()) {
            Column(Modifier.width(machineWidth).fillMaxHeight()) {
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .clickable(onClick = onMachineFilter),
                ) {
                    Box(Modifier.padding(10.dp), contentAlignment = Alignment.CenterStart) {
                        Text(
                            if (machineFilterActive) "MACCHINA / REPARTO  •" else "MACCHINA / REPARTO",
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
                LazyColumn(
                    state = machineListState,
                    userScrollEnabled = false,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                ) {
                    items(machineRows, key = { it.first.id }) { (machine, _, rowHeight) ->
                        PlannerMachineCell(machine, machineWidth, rowHeight)
                    }
                    if (machineRows.isEmpty()) {
                        item {
                            Box(
                                Modifier.width(machineWidth).height(70.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("Nessun risultato", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .horizontalScroll(horizontalScroll)
                    .width(dayWidth * rangeDays),
            ) {
                Row(Modifier.fillMaxWidth().height(56.dp)) {
                    days.forEach { day -> PlannerDayHeader(day, dayWidth) }
                }
                LazyColumn(
                    state = ganttListState,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                ) {
                    items(machineRows, key = { it.first.id }) { (machine, items, rowHeight) ->
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(rowHeight),
                        ) {
                            PlannerGanttGrid(
                                days = days,
                                dayWidth = dayWidth,
                                machine = machine,
                                snapshot = snapshot,
                            )
                            items.forEach { item ->
                                if (!item.end.isBefore(rangeStart) && !item.start.isAfter(rangeEnd)) {
                                    val visibleStart = maxOf(item.start, rangeStart)
                                    val visibleEnd = minOf(item.end, rangeEnd)
                                    val offsetDays =
                                        ChronoUnit.DAYS.between(rangeStart, visibleStart).toInt()
                                    val visibleDays =
                                        ChronoUnit.DAYS.between(visibleStart, visibleEnd).toInt() + 1
                                    PlannerGanttBar(
                                        item = item,
                                        clippedStart = item.start.isBefore(rangeStart),
                                        clippedEnd = item.end.isAfter(rangeEnd),
                                        modifier = Modifier
                                            .offset(
                                                x = dayWidth * offsetDays,
                                                y = (item.lane * 36 + 4).dp,
                                            )
                                            .width(dayWidth * visibleDays)
                                            .height(30.dp)
                                            .zIndex(2f),
                                        onClick = { onJob(item.job) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PlannerGanttGrid(
    days: List<LocalDate>,
    dayWidth: androidx.compose.ui.unit.Dp,
    machine: PlannerMachine,
    snapshot: PlannerSnapshot,
) {
    val grid = Color(0xFFD9E1EA)
    Canvas(Modifier.fillMaxSize()) {
        val cellWidth = dayWidth.toPx()
        days.forEachIndexed { index, day ->
            val left = index * cellWidth
            val stopped = snapshot.unavailabilities.any { stop ->
                (stop.machineId.isBlank() || stop.machineId == machine.id) &&
                    dayInRange(day, stop.start, stop.end)
            }
            val fill = when {
                stopped -> Color(0xFFEDE3F8)
                day.dayOfWeek == DayOfWeek.SATURDAY ||
                    day.dayOfWeek == DayOfWeek.SUNDAY -> Color(0xFFF1F4F8)
                else -> Color.White
            }
            drawRect(
                color = fill,
                topLeft = androidx.compose.ui.geometry.Offset(left, 0f),
                size = androidx.compose.ui.geometry.Size(cellWidth, size.height),
            )
            drawLine(
                color = if (day == LocalDate.now()) Color(0xFFE53935) else grid,
                start = androidx.compose.ui.geometry.Offset(left, 0f),
                end = androidx.compose.ui.geometry.Offset(left, size.height),
                strokeWidth = if (day == LocalDate.now()) 2f else 1f,
            )
        }
        drawLine(
            color = grid,
            start = androidx.compose.ui.geometry.Offset(0f, size.height - 1f),
            end = androidx.compose.ui.geometry.Offset(size.width, size.height - 1f),
            strokeWidth = 1f,
        )
    }
}

@Composable
private fun PlannerDayHeader(day: LocalDate, width: androidx.compose.ui.unit.Dp) {
    val weekend = day.dayOfWeek == DayOfWeek.SATURDAY || day.dayOfWeek == DayOfWeek.SUNDAY
    val formatter = DateTimeFormatter.ofPattern("EEE", java.util.Locale.ITALIAN)
    Surface(
        color = when {
            day == LocalDate.now() -> Color(0xFFDDEEFF)
            weekend -> Color(0xFFE9EEF5)
            else -> MaterialTheme.colorScheme.surfaceVariant
        },
        modifier = Modifier.width(width).height(56.dp).border(.5.dp, Color(0xFFD3DCE7)),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(formatter.format(day), style = MaterialTheme.typography.labelSmall)
            Text(day.dayOfMonth.toString(), fontWeight = FontWeight.Black)
            Text(
                day.month.getDisplayName(
                    java.time.format.TextStyle.SHORT,
                    java.util.Locale.ITALIAN,
                ),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun PlannerMachineCell(
    machine: PlannerMachine,
    width: androidx.compose.ui.unit.Dp,
    height: androidx.compose.ui.unit.Dp,
) {
    val accent = runCatching {
        Color(android.graphics.Color.parseColor(machine.color))
    }.getOrDefault(MaterialTheme.colorScheme.primary)
    Surface(
        modifier = Modifier.width(width).height(height).border(.5.dp, Color(0xFFD9E1EA)),
        color = Color.White,
    ) {
        Row(
            Modifier.padding(9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.width(5.dp).fillMaxHeight().clip(RoundedCornerShape(5.dp)).background(accent),
            )
            Spacer(Modifier.width(8.dp))
            Column {
                Text(
                    machine.name,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    listOf(machine.department, machine.category)
                        .filter(String::isNotBlank).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun PlannerGanttBar(
    item: PlannerGanttItem,
    clippedStart: Boolean,
    clippedEnd: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val base = materialColor(item.job.materialStatus)
    val progress = item.job.progressDays.toFloat() / item.job.durationDays.coerceAtLeast(1).toFloat()
    Surface(
        modifier = modifier.clip(RoundedCornerShape(7.dp)).clickable(onClick = onClick),
        color = base.copy(alpha = .18f),
        border = androidx.compose.foundation.BorderStroke(1.dp, base),
    ) {
        Box {
            if (progress > 0f) {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(progress.coerceIn(0f, 1f))
                        .background(base.copy(alpha = .28f)),
                )
            }
            Row(
                Modifier.fillMaxSize().padding(horizontal = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (clippedStart) Text("‹ ", color = base, fontWeight = FontWeight.Black)
                Text(
                    listOf(item.job.article, item.job.customer)
                        .filter(String::isNotBlank).joinToString(" · "),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (clippedEnd) Text(" ›", color = base, fontWeight = FontWeight.Black)
            }
        }
    }
}

private fun plannerGanttLanes(jobs: List<PlannerJob>): List<PlannerGanttItem> {
    val laneEnds = mutableListOf<LocalDate>()
    val datedJobs = jobs.mapNotNull { job ->
        val start = job.start.toLocalDateOrNull() ?: return@mapNotNull null
        val end = job.end.toLocalDateOrNull()
            ?: start.plusDays(job.durationDays.coerceAtLeast(1).toLong() - 1)
        Triple(job, start, end)
    }.sortedWith(compareBy({ it.second }, { it.third }))
    return datedJobs.map { (job, start, end) ->
        val lane = laneEnds.indexOfFirst { it.isBefore(start) }.let {
            if (it >= 0) it else laneEnds.size
        }
        if (lane == laneEnds.size) laneEnds.add(end) else laneEnds[lane] = end
        PlannerGanttItem(job, start, end, lane)
    }
}

private fun String.toLocalDateOrNull(): LocalDate? =
    takeIf(String::isNotBlank)?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }

private fun dayInRange(day: LocalDate, start: String, end: String): Boolean {
    val from = start.toLocalDateOrNull() ?: return false
    val to = end.toLocalDateOrNull() ?: from
    return !day.isBefore(from) && !day.isAfter(to)
}

private fun materialColor(value: String): Color = when (value.lowercase()) {
    "available" -> Color(0xFF20B878)
    "partial" -> Color(0xFF9AB832)
    "incoming" -> Color(0xFFF0AA28)
    "unavailable" -> Color(0xFFE05764)
    "verification" -> Color(0xFF8B63C7)
    else -> Color(0xFF5D7893)
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
