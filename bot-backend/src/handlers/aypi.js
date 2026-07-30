const { logEvent } = require('../utils/log');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { isAuthorized, canRole, isAdminUser } = require('../utils/auth');
const { safeAnswerCbQuery, safeReply, safeDelete } = require('../utils/telegram');
const menu = require('../menu');
const state = require('../state');
const { encodeRole, decodeRole } = require('../utils/roles');

function parseDateTime(value) {
  if (!value) return { date: '', time: '' };
  // Date-only ISO (YYYY-MM-DD)
  if (typeof value === 'string' && value.match(/^\\d{4}-\\d{2}-\\d{2}$/)) {
    const [yyyy, mm, dd] = value.split('-');
    return { date: `${dd}/${mm}/${yyyy}`, time: '' };
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: String(value), time: '' };
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return { date: `${dd}/${mm}/${yyyy}`, time: `${hh}:${min}` };
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return '';
}

function formatCalendarPending(item) {
  if (!item || typeof item !== 'object') return String(item);
  const name = pick(item, ['employee', 'employeeName', 'nome', 'name', 'utente', 'user']) || 'Sconosciuto';
  const type = pick(item, ['type', 'Type', 'tipo', 'reason', 'requestType']) || 'Tipo';
  const note = pick(item, ['note', 'notes', 'Note', 'Notes', 'nota', 'comment', 'comments']) || '';
  const id = pick(item, ['id', 'ID', 'Id']) || 'n/a';
  const allDayVal = pick(item, ['allDay', 'AllDay', 'allday']);
  const allDay = allDayVal === true || String(allDayVal).toLowerCase() === 'true';
  const startRaw = pick(item, ['start', 'from', 'dal', 'startDate', 'date']);
  const endRaw = pick(item, ['end', 'to', 'al', 'endDate', 'dateTo']);

  const sdt = parseDateTime(startRaw);
  const edt = parseDateTime(endRaw || startRaw);
  const d1 = sdt.date;
  const d2 = edt.date;
  const sameDay = d1 && d2 && d1 === d2;

  if (sameDay) {
    if (allDay) {
      return `${name} - ${type} - ${d1}${note ? ` - ${note}` : ''} - ${id}`;
    }
    const t1 = sdt.time;
    const t2 = edt.time;
    return `${name} - ${type} - ${d1} dalle ${t1} alle ${t2}${note ? ` - ${note}` : ''} - ${id}`;
  }
  return `${name} - ${type} - da ${d1} a ${d2}${note ? ` - ${note}` : ''} - ${id}`;
}

function getApproverName(ctx) {
  const chatId = ctx?.chat?.id;
  if (!chatId) return '';
  const owners = require('../storage').loadOwners();
  return owners[String(chatId)] || ctx?.from?.first_name || ctx?.from?.username || 'Admin';
}

function loadCalendarRequests() {
  if (!config.calendarPendingFile) return [];
  const baseDir = path.dirname(config.calendarPendingFile);
  const baseName = path.basename(config.calendarPendingFile);
  const files = [];
  if (fs.existsSync(config.calendarPendingFile)) {
    files.push(config.calendarPendingFile);
  }
  // If pattern matches requests-YYYY.json, include all years in the same folder
  if (baseName.match(/^requests-\d{4}\.json$/) && fs.existsSync(baseDir)) {
    try {
      const list = fs
        .readdirSync(baseDir)
        .filter((f) => f.match(/^requests-\d{4}\.json$/))
        .sort();
      list.forEach((f) => {
        const full = path.join(baseDir, f);
        if (!files.includes(full)) files.push(full);
      });
    } catch {
      // ignore
    }
  }
  const all = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) all.push(...data);
      else if (Array.isArray(data.requests)) all.push(...data.requests);
      else if (Array.isArray(data.pending)) all.push(...data.pending);
    } catch (err) {
      console.warn('Calendar requests read error:', err.message);
    }
  }
  return all;
}

function loadCalendarFilters() {
  if (!config.calendarConfigFile) return {};
  if (!fs.existsSync(config.calendarConfigFile)) return {};
  try {
    const raw = fs.readFileSync(config.calendarConfigFile, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data.filters === 'object' ? data.filters : {};
  } catch (err) {
    console.warn('Calendar config read error:', err.message);
    return {};
  }
}

function saveCalendarRequests(list) {
  fs.writeFileSync(config.calendarPendingFile, JSON.stringify(list, null, 2), 'utf8');
}

function formatCalendarMine(item) {
  if (!item || typeof item !== 'object') return String(item);
  const name = pick(item, ['employee']) || 'Sconosciuto';
  const type = pick(item, ['type']) || 'Tipo';
  const note = pick(item, ['note']) || '';
  const approvedBy = pick(item, ['approvedBy']) || '';
  const rejectedBy = pick(item, ['rejectedBy']) || '';
  const deletedBy = pick(item, ['deletedBy']) || '';
  const status = String(pick(item, ['status']) || '').toLowerCase();
  const isRejected = status === 'rejected' || status === 'deleted';
  const statusLabel = isRejected ? '❌' : '✔️';
  const by = status === 'deleted' ? deletedBy : status === 'rejected' ? rejectedBy : approvedBy;
  const allDayVal = pick(item, ['allDay']);
  const allDay = allDayVal === true || String(allDayVal).toLowerCase() === 'true';
  const startRaw = pick(item, ['start']);
  const endRaw = pick(item, ['end']);

  const sdt = parseDateTime(startRaw);
  const edt = parseDateTime(endRaw || startRaw);
  const d1 = sdt.date;
  const d2 = edt.date;
  const sameDay = d1 && d2 && d1 === d2;

  if (sameDay) {
    if (allDay) {
      return `${name} - ${type} - ${d1}${note ? ` - ${note}` : ''} - ${statusLabel} - ${by}`;
    }
    const t1 = sdt.time;
    const t2 = edt.time;
    return `${name} - ${type} - ${d1} dalle ${t1} alle ${t2}${note ? ` - ${note}` : ''} - ${statusLabel} - ${by}`;
  }
  return `${name} - ${type} - da ${d1} a ${d2}${note ? ` - ${note}` : ''} - ${statusLabel} - ${by}`;
}

function isFuture(startRaw) {
  if (!startRaw) return false;
  const d = new Date(startRaw);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() >= today.getTime();
}

function getEmployeeNames(list) {
  const set = new Set();
  list.forEach((r) => {
    const name = String(r && r.employee ? r.employee : '').trim();
    if (name) set.add(name);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

function buildEmployeePage(names, offset, pageSize) {
  const start = Math.max(0, offset);
  const slice = names.slice(start, start + pageSize);
  const rows = [];
  const page = Math.floor(start / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(names.length / pageSize));
  for (let i = 0; i < slice.length; i += 2) {
    const left = slice[i];
    const right = slice[i + 1];
    const leftBtn = { text: left, callback_data: `aypi:calendar:reqs:user:${encodeRole(left)}` };
    if (right) {
      const rightBtn = { text: right, callback_data: `aypi:calendar:reqs:user:${encodeRole(right)}` };
      rows.push([leftBtn, rightBtn]);
    } else {
      rows.push([leftBtn]);
    }
  }
  const nav = [];
  if (start > 0) nav.push({ text: '◀︎', callback_data: `aypi:calendar:reqs:pickpage:${start - pageSize}` });
  nav.push({ text: `${page}/${totalPages}`, callback_data: 'aypi:calendar:noop' });
  if (start + pageSize < names.length)
    nav.push({ text: '▶︎', callback_data: `aypi:calendar:reqs:pickpage:${start + pageSize}` });
  if (nav.length) rows.unshift(nav);
  rows.push([
    { text: 'Indietro', callback_data: 'aypi:calendar', style: 'danger' },
    { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
  ]);
  return rows;
}

function filterRequestsByEmployee(list, name, onlyFuture) {
  return list.filter((r) => {
    const status = String((r && r.status) || '').toLowerCase();
    if (status !== 'approved' && status !== 'rejected' && status !== 'deleted') return false;
    if (String(r.employee || '') !== String(name || '')) return false;
    if (onlyFuture && !isFuture(r.start)) return false;
    return true;
  });
}

function sortByStartDate(list) {
  return list.sort((a, b) => {
    const da = new Date(a && a.start ? a.start : 0).getTime();
    const db = new Date(b && b.start ? b.start : 0).getTime();
    return da - db;
  });
}

const REQ_TYPES = [
  { key: 'ferie', label: 'Ferie' },
  { key: 'permesso', label: 'Permesso' },
  { key: 'straordinari', label: 'Straordinari' },
  { key: 'mutua', label: 'Mutua' },
  { key: 'speciale', label: 'Speciale' },
  { key: 'retribuito', label: 'Retribuito' },
];

function buildReqsKeyboard(stateObj) {
  const rows = [];
  for (let i = 0; i < REQ_TYPES.length; i += 2) {
    const left = REQ_TYPES[i];
    const right = REQ_TYPES[i + 1];
    const leftOn = stateObj.types.has(left.key);
    const leftBtn = {
      text: left.label,
      callback_data: `aypi:calendar:reqs:toggle:${left.key}`,
      style: leftOn ? 'success' : 'primary',
    };
    if (right) {
      const rightOn = stateObj.types.has(right.key);
      const rightBtn = {
        text: right.label,
        callback_data: `aypi:calendar:reqs:toggle:${right.key}`,
        style: rightOn ? 'success' : 'primary',
      };
      rows.push([leftBtn, rightBtn]);
    } else {
      rows.push([leftBtn]);
    }
  }
  const allOn = REQ_TYPES.every((t) => stateObj.types.has(t.key));
  rows.push([
    {
      text: allOn ? 'Deseleziona Tutto' : 'Seleziona Tutto',
      callback_data: allOn ? 'aypi:calendar:reqs:notypes' : 'aypi:calendar:reqs:alltypes',
    },
  ]);
  rows.push([
    {
      text: stateObj.mode === 'all' ? 'Solo future' : 'Tutto',
      callback_data: 'aypi:calendar:reqs:mode',
    },
    { text: 'Indietro', callback_data: 'aypi:calendar', style: 'danger' },
  ]);
  if (stateObj.mode === 'all' && stateObj.totalPages > 1) {
    const nav = [];
    if (stateObj.page > 1) nav.push({ text: '◀︎ Recenti', callback_data: `aypi:calendar:reqs:page:${stateObj.page - 1}` });
    nav.push({ text: `${stateObj.page}/${stateObj.totalPages}`, callback_data: 'aypi:calendar:noop' });
    if (stateObj.page < stateObj.totalPages)
      nav.push({ text: 'Più vecchie ▶︎', callback_data: `aypi:calendar:reqs:page:${stateObj.page + 1}` });
    rows.unshift(nav);
  }
  return rows;
}

function applyTypeFilter(list, typeSet) {
  if (!typeSet || typeSet.size === 0) return [];
  return list.filter((r) => typeSet.has(String(r.type || '').toLowerCase().trim()));
}

function buildReqsState(chatId, employee) {
  return {
    chatId,
    employee,
    mode: 'future',
    types: new Set(REQ_TYPES.map((t) => t.key)),
    page: 1,
    totalPages: 1,
  };
}

function renderReqsView(ctx, reqState, list) {
  const filtered = applyTypeFilter(list, reqState.types);
  let visible = filtered;
  if (reqState.mode === 'future') {
    visible = sortByStartDate(filtered);
    const maxLines = 30;
    const body = visible.length ? visible.slice(0, maxLines).map(formatCalendarMine).join('\n') : 'Nessuna richiesta futura trovata.';
    const extra = visible.length > maxLines ? `\n\nMostrate ${maxLines} di ${visible.length}.` : '';
    return menu.sendMenuMessage(
      ctx,
      `Richieste future di ${reqState.employee}:\n${body}${extra}`,
      { inline_keyboard: buildReqsKeyboard(reqState) }
    );
  }

  // all (past + future), paginate by 30, most recent first
  const sortedDesc = filtered.sort((a, b) => {
    const da = new Date(a && a.start ? a.start : 0).getTime();
    const db = new Date(b && b.start ? b.start : 0).getTime();
    return db - da;
  });
  const pageSize = 30;
  const totalPages = Math.max(1, Math.ceil(sortedDesc.length / pageSize));
  const page = Math.min(Math.max(reqState.page, 1), totalPages);
  reqState.page = page;
  reqState.totalPages = totalPages;
  const start = (page - 1) * pageSize;
  const chunk = sortedDesc.slice(start, start + pageSize);
  const body =
    chunk.length ? chunk.map(formatCalendarMine).join('\n') : 'Nessuna richiesta trovata.';
  const extra = sortedDesc.length > pageSize ? `\n\nMostrate ${chunk.length} di ${sortedDesc.length}.` : '';
  return menu.sendMenuMessage(
    ctx,
    `Tutte le richieste di ${reqState.employee}:\n${body}${extra}`,
    { inline_keyboard: buildReqsKeyboard(reqState) }
  );
}

function toDateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateObj(dateStr) {
  if (!dateStr) return null;
  const [yyyy, mm, dd] = dateStr.split('-').map(Number);
  if (!yyyy || !mm || !dd) return null;
  return new Date(yyyy, mm - 1, dd);
}

function isOnDate(item, dateStr) {
  const start = toDateOnly(item.start);
  const end = toDateOnly(item.end || item.start);
  if (!start) return false;
  const d = dateObj(dateStr);
  const s = dateObj(start);
  const e = dateObj(end || start);
  if (!d || !s || !e) return false;
  return d.getTime() >= s.getTime() && d.getTime() <= e.getTime();
}

function formatCalendarDayItem(item) {
  if (!item || typeof item !== 'object') return String(item);
  const name = pick(item, ['employee']) || 'Sconosciuto';
  const type = pick(item, ['type']) || 'Tipo';
  const allDayVal = pick(item, ['allDay']);
  const allDay = allDayVal === true || String(allDayVal).toLowerCase() === 'true';
  const startRaw = pick(item, ['start']);
  const endRaw = pick(item, ['end']);

  const sdt = parseDateTime(startRaw);
  const edt = parseDateTime(endRaw || startRaw);
  const d1 = sdt.date;
  const d2 = edt.date;
  const sameDay = d1 && d2 && d1 === d2;

  if (sameDay) {
    if (allDay) {
      return `${name} - ${type} - ${d1}`;
    }
    const t1 = sdt.time;
    const t2 = edt.time;
    return `${name} - ${type} - ${d1} dalle ${t1} alle ${t2}`;
  }
  return `${name} - ${type} - da ${d1} a ${d2}`;
}

function getMonthKeyFromDate(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function getMonthRange(monthKey) {
  const [yyyy, mm] = monthKey.split('-').map(Number);
  const start = new Date(yyyy, mm - 1, 1);
  const end = new Date(yyyy, mm, 0);
  return { start, end };
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function dayKeyFromDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getVisibleDayHighlights(ctx, monthKey) {
  if (!config.calendarPendingFile || !fs.existsSync(config.calendarPendingFile)) return new Map();
  const list = loadCalendarRequests();
  const filters = loadCalendarFilters();
  const admin = isAdminUser(ctx);
  const canSeePending = canRole(ctx, 'calendar_pending');
  const { start, end } = getMonthRange(monthKey);
  const styles = new Map();
  list.forEach((r) => {
    if (!r || typeof r !== 'object') return;
    const status = String(r.status || '').toLowerCase();
    if (status && status !== 'approved' && status !== 'pending') return;
    if (status === 'pending' && !canSeePending) return;
    const typeKey = String(r.type || '').toLowerCase().trim();
    if (!admin && filters[typeKey] === true) return;
    const startStr = toDateOnly(r.start);
    const endStr = toDateOnly(r.end || r.start);
    const s = dateObj(startStr);
    const e = dateObj(endStr || startStr);
    if (!s || !e) return;
    if (e < start || s > end) return;
    const loopStart = s > start ? s : start;
    const loopEnd = e < end ? e : end;
    let cur = new Date(loopStart.getTime());
    let guard = 0;
    while (cur <= loopEnd && guard < 400) {
      const key = dayKeyFromDate(cur);
      if (status === 'pending') {
        styles.set(key, 'danger');
      } else if (!styles.has(key)) {
        styles.set(key, 'primary');
      }
      cur = addDays(cur, 1);
      guard += 1;
    }
  });
  return styles;
}

function toDateOnlyDisplay(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isFutureOrToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d.getTime() >= today.getTime();
}

function loadCalendarExtra(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    return [];
  } catch (err) {
    console.warn('Calendar extra read error:', err.message);
    return [];
  }
}

function formatExtraItem(item) {
  if (!item || typeof item !== 'object') return String(item);
  const name =
    item.name || item.title || item.label || item.event || item.reason || item.tipo || 'Evento';
  const start = item.start || item.from || item.date || item.day;
  const end = item.end || item.to || start;
  if (start && end && toDateOnly(start) === toDateOnly(end)) {
    return `${name} - ${toDateOnlyDisplay(start)}`;
  }
  if (start && end) {
    return `${name} - da ${toDateOnlyDisplay(start)} a ${toDateOnlyDisplay(end)}`;
  }
  return `${name}`;
}

const TICKET_PAGE_SIZE = 10;

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function getRequesterName(ticket) {
  const req = (ticket && ticket.requester) || {};
  const first = req.name || req.nome || '';
  const last = req.surname || req.cognome || '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || req.fullName || req.email || '';
}

function getRequesterEmail(ticket) {
  const req = (ticket && ticket.requester) || {};
  return req.email || '';
}

function formatTicketDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  }
}

function listTicketFiles() {
  const files = new Set();
  const addDir = (dir) => {
    if (!dir || !fs.existsSync(dir)) return;
    try {
      const items = fs.readdirSync(dir);
      items.forEach((f) => {
        if (/^ticket-\d{4}\.json$/i.test(f)) {
          files.add(path.join(dir, f));
        }
      });
    } catch {
      // ignore
    }
  };
  addDir(config.ticketYearsDir);
  return [...files].sort();
}

function readTicketFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.tickets)) return data.tickets;
    return [];
  } catch {
    return [];
  }
}

function loadTicketFileData(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
    return null;
  } catch {
    return null;
  }
}

function saveTicketFileData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Ticket file save error:', err.message);
    return false;
  }
}

function loadAllTickets() {
  const files = listTicketFiles();
  const all = [];
  files.forEach((file) => {
    const list = readTicketFile(file);
    list.forEach((t) => {
      if (t && typeof t === 'object') all.push({ ...t, __file: file });
    });
  });
  return all;
}

function sortTicketsDesc(list) {
  return list.sort((a, b) => {
    const da = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const db = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return db - da;
  });
}

function isRecentClosure(ticket, days) {
  const status = String(ticket.status || '').toLowerCase();
  if (status !== 'risolto' && status !== 'chiuso') return true;
  const ref = status === 'chiuso' ? ticket.closedAt : ticket.resolvedAt;
  const date = ref || ticket.updatedAt || ticket.lastStatusChangeAt || '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  const limit = Date.now() - days * 24 * 60 * 60 * 1000;
  return d.getTime() >= limit;
}

function filterTicketsForName(list, ownerName) {
  const target = normalizeName(ownerName);
  if (!target) return [];
  return list.filter((t) => normalizeName(getRequesterName(t)) === target);
}

function formatTicketLine(t) {
  const id = t.id || 'n/a';
  const requester = getRequesterName(t) || 'Sconosciuto';
  const issueType = t.issueType || '';
  const area = t.area || '';
  return `${id} | ${requester} | ${issueType} | ${area}`;
}

function buildTicketListKeyboard(slice, page, totalPages) {
  const rows = [];
  for (let i = 0; i < slice.length; i += 2) {
    const left = slice[i];
    const right = slice[i + 1];
    const row = [];
    if (left && left.id) {
      const status = String(left.status || '').toLowerCase();
      const style = status === 'risolto' ? 'success' : status === 'chiuso' ? 'primary' : undefined;
      row.push({ text: String(left.id), callback_data: `aypi:ticket:detail:${left.id}`, ...(style ? { style } : {}) });
    }
    if (right && right.id) {
      const status = String(right.status || '').toLowerCase();
      const style = status === 'risolto' ? 'success' : status === 'chiuso' ? 'primary' : undefined;
      row.push({ text: String(right.id), callback_data: `aypi:ticket:detail:${right.id}`, ...(style ? { style } : {}) });
    }
    if (row.length) rows.push(row);
  }
  if (totalPages > 1) {
    const nav = [];
    if (page > 1) nav.push({ text: '◀︎', callback_data: `aypi:ticket:list:page:${page - 1}` });
    nav.push({ text: `${page}/${totalPages}`, callback_data: 'aypi:ticket:noop' });
    if (page < totalPages) nav.push({ text: '▶︎', callback_data: `aypi:ticket:list:page:${page + 1}` });
    rows.unshift(nav);
  }
  rows.push([
    { text: 'Indietro', callback_data: 'aypi:ticket' },
    { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
  ]);
  return rows;
}

function formatTicketHistoryEntry(item) {
  if (!item || typeof item !== 'object') return String(item);
  const when = formatTicketDate(item.at || item.date || item.createdAt || item.timestamp || '');
  const event = item.event || item.type || 'Evento';
  const actor = item.actor || item.by || item.user || '';
  const fromStatus = item.fromStatus || item.from || '';
  const toStatus = item.toStatus || item.to || '';
  const note = item.note || item.info || item.comment || '';
  const parts = [];
  if (when) parts.push(when);
  if (event) parts.push(event);
  if (actor) parts.push(`da ${actor}`);
  if (event !== 'Ticket creato' && (fromStatus || toStatus)) {
    const from = fromStatus || '';
    const to = toStatus || '';
    const arrow = from && to ? ' -> ' : '';
    parts.push(`${from}${arrow}${to}`.trim());
  }
  if (note) parts.push(`${note}`);
  return parts.join(' | ');
}

function formatTicketHistory(ticket) {
  const history = Array.isArray(ticket && ticket.history) ? ticket.history : [];
  if (!history.length) return 'Nessuno storico disponibile.';
  const lines = history.map((h) => `- ${formatTicketHistoryEntry(h)}`);
  const maxLines = 50;
  const trimmed = lines.slice(0, maxLines);
  const extra = lines.length > maxLines ? `\n\nMostrati ${trimmed.length} di ${lines.length}.` : '';
  return trimmed.join('\n') + extra;
}

function loadTicketCategories() {
  if (!config.ticketCategoriesPath || !fs.existsSync(config.ticketCategoriesPath)) {
    return { error: 'File categorie ticket non trovato.' };
  }
  try {
    const raw = fs.readFileSync(config.ticketCategoriesPath, 'utf8');
    const data = JSON.parse(raw);
    const issueTypes = Array.isArray(data && data.issueTypes) ? data.issueTypes : [];
    const areas = Array.isArray(data && data.areas) ? data.areas : [];
    return { issueTypes, areas };
  } catch (err) {
    console.error('Ticket categories read error:', err.message);
    return { error: 'Errore nella lettura delle categorie ticket.' };
  }
}

function buildTicketChoiceKeyboard(list, prefix, backCb) {
  const rows = [];
  for (let i = 0; i < list.length; i += 2) {
    const left = list[i];
    const right = list[i + 1];
    const row = [];
    if (left) row.push({ text: String(left), callback_data: `${prefix}:${encodeRole(left)}` });
    if (right) row.push({ text: String(right), callback_data: `${prefix}:${encodeRole(right)}` });
    if (row.length) rows.push(row);
  }
  rows.push([
    { text: 'Indietro', callback_data: backCb },
    { text: 'Annulla', callback_data: 'aypi:ticket:new:cancel', style: 'danger' },
  ]);
  return rows;
}

function buildTicketPriorityKeyboard(prefix, backCb) {
  const priorities = ['Bassa', 'Media', 'Alta', 'Urgente'];
  return buildTicketChoiceKeyboard(priorities, prefix, backCb);
}

function loadAssignees() {
  if (!config.assigneesFile || !fs.existsSync(config.assigneesFile)) {
    return { groups: {}, emails: {} };
  }
  try {
    const raw = fs.readFileSync(config.assigneesFile, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { groups: {}, emails: {} };
    return { groups: data.groups || {}, emails: data.emails || {} };
  } catch (err) {
    console.warn('Assignees read error:', err.message);
    return { groups: {}, emails: {} };
  }
}

function buildAssigneesIndex() {
  const { groups, emails } = loadAssignees();
  const nameToDept = new Map();
  const firstToNames = new Map();
  Object.keys(groups || {}).forEach((dept) => {
    const list = Array.isArray(groups[dept]) ? groups[dept] : [];
    list.forEach((full) => {
      const fullName = String(full || '').trim();
      if (!fullName) return;
      nameToDept.set(fullName.toLowerCase(), dept);
      const first = fullName.split(/\s+/)[0] || '';
      if (!first) return;
      const key = first.toLowerCase();
      const arr = firstToNames.get(key) || [];
      arr.push(fullName);
      firstToNames.set(key, arr);
    });
  });
  const nameToEmail = new Map();
  Object.keys(emails || {}).forEach((key) => {
    const val = emails[key];
    const parts = String(key).split('|');
    const name = parts[1] ? parts[1].trim() : '';
    if (name) nameToEmail.set(name.toLowerCase(), String(val || '').trim());
  });
  return { nameToDept, nameToEmail, firstToNames };
}

function generateTicketId(now) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `TS-${yyyy}${mm}${dd}-${hh}${min}${ss}-${rand}`;
}

function buildRequesterProfile(ctx) {
  const owners = require('../storage').loadOwners();
  const fromFirst = ctx?.from?.first_name || '';
  const fromLast = ctx?.from?.last_name || '';
  const fromFull = [fromFirst, fromLast].filter(Boolean).join(' ').trim();
  const ownerName = owners[String(ctx.chat.id)] || '';
  let fullName =
    ownerName ||
    fromFull ||
    ctx?.from?.first_name ||
    ctx?.from?.username ||
    'Operatore';
  const index = buildAssigneesIndex();
  const fullKey = String(fullName).trim().toLowerCase();
  if (!fullName.includes(' ')) {
    // prefer telegram first+last if available
    if (fromFull && fromLast) {
      fullName = fromFull;
    } else {
      const matches = index.firstToNames.get(fullKey) || [];
      if (matches.length === 1) fullName = matches[0];
    }
  }
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  const name = parts[0] || fullName;
  let surname = parts.slice(1).join(' ');
  if (!surname && fromLast) surname = fromLast;
  const dept = index.nameToDept.get(String(fullName).toLowerCase()) || '';
  const email = index.nameToEmail.get(String(fullName).toLowerCase()) || '';
  return {
    fullName,
    name,
    email,
    department: dept,
  };
}

function createTicketFromPending(ctx, pending, description) {
  if (!config.ticketYearsDir) {
    return { error: 'Percorsi ticket non configurati.' };
  }
  if (!pending || !pending.issueType || !pending.area || !pending.priority) {
    return { error: 'Procedura ticket incompleta.' };
  }
  const now = new Date();
  const year = now.getFullYear();
  const filePath = path.join(config.ticketYearsDir, `ticket-${year}.json`);
  let data = { version: 1, year, tickets: [] };
  try {
    if (!fs.existsSync(config.ticketYearsDir)) {
      fs.mkdirSync(config.ticketYearsDir, { recursive: true });
    }
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tickets)) {
        data = parsed;
      }
    }
  } catch (err) {
    console.error('Ticket file load error:', err.message);
    return { error: 'Errore nella lettura dei ticket.' };
  }

  const requester = buildRequesterProfile(ctx);
  const actor = requester.fullName;
  const createdByKey = isAdminUser(ctx) ? `admin|${actor}` : `person|${actor}`;
  const iso = now.toISOString();
  const ticket = {
    id: generateTicketId(now),
    requester: {
      name: requester.fullName || requester.name || '',
      email: requester.email || '',
      department: requester.department || '',
    },
    issueType: pending.issueType || '',
    area: pending.area || '',
    priority: pending.priority || '',
    description: description || '',
    status: 'Da prendere in carico',
    createdAt: iso,
    updatedAt: iso,
    lastStatusChangeAt: iso,
    resolvedAt: '',
    closedAt: '',
    createdByKey,
    history: [
      {
        event: 'Ticket creato',
        actor,
        at: iso,
        note: '',
      },
    ],
  };
  data.version = data.version || 1;
  data.year = data.year || year;
  data.tickets = Array.isArray(data.tickets) ? data.tickets : [];
  data.tickets.push(ticket);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Ticket file save error:', err.message);
    return { error: 'Errore nel salvataggio del ticket.' };
  }
  return { id: ticket.id };
}

function hasAdminTouch(ticket) {
  const history = Array.isArray(ticket && ticket.history) ? ticket.history : [];
  return history.some((h) => String((h && h.event) || '').toLowerCase().includes('admin'));
}

function canAccessTicket(ctx, ticket) {
  const canAll = canRole(ctx, 'ticket_list_all') || isAdminUser(ctx);
  if (canAll) return true;
  const owners = require('../storage').loadOwners();
  const me = owners[String(ctx.chat.id)] || '';
  const requester = getRequesterName(ticket);
  return Boolean(me && normalizeName(me) === normalizeName(requester));
}

function canEditTicket(ctx, ticket) {
  if (!canRole(ctx, 'ticket_edit')) return false;
  if (isAdminUser(ctx)) return true;
  if (!canAccessTicket(ctx, ticket)) return false;
  return !hasAdminTouch(ticket);
}

function canDeleteTicket(ctx, ticket) {
  if (!canRole(ctx, 'ticket_delete')) return false;
  if (isAdminUser(ctx)) return true;
  if (!canAccessTicket(ctx, ticket)) return false;
  return !hasAdminTouch(ticket);
}

function canChangeTicketStatus(ctx, ticket) {
  if (!canRole(ctx, 'ticket_status')) return false;
  if (!isAdminUser(ctx)) return false;
  return canAccessTicket(ctx, ticket);
}

function updateTicketInFile(filePath, ticketId, updater) {
  const data = loadTicketFileData(filePath);
  if (!data || !Array.isArray(data.tickets)) return { error: 'File ticket non valido.' };
  const idx = data.tickets.findIndex((t) => String(t.id) === String(ticketId));
  if (idx === -1) return { error: 'Ticket non trovato.' };
  const target = data.tickets[idx];
  const updated = updater({ ...target });
  if (!updated) return { error: 'Aggiornamento non valido.' };
  data.tickets[idx] = updated;
  if (!saveTicketFileData(filePath, data)) return { error: 'Errore nel salvataggio.' };
  return { ok: true, ticket: updated };
}

function deleteTicketInFile(filePath, ticketId) {
  const data = loadTicketFileData(filePath);
  if (!data || !Array.isArray(data.tickets)) return { error: 'File ticket non valido.' };
  const before = data.tickets.length;
  data.tickets = data.tickets.filter((t) => String(t.id) !== String(ticketId));
  if (data.tickets.length === before) return { error: 'Ticket non trovato.' };
  if (!saveTicketFileData(filePath, data)) return { error: 'Errore nel salvataggio.' };
  return { ok: true };
}

function updateTicketDescription(ctx, ticketId, description, ticketFile) {
  if (!ticketFile) return { error: 'File ticket non valido.' };
  const data = loadTicketFileData(ticketFile);
  if (!data || !Array.isArray(data.tickets)) return { error: 'File ticket non valido.' };
  const existing = data.tickets.find((t) => String(t.id) === String(ticketId));
  if (!existing) return { error: 'Ticket non trovato.' };
  if (!canAccessTicket(ctx, existing)) return { error: 'Permesso negato per questo ticket.' };
  if (!canEditTicket(ctx, existing)) return { error: 'Permesso negato per la modifica.' };
  const now = new Date().toISOString();
  const actor = buildRequesterProfile(ctx).fullName;
  const event = isAdminUser(ctx) ? 'Modifica admin' : 'Modifica dipendente';
  return updateTicketInFile(ticketFile, ticketId, (t) => {
    const oldVal = t.description || '';
    const next = { ...t };
    next.description = description;
    next.updatedAt = now;
    next.history = Array.isArray(next.history) ? next.history : [];
    next.history.push({
      event,
      actor,
      at: now,
      note: `Modifiche: Descrizione: "${oldVal}" -> "${description}"`,
    });
    return next;
  });
}

function updateTicketStatus(ctx, ticketId, toStatus, note, ticketFile) {
  if (!ticketFile) return { error: 'File ticket non valido.' };
  const data = loadTicketFileData(ticketFile);
  if (!data || !Array.isArray(data.tickets)) return { error: 'File ticket non valido.' };
  const existing = data.tickets.find((t) => String(t.id) === String(ticketId));
  if (!existing) return { error: 'Ticket non trovato.' };
  if (!canAccessTicket(ctx, existing)) return { error: 'Permesso negato per questo ticket.' };
  if (!canChangeTicketStatus(ctx, existing)) return { error: 'Permesso negato per cambio stato.' };
  const now = new Date().toISOString();
  const actor = buildRequesterProfile(ctx).fullName;
  return updateTicketInFile(ticketFile, ticketId, (t) => {
    const fromStatus = t.status || '';
    const next = { ...t };
    next.status = toStatus;
    next.updatedAt = now;
    next.lastStatusChangeAt = now;
    if (toStatus === 'Risolto') {
      next.resolvedAt = now;
    }
    if (toStatus === 'Chiuso') {
      next.closedAt = now;
      if (!next.resolvedAt) next.resolvedAt = now;
    }
    next.history = Array.isArray(next.history) ? next.history : [];
    next.history.push({
      event: 'Cambio stato admin',
      fromStatus,
      toStatus,
      actor,
      at: now,
      note: note || '',
    });
    return next;
  });
}

function registerAyPi(bot) {
  function resolveTicketList(ctx) {
    const canAll = canRole(ctx, 'ticket_list_all') || isAdminUser(ctx);
    const canMine = canRole(ctx, 'ticket_list_mine');
    if (!canAll && !canMine) return { error: 'Permesso negato per AyPi Ticket.' };
    const all = sortTicketsDesc(loadAllTickets());
    if (canAll) return { list: all, mode: 'all' };
    const owners = require('../storage').loadOwners();
    const me = owners[String(ctx.chat.id)];
    if (!me) return { error: 'Nome non associato al tuo account.' };
    const mine = filterTicketsForName(all, me);
    return { list: mine, mode: 'mine', ownerName: me };
  }

  function sendTicketList(ctx, page) {
    if (!config.ticketDir && !config.ticketYearsDir) {
      return menu.replyAndRefresh(ctx, 'Percorsi ticket non configurati.');
    }
    const res = resolveTicketList(ctx);
    if (res.error) return menu.replyAndRefresh(ctx, res.error);
    const list = (res.list || []).filter((t) => isRecentClosure(t, 7));
    const totalPages = Math.max(1, Math.ceil(list.length / TICKET_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const start = (safePage - 1) * TICKET_PAGE_SIZE;
    const slice = list.slice(start, start + TICKET_PAGE_SIZE);
    const modeLabel = res.mode === 'all' ? 'Tutti' : 'I miei';
    const body = slice.length ? slice.map(formatTicketLine).join('\n') : 'Nessun ticket trovato.';
    const extra = list.length > slice.length ? `\n\nMostrati ${slice.length} di ${list.length}.` : '';
    state.ticketListStateByChat.set(ctx.chat.id, { page: safePage, mode: res.mode });
    state.lastMenuByChat.set(ctx.chat.id, 'aypi-ticket');
    return menu.sendMenuMessage(ctx, `Lista Ticket (${modeLabel}):\n${body}${extra}`, {
      inline_keyboard: buildTicketListKeyboard(slice, safePage, totalPages),
    });
  }

  function findTicketById(ticketId) {
    const all = loadAllTickets();
    return all.find((t) => String(t.id) === String(ticketId));
  }

  function resetTicketCreateState(chatId) {
    state.pendingTicketCreateByChat.delete(chatId);
  }

  function sendTicketTypeMenu(ctx) {
    const cats = loadTicketCategories();
    if (cats.error) return menu.replyAndRefresh(ctx, cats.error);
    const list = cats.issueTypes || [];
    if (!list.length) return menu.replyAndRefresh(ctx, 'Nessun tipo di intervento disponibile.');
    state.pendingTicketCreateByChat.set(ctx.chat.id, { step: 'type' });
    return menu.sendMenuMessage(ctx, 'Seleziona il tipo di intervento:', {
      inline_keyboard: buildTicketChoiceKeyboard(list, 'aypi:ticket:new:type', 'aypi:ticket'),
    });
  }

  function sendTicketAreaMenu(ctx, pending) {
    const cats = loadTicketCategories();
    if (cats.error) return menu.replyAndRefresh(ctx, cats.error);
    const list = cats.areas || [];
    if (!list.length) return menu.replyAndRefresh(ctx, 'Nessun ambito disponibile.');
    state.pendingTicketCreateByChat.set(ctx.chat.id, { ...pending, step: 'area' });
    return menu.sendMenuMessage(ctx, 'Seleziona l’ambito:', {
      inline_keyboard: buildTicketChoiceKeyboard(list, 'aypi:ticket:new:area', 'aypi:ticket:new:back:type'),
    });
  }

  function sendTicketPriorityMenu(ctx, pending) {
    state.pendingTicketCreateByChat.set(ctx.chat.id, { ...pending, step: 'priority' });
    return menu.sendMenuMessage(ctx, 'Seleziona l’urgenza:', {
      inline_keyboard: buildTicketPriorityKeyboard('aypi:ticket:new:priority', 'aypi:ticket:new:back:area'),
    });
  }

  function sendTicketDescriptionPrompt(ctx, pending) {
    state.pendingTicketCreateByChat.set(ctx.chat.id, { ...pending, step: 'description' });
    return menu.sendMenuMessage(ctx, 'Scrivi il problema e invia il messaggio:', {
      inline_keyboard: [
        [
          { text: 'Indietro', callback_data: 'aypi:ticket:new:back:priority' },
          { text: 'Annulla', callback_data: 'aypi:ticket:new:cancel', style: 'danger' },
        ],
      ],
    });
  }

  bot.command('aypi', (ctx) => {
    logEvent('aypi', ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_aypi')) return menu.replyAndRefresh(ctx, 'Permesso negato per /aypi.');
    return menu.sendAyPiMainMenu(ctx);
  });

  bot.action('aypi:calendar', (ctx) => {
    logEvent('aypi_calendar', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    return menu.sendAyPiCalendarMenu(ctx);
  });

  bot.action('aypi:calendar:open', (ctx) => {
    logEvent('aypi_calendar_open', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const monthKey = getMonthKeyFromDate();
    const highlights = getVisibleDayHighlights(ctx, monthKey);
    return menu.sendAyPiCalendarMonth(ctx, monthKey, highlights);
  });

  bot.action(/aypi:calendar:month:(\d{4}-\d{2})/, (ctx) => {
    const monthKey = ctx.match[1];
    logEvent('aypi_calendar_month', ctx, `month=${monthKey}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const highlights = getVisibleDayHighlights(ctx, monthKey);
    return menu.sendAyPiCalendarMonth(ctx, monthKey, highlights);
  });

  bot.action(/aypi:calendar:jump:(\d{4}-\d{2})/, (ctx) => {
    const monthKey = ctx.match[1];
    logEvent('aypi_calendar_jump_prompt', ctx, `month=${monthKey}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    state.pendingCalendarJumpByChat.set(ctx.chat.id, { monthKey });
    return menu.sendMenuMessage(ctx, 'Scrivi il mese/anno (es. 05/2026):', {
      inline_keyboard: [[{ text: 'Annulla', callback_data: `aypi:calendar:jump:cancel:${monthKey}` }]],
    });
  });

  bot.action(/aypi:calendar:jump:cancel:(\d{4}-\d{2})/, (ctx) => {
    const monthKey = ctx.match[1];
    logEvent('aypi_calendar_jump_cancel', ctx, `month=${monthKey}`);
    safeAnswerCbQuery(ctx);
    state.pendingCalendarJumpByChat.delete(ctx.chat.id);
    const highlights = getVisibleDayHighlights(ctx, monthKey);
    return menu.sendAyPiCalendarMonth(ctx, monthKey, highlights);
  });

  bot.action(/aypi:calendar:day:(\d{4}-\d{2}-\d{2})/, async (ctx) => {
    const dayKey = ctx.match[1];
    logEvent('aypi_calendar_day', ctx, `day=${dayKey}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!config.calendarPendingFile || !fs.existsSync(config.calendarPendingFile)) {
      return menu.replyAndRefresh(ctx, 'File richieste calendario non trovato.');
    }
    try {
      const list = loadCalendarRequests();
      const filters = loadCalendarFilters();
      const admin = isAdminUser(ctx);
      const visible = list.filter((r) => {
        if (!r || typeof r !== 'object') return false;
        const status = String(r.status || '').toLowerCase();
        if (status && status !== 'approved') return false;
        const typeKey = String(r.type || '').toLowerCase().trim();
        if (!admin && filters[typeKey] === true) return false;
        return isOnDate(r, dayKey);
      });
      const lines = visible.map((item) => formatCalendarDayItem(item));
      const body = lines.length ? lines.join('\n') : 'Nessuna richiesta per questo giorno.';
      await safeReply(ctx, body);
      const monthKey = dayKey.slice(0, 7);
      const highlights = getVisibleDayHighlights(ctx, monthKey);
      return menu.sendAyPiCalendarMonth(ctx, monthKey, highlights);
    } catch (err) {
      console.error('Calendar day read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action('aypi:calendar:noop', (ctx) => {
    safeAnswerCbQuery(ctx);
  });

  bot.action('aypi:calendar:pending', (ctx) => {
    logEvent('aypi_calendar_pending', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'calendar_pending')) {
      return menu.replyAndRefresh(ctx, 'Permesso negato per questa funzione.');
    }
    if (!config.calendarPendingFile) {
      return menu.replyAndRefresh(ctx, 'File calendario non configurato.');
    }
    if (!fs.existsSync(config.calendarPendingFile)) {
      return menu.replyAndRefresh(ctx, 'File richieste calendario non trovato.');
    }
    try {
      const list = loadCalendarRequests();
      const pending = list.filter((r) => {
        const status = (r && r.status) || (r && r.Status) || '';
        return String(status).toLowerCase() === 'pending';
      });
      if (pending.length === 0) return menu.replyAndRefresh(ctx, 'Nessuna richiesta in attesa.');
      const lines = pending.map((item) => formatCalendarPending(item));
      const maxLines = 30;
      const trimmed = lines.slice(0, maxLines);
      const body = trimmed.join('\n');
      const extra = lines.length > maxLines ? `\n\nMostrate ${maxLines} di ${lines.length}.` : '';
      const buttons = pending.slice(0, maxLines).map((item) => [
        { text: String(item.id || item.ID || item.Id), callback_data: `aypi:calendar:req:${item.id}` },
      ]);
      buttons.push([
        { text: 'Indietro', callback_data: 'aypi:back' },
        { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
      ]);
      return menu.sendMenuMessage(ctx, `Richieste in attesa:\n${body}${extra}`, {
        inline_keyboard: buttons,
      });
    } catch (err) {
      console.error('Calendar pending read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action('aypi:calendar:mine', (ctx) => {
    logEvent('aypi_calendar_mine', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!config.calendarPendingFile) {
      return menu.replyAndRefresh(ctx, 'File calendario non configurato.');
    }
    if (!fs.existsSync(config.calendarPendingFile)) {
      return menu.replyAndRefresh(ctx, 'File richieste calendario non trovato.');
    }
    try {
      const list = loadCalendarRequests();
      const owners = require('../storage').loadOwners();
      const me = owners[String(ctx.chat.id)];
      if (!me) return menu.replyAndRefresh(ctx, 'Nome non associato al tuo account.');
      const mine = list.filter((r) => {
        const status = String((r && r.status) || '').toLowerCase();
        if (status !== 'approved' && status !== 'rejected' && status !== 'deleted') return false;
        if (String(r.employee || '') !== me) return false;
        return isFuture(r.start);
      });
      if (mine.length === 0) return menu.replyAndRefresh(ctx, 'Nessuna richiesta futura trovata.');
      const lines = mine.map((item) => formatCalendarMine(item));
      const maxLines = 30;
      const trimmed = lines.slice(0, maxLines);
      const body = trimmed.join('\n');
      const extra = lines.length > maxLines ? `\n\nMostrate ${maxLines} di ${lines.length}.` : '';
      return menu.replyAndRefresh(ctx, `Le tue richieste future:\n${body}${extra}`);
    } catch (err) {
      console.error('Calendar mine read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action('aypi:calendar:reqs', (ctx) => {
    logEvent('aypi_calendar_reqs', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!config.calendarPendingFile || !fs.existsSync(config.calendarPendingFile)) {
      return menu.replyAndRefresh(ctx, 'File richieste calendario non trovato.');
    }
    try {
      const list = loadCalendarRequests();
      if (isAdminUser(ctx)) {
        const names = getEmployeeNames(list);
        const rows = buildEmployeePage(names, 0, 10);
        return menu.sendMenuMessage(ctx, 'Seleziona un dipendente:', { inline_keyboard: rows });
      }
      const owners = require('../storage').loadOwners();
      const me = owners[String(ctx.chat.id)];
      if (!me) return menu.replyAndRefresh(ctx, 'Nome non associato al tuo account.');
      const reqState = buildReqsState(ctx.chat.id, me);
      state.calendarReqsStateByChat.set(ctx.chat.id, reqState);
      const mine = filterRequestsByEmployee(list, me, reqState.mode === 'future');
      return renderReqsView(ctx, reqState, mine);
    } catch (err) {
      console.error('Calendar reqs read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action(/aypi:calendar:reqs:pickpage:(-?\d+)/, (ctx) => {
    const offset = Number(ctx.match[1] || 0);
    logEvent('aypi_calendar_reqs_pickpage', ctx, `offset=${offset}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!isAdminUser(ctx)) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    if (!config.calendarPendingFile || !fs.existsSync(config.calendarPendingFile)) {
      return menu.replyAndRefresh(ctx, 'File richieste calendario non trovato.');
    }
    try {
      const list = loadCalendarRequests();
      const names = getEmployeeNames(list);
      const rows = buildEmployeePage(names, offset, 10);
      return menu.sendMenuMessage(ctx, 'Seleziona un dipendente:', { inline_keyboard: rows });
    } catch (err) {
      console.error('Calendar reqs page error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action(/aypi:calendar:reqs:user:(.+)/, (ctx) => {
    const name = decodeRole(ctx.match[1]);
    logEvent('aypi_calendar_reqs_user', ctx, `name=${name}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!isAdminUser(ctx)) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    if (!config.calendarPendingFile || !fs.existsSync(config.calendarPendingFile)) {
      return menu.replyAndRefresh(ctx, 'File richieste calendario non trovato.');
    }
    try {
      const list = loadCalendarRequests();
      const reqState = buildReqsState(ctx.chat.id, name);
      state.calendarReqsStateByChat.set(ctx.chat.id, reqState);
      const mine = filterRequestsByEmployee(list, name, reqState.mode === 'future');
      return renderReqsView(ctx, reqState, mine);
    } catch (err) {
      console.error('Calendar reqs user read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action('aypi:calendar:reqs:mode', (ctx) => {
    logEvent('aypi_calendar_reqs_mode', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const reqState = state.calendarReqsStateByChat.get(ctx.chat.id);
    if (!reqState) return menu.replyAndRefresh(ctx, 'Seleziona prima un dipendente.');
    if (!config.calendarPendingFile || !fs.existsSync(config.calendarPendingFile)) {
      return menu.replyAndRefresh(ctx, 'File richieste calendario non trovato.');
    }
    try {
      const list = loadCalendarRequests();
      reqState.mode = reqState.mode === 'all' ? 'future' : 'all';
      reqState.page = 1;
      state.calendarReqsStateByChat.set(ctx.chat.id, reqState);
      const mine = filterRequestsByEmployee(list, reqState.employee, reqState.mode === 'future');
      return renderReqsView(ctx, reqState, mine);
    } catch (err) {
      console.error('Calendar reqs all read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action(/aypi:calendar:reqs:toggle:(.+)/, (ctx) => {
    const typeKey = String(ctx.match[1] || '').toLowerCase();
    logEvent('aypi_calendar_reqs_toggle', ctx, `type=${typeKey}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const reqState = state.calendarReqsStateByChat.get(ctx.chat.id);
    if (!reqState) return menu.replyAndRefresh(ctx, 'Seleziona prima un dipendente.');
    if (reqState.types.has(typeKey)) reqState.types.delete(typeKey);
    else reqState.types.add(typeKey);
    reqState.page = 1;
    state.calendarReqsStateByChat.set(ctx.chat.id, reqState);
    try {
      const list = loadCalendarRequests();
      const mine = filterRequestsByEmployee(list, reqState.employee, reqState.mode === 'future');
      return renderReqsView(ctx, reqState, mine);
    } catch (err) {
      console.error('Calendar reqs toggle error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action('aypi:calendar:reqs:alltypes', (ctx) => {
    logEvent('aypi_calendar_reqs_alltypes', ctx);
    safeAnswerCbQuery(ctx);
    const reqState = state.calendarReqsStateByChat.get(ctx.chat.id);
    if (!reqState) return menu.replyAndRefresh(ctx, 'Seleziona prima un dipendente.');
    reqState.types = new Set(REQ_TYPES.map((t) => t.key));
    reqState.page = 1;
    state.calendarReqsStateByChat.set(ctx.chat.id, reqState);
    try {
      const list = loadCalendarRequests();
      const mine = filterRequestsByEmployee(list, reqState.employee, reqState.mode === 'future');
      return renderReqsView(ctx, reqState, mine);
    } catch (err) {
      console.error('Calendar reqs alltypes error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action('aypi:calendar:reqs:notypes', (ctx) => {
    logEvent('aypi_calendar_reqs_notypes', ctx);
    safeAnswerCbQuery(ctx);
    const reqState = state.calendarReqsStateByChat.get(ctx.chat.id);
    if (!reqState) return menu.replyAndRefresh(ctx, 'Seleziona prima un dipendente.');
    reqState.types = new Set();
    reqState.page = 1;
    state.calendarReqsStateByChat.set(ctx.chat.id, reqState);
    try {
      const list = loadCalendarRequests();
      const mine = filterRequestsByEmployee(list, reqState.employee, reqState.mode === 'future');
      return renderReqsView(ctx, reqState, mine);
    } catch (err) {
      console.error('Calendar reqs notypes error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action(/aypi:calendar:reqs:page:(\d+)/, (ctx) => {
    const page = Number(ctx.match[1]);
    logEvent('aypi_calendar_reqs_page_items', ctx, `page=${page}`);
    safeAnswerCbQuery(ctx);
    const reqState = state.calendarReqsStateByChat.get(ctx.chat.id);
    if (!reqState) return menu.replyAndRefresh(ctx, 'Seleziona prima un dipendente.');
    reqState.page = page;
    state.calendarReqsStateByChat.set(ctx.chat.id, reqState);
    try {
      const list = loadCalendarRequests();
      const mine = filterRequestsByEmployee(list, reqState.employee, reqState.mode === 'future');
      return renderReqsView(ctx, reqState, mine);
    } catch (err) {
      console.error('Calendar reqs page items error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action('aypi:calendar:balances', (ctx) => {
    logEvent('aypi_calendar_balances', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!config.calendarBalancesFile || !fs.existsSync(config.calendarBalancesFile)) {
      return menu.replyAndRefresh(ctx, 'File ferie/permessi non trovato.');
    }
    try {
      const raw = fs.readFileSync(config.calendarBalancesFile, 'utf8');
      const data = JSON.parse(raw);
      const entries = Object.values(data || {}).filter((v) => v && typeof v === 'object');
      if (!entries.length) return menu.replyAndRefresh(ctx, 'Nessun dato disponibile.');
      const owners = require('../storage').loadOwners();
      const me = owners[String(ctx.chat.id)];
      const admin = isAdminUser(ctx);
      const filtered = admin
        ? entries
        : entries.filter((item) => String(item.employee || '') === String(me || ''));
      if (!admin && !me) {
        return menu.replyAndRefresh(ctx, 'Nome non associato al tuo account.');
      }
      if (!filtered.length) return menu.replyAndRefresh(ctx, 'Nessun dato disponibile.');
      const lines = filtered
        .map((item) => {
          const name = item.employee || 'Sconosciuto';
          const hours = item.hoursAvailable ?? 0;
          return `${name}: ${hours}`;
        })
        .sort((a, b) => a.localeCompare(b));
      const maxLines = 50;
      const body = lines.slice(0, maxLines).join('\n');
      const extra = lines.length > maxLines ? `\n\nMostrate ${maxLines} di ${lines.length}.` : '';
      return menu.replyAndRefresh(ctx, `Ore residue:\n${body}${extra}`);
    } catch (err) {
      console.error('Calendar balances read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle ore.');
    }
  });

  bot.action('aypi:calendar:closures', (ctx) => {
    logEvent('aypi_calendar_closures', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const existing = state.calendarClosuresFiltersByChat.get(ctx.chat.id);
    const filters = existing || { closures: true, holidays: true };
    state.calendarClosuresFiltersByChat.set(ctx.chat.id, filters);
    return menu.sendMenuMessage(ctx, 'Seleziona cosa mostrare:', {
      inline_keyboard: [
        [
          {
            text: 'Chiusure Aziendali',
            callback_data: 'aypi:calendar:closures:toggle:closures',
            style: filters.closures ? 'success' : 'primary',
          },
          {
            text: 'Festività',
            callback_data: 'aypi:calendar:closures:toggle:holidays',
            style: filters.holidays ? 'success' : 'primary',
          },
        ],
        [
          { text: 'Mostra', callback_data: 'aypi:calendar:closures:show' },
          { text: 'Indietro', callback_data: 'aypi:calendar', style: 'danger' },
        ],
      ],
    });
  });

  bot.action(/aypi:calendar:closures:toggle:(closures|holidays)/, (ctx) => {
    const key = ctx.match[1];
    logEvent('aypi_calendar_closures_toggle', ctx, `key=${key}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const filters = state.calendarClosuresFiltersByChat.get(ctx.chat.id) || {
      closures: true,
      holidays: true,
    };
    filters[key] = !filters[key];
    state.calendarClosuresFiltersByChat.set(ctx.chat.id, filters);
    return menu.sendMenuMessage(ctx, 'Seleziona cosa mostrare:', {
      inline_keyboard: [
        [
          {
            text: 'Chiusure Aziendali',
            callback_data: 'aypi:calendar:closures:toggle:closures',
            style: filters.closures ? 'success' : 'primary',
          },
          {
            text: 'Festività',
            callback_data: 'aypi:calendar:closures:toggle:holidays',
            style: filters.holidays ? 'success' : 'primary',
          },
        ],
        [
          { text: 'Mostra', callback_data: 'aypi:calendar:closures:show' },
          { text: 'Indietro', callback_data: 'aypi:calendar', style: 'danger' },
        ],
      ],
    });
  });

  bot.action('aypi:calendar:closures:show', (ctx) => {
    logEvent('aypi_calendar_closures_show', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const filters = state.calendarClosuresFiltersByChat.get(ctx.chat.id) || {
      closures: true,
      holidays: true,
    };
    const items = [];
    if (filters.closures) {
      const closures = loadCalendarExtra(config.calendarClosuresFile).filter((item) => {
        const start = item.start || item.from || item.date || item.day;
        const end = item.end || item.to || start;
        return isFutureOrToday(end || start);
      });
      closures.forEach((c) =>
        items.push({
          text: `Chiusura - ${formatExtraItem(c)}`,
          sort: toDateOnly(c.start || c.from || c.date || c.day || ''),
        })
      );
    }
    if (filters.holidays) {
      const holidays = loadCalendarExtra(config.calendarHolidaysFile).filter((item) => {
        const start = item.start || item.from || item.date || item.day;
        const end = item.end || item.to || start;
        return isFutureOrToday(end || start);
      });
      holidays.forEach((h) =>
        items.push({
          text: `Festività - ${formatExtraItem(h)}`,
          sort: toDateOnly(h.start || h.from || h.date || h.day || ''),
        })
      );
    }
    items.sort((a, b) => String(a.sort || '').localeCompare(String(b.sort || '')));
    const body = items.length ? items.map((i) => i.text).join('\n') : 'Nessuna chiusura o festività futura.';
    return menu.replyAndRefresh(ctx, body);
  });

  bot.action(/aypi:calendar:req:(.+)/, (ctx) => {
    const reqId = ctx.match[1];
    logEvent('aypi_calendar_req', ctx, `id=${reqId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'calendar_pending')) {
      return menu.replyAndRefresh(ctx, 'Permesso negato per questa funzione.');
    }
    try {
      const list = loadCalendarRequests();
      const target = list.find((r) => String(r.id) === String(reqId));
      if (!target) return menu.replyAndRefresh(ctx, 'Richiesta non trovata.');
      const detail = formatCalendarPending(target);
      return menu.sendMenuMessage(ctx, `Dettaglio richiesta:\n${detail}`, {
        inline_keyboard: [
          [
            { text: 'Approva', callback_data: `aypi:calendar:approve:${reqId}`, style: 'success' },
            { text: 'Rifiuta', callback_data: `aypi:calendar:reject:${reqId}`, style: 'danger' },
          ],
          [
            { text: 'Indietro', callback_data: 'aypi:calendar:pending' },
            { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
          ],
        ],
      });
    } catch (err) {
      console.error('Calendar pending read error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura delle richieste calendario.');
    }
  });

  bot.action(/aypi:calendar:approve:(.+)/, (ctx) => {
    const reqId = ctx.match[1];
    logEvent('aypi_calendar_approve', ctx, `id=${reqId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'calendar_pending')) {
      return menu.replyAndRefresh(ctx, 'Permesso negato per questa funzione.');
    }
    try {
      const list = loadCalendarRequests();
      const target = list.find((r) => String(r.id) === String(reqId));
      if (!target) return menu.replyAndRefresh(ctx, 'Richiesta non trovata.');
      const now = new Date().toISOString();
      const by = getApproverName(ctx);
      target.status = 'approved';
      target.approvedAt = now;
      target.approvedBy = by;
      target.modifiedAt = now;
      target.modifiedBy = by;
      delete target.balanceHours;
      delete target.balanceAppliedAt;
      delete target.rejectedAt;
      delete target.rejectedBy;
      delete target.updatedAt;
      saveCalendarRequests(list);
      return menu.replyAndRefresh(ctx, `Richiesta approvata: ${reqId}`);
    } catch (err) {
      console.error('Calendar approve error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore durante l\'approvazione.');
    }
  });

  bot.action(/aypi:calendar:reject:(.+)/, (ctx) => {
    const reqId = ctx.match[1];
    logEvent('aypi_calendar_reject', ctx, `id=${reqId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'calendar_pending')) {
      return menu.replyAndRefresh(ctx, 'Permesso negato per questa funzione.');
    }
    try {
      const list = loadCalendarRequests();
      const target = list.find((r) => String(r.id) === String(reqId));
      if (!target) return menu.replyAndRefresh(ctx, 'Richiesta non trovata.');
      const now = new Date().toISOString();
      const by = getApproverName(ctx);
      target.status = 'rejected';
      target.rejectedAt = now;
      target.rejectedBy = by;
      target.updatedAt = now;
      saveCalendarRequests(list);
      return menu.replyAndRefresh(ctx, `Richiesta rifiutata: ${reqId}`);
    } catch (err) {
      console.error('Calendar reject error:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore durante il rifiuto.');
    }
  });

  bot.action('aypi:purchasing', (ctx) => {
    logEvent('aypi_purchasing', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    state.lastMenuByChat.set(ctx.chat.id, 'aypi-main');
    return menu.sendMenuMessage(ctx, 'AyPi Purchasing: in arrivo.', {
      inline_keyboard: [[{ text: 'Indietro', callback_data: 'aypi:back' }]],
    });
  });

    bot.action('aypi:ticket', (ctx) => {
    logEvent('aypi_ticket', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    return menu.sendAyPiTicketMenu(ctx);
  });

  bot.action('aypi:ticket:noop', (ctx) => {
    safeAnswerCbQuery(ctx);
  });

  bot.action('aypi:ticket:list', (ctx) => {
    logEvent('aypi_ticket_list', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    return sendTicketList(ctx, 1);
  });

  bot.action('aypi:ticket:new', (ctx) => {
    logEvent('aypi_ticket_new', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    resetTicketCreateState(ctx.chat.id);
    return sendTicketTypeMenu(ctx);
  });

  bot.action(/aypi:ticket:new:type:(.+)/, (ctx) => {
    const issueType = decodeRole(ctx.match[1]);
    logEvent('aypi_ticket_new_type', ctx, `type=${issueType}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    const pending = state.pendingTicketCreateByChat.get(ctx.chat.id) || {};
    return sendTicketAreaMenu(ctx, { ...pending, issueType });
  });

  bot.action(/aypi:ticket:new:area:(.+)/, (ctx) => {
    const area = decodeRole(ctx.match[1]);
    logEvent('aypi_ticket_new_area', ctx, `area=${area}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    const pending = state.pendingTicketCreateByChat.get(ctx.chat.id) || {};
    return sendTicketPriorityMenu(ctx, { ...pending, area });
  });

  bot.action(/aypi:ticket:new:priority:(.+)/, (ctx) => {
    const priority = decodeRole(ctx.match[1]);
    logEvent('aypi_ticket_new_priority', ctx, `priority=${priority}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    const pending = state.pendingTicketCreateByChat.get(ctx.chat.id) || {};
    return sendTicketDescriptionPrompt(ctx, { ...pending, priority });
  });

  bot.action(/aypi:ticket:new:back:(.+)/, (ctx) => {
    const target = ctx.match[1];
    logEvent('aypi_ticket_new_back', ctx, `to=${target}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    const pending = state.pendingTicketCreateByChat.get(ctx.chat.id) || {};
    if (target === 'type') return sendTicketTypeMenu(ctx);
    if (target === 'area') return sendTicketAreaMenu(ctx, pending);
    if (target === 'priority') return sendTicketPriorityMenu(ctx, pending);
    return menu.sendAyPiTicketMenu(ctx);
  });

  bot.action('aypi:ticket:new:cancel', (ctx) => {
    logEvent('aypi_ticket_new_cancel', ctx);
    safeAnswerCbQuery(ctx);
    resetTicketCreateState(ctx.chat.id);
    return menu.sendAyPiTicketMenu(ctx);
  });

  bot.action(/aypi:ticket:edit:(.+)/, (ctx) => {
    const ticketId = ctx.match[1];
    logEvent('aypi_ticket_edit', ctx, `id=${ticketId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canAccessTicket(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per questo ticket.');
    if (!canEditTicket(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per la modifica.');
    state.pendingTicketEditByChat.set(ctx.chat.id, { ticketId, step: 'field' });
    return menu.sendMenuMessage(ctx, 'Cosa vuoi modificare?', {
      inline_keyboard: [
        [
          { text: 'Categoria', callback_data: `aypi:ticket:edit:field:issueType:${ticketId}` },
          { text: 'Argomento', callback_data: `aypi:ticket:edit:field:area:${ticketId}` },
        ],
        [
          { text: 'Urgenza', callback_data: `aypi:ticket:edit:field:priority:${ticketId}` },
          { text: 'Descrizione', callback_data: `aypi:ticket:edit:field:description:${ticketId}` },
        ],
        [
          { text: 'Indietro', callback_data: `aypi:ticket:detail:${ticketId}` },
          { text: 'Annulla', callback_data: 'aypi:ticket:edit:cancel', style: 'danger' },
          { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
        ],
      ],
    });
  });

  bot.action(/aypi:ticket:edit:field:(issueType|area|priority|description):(.+)/, (ctx) => {
    const field = ctx.match[1];
    const ticketId = ctx.match[2];
    logEvent('aypi_ticket_edit_field', ctx, `id=${ticketId} field=${field}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canEditTicket(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per la modifica.');
    state.pendingTicketEditByChat.set(ctx.chat.id, { ticketId, field, step: 'value', ticketFile: ticket.__file });
    if (field === 'description') {
      return menu.sendMenuMessage(ctx, 'Scrivi la nuova descrizione e invia il messaggio:', {
        inline_keyboard: [
          [
            { text: 'Indietro', callback_data: `aypi:ticket:edit:${ticketId}` },
            { text: 'Annulla', callback_data: 'aypi:ticket:edit:cancel', style: 'danger' },
            { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
          ],
        ],
      });
    }
    if (field === 'priority') {
      return menu.sendMenuMessage(ctx, 'Seleziona la nuova urgenza:', {
        inline_keyboard: buildTicketPriorityKeyboard(
          `aypi:ticket:edit:value:priority:${ticketId}`,
          `aypi:ticket:edit:${ticketId}`
        ),
      });
    }
    const cats = loadTicketCategories();
    if (cats.error) return menu.replyAndRefresh(ctx, cats.error);
    const list = field === 'issueType' ? cats.issueTypes : cats.areas;
    if (!list || !list.length) return menu.replyAndRefresh(ctx, 'Nessun valore disponibile.');
    const prefix = `aypi:ticket:edit:value:${field}:${ticketId}`;
    return menu.sendMenuMessage(ctx, field === 'issueType' ? 'Seleziona la nuova categoria:' : 'Seleziona il nuovo argomento:', {
      inline_keyboard: buildTicketChoiceKeyboard(list, prefix, `aypi:ticket:edit:${ticketId}`),
    });
  });

  bot.action(/aypi:ticket:edit:value:(issueType|area|priority):(.+?):(.+)/, (ctx) => {
    const field = ctx.match[1];
    const ticketId = ctx.match[2];
    const value = decodeRole(ctx.match[3]);
    logEvent('aypi_ticket_edit_value', ctx, `id=${ticketId} field=${field}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canEditTicket(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per la modifica.');
    if (!ticket.__file) return menu.replyAndRefresh(ctx, 'File ticket non valido.');
    const fieldLabel = field === 'issueType' ? 'Categoria' : field === 'area' ? 'Argomento' : 'Urgenza';
    const now = new Date().toISOString();
    const actor = buildRequesterProfile(ctx).fullName;
    const event = isAdminUser(ctx) ? 'Modifica admin' : 'Modifica dipendente';
    const res = updateTicketInFile(ticket.__file, ticketId, (t) => {
      const next = { ...t };
      const oldVal = next[field] || '';
      next[field] = value;
      next.updatedAt = now;
      next.history = Array.isArray(next.history) ? next.history : [];
      next.history.push({
        event,
        actor,
        at: now,
        note: `Modifiche: ${fieldLabel}: "${oldVal}" -> "${value}"`,
      });
      return next;
    });
    state.pendingTicketEditByChat.delete(ctx.chat.id);
    if (res.error) return menu.replyAndRefresh(ctx, res.error);
    return menu.replyAndRefresh(ctx, `Ticket aggiornato: ${ticketId}`);
  });

  bot.action('aypi:ticket:edit:cancel', (ctx) => {
    logEvent('aypi_ticket_edit_cancel', ctx);
    safeAnswerCbQuery(ctx);
    state.pendingTicketEditByChat.delete(ctx.chat.id);
    return menu.sendAyPiTicketMenu(ctx);
  });

  bot.action(/aypi:ticket:status:(.+)/, (ctx) => {
    const ticketId = ctx.match[1];
    logEvent('aypi_ticket_status', ctx, `id=${ticketId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canChangeTicketStatus(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per cambio stato.');
    state.pendingTicketStatusByChat.set(ctx.chat.id, { ticketId, step: 'pick', ticketFile: ticket.__file });
    const statuses = ['Da prendere in carico', 'Presa in carico', 'In Attesa', 'Risolto', 'Chiuso'];
    const rows = statuses.map((s) => [
      { text: s, callback_data: `ats:pick:${encodeRole(s)}` },
    ]);
    rows.push([
      { text: 'Indietro', callback_data: `aypi:ticket:detail:${ticketId}` },
      { text: 'Annulla', callback_data: 'ats:cancel', style: 'danger' },
      { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
    ]);
    return menu.sendMenuMessage(ctx, 'Seleziona il nuovo stato:', {
      inline_keyboard: rows,
    });
  });

  bot.action(/ats:pick:(.+)/, (ctx) => {
    const toStatus = decodeRole(ctx.match[1]);
    const pending = state.pendingTicketStatusByChat.get(ctx.chat.id);
    const ticketId = pending && pending.ticketId;
    logEvent('aypi_ticket_status_pick', ctx, `id=${ticketId} status=${toStatus}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!ticketId) return menu.replyAndRefresh(ctx, 'Sessione cambio stato non valida.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canChangeTicketStatus(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per cambio stato.');
    state.pendingTicketStatusByChat.set(ctx.chat.id, { ticketId, step: 'note', toStatus, ticketFile: ticket.__file });
    return menu.sendMenuMessage(ctx, 'Scrivi una nota e invia il messaggio:', {
      inline_keyboard: [
        [
          { text: 'Indietro', callback_data: 'ats:menu' },
          { text: 'Annulla', callback_data: 'ats:cancel', style: 'danger' },
          { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
        ],
      ],
    });
  });

  bot.action('ats:cancel', (ctx) => {
    logEvent('aypi_ticket_status_cancel', ctx);
    safeAnswerCbQuery(ctx);
    state.pendingTicketStatusByChat.delete(ctx.chat.id);
    return menu.sendAyPiTicketMenu(ctx);
  });

  bot.action('ats:menu', (ctx) => {
    const pending = state.pendingTicketStatusByChat.get(ctx.chat.id);
    const ticketId = pending && pending.ticketId;
    logEvent('aypi_ticket_status_menu', ctx, `id=${ticketId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!ticketId) return menu.replyAndRefresh(ctx, 'Sessione cambio stato non valida.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canChangeTicketStatus(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per cambio stato.');
    const statuses = ['Da prendere in carico', 'Presa in carico', 'In Attesa', 'Risolto', 'Chiuso'];
    const rows = statuses.map((s) => [
      { text: s, callback_data: `ats:pick:${encodeRole(s)}` },
    ]);
    rows.push([
      { text: 'Indietro', callback_data: `aypi:ticket:detail:${ticketId}` },
      { text: 'Annulla', callback_data: 'ats:cancel', style: 'danger' },
      { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
    ]);
    return menu.sendMenuMessage(ctx, 'Seleziona il nuovo stato:', { inline_keyboard: rows });
  });

  bot.action(/aypi:ticket:delete:(.+)/, (ctx) => {
    const ticketId = ctx.match[1];
    logEvent('aypi_ticket_delete', ctx, `id=${ticketId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canDeleteTicket(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per eliminazione.');
    state.pendingTicketDeleteByChat.set(ctx.chat.id, { ticketId });
    return menu.sendMenuMessage(ctx, 'Confermi eliminazione ticket?', {
      inline_keyboard: [
        [
          { text: 'Elimina', callback_data: `aypi:ticket:delete:confirm:${ticketId}`, style: 'danger' },
          { text: 'Annulla', callback_data: 'aypi:ticket:delete:cancel' },
          { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
        ],
        [{ text: 'Indietro', callback_data: `aypi:ticket:detail:${ticketId}` }],
      ],
    });
  });

  bot.action(/aypi:ticket:delete:confirm:(.+)/, (ctx) => {
    const ticketId = ctx.match[1];
    logEvent('aypi_ticket_delete_confirm', ctx, `id=${ticketId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canDeleteTicket(ctx, ticket)) return menu.replyAndRefresh(ctx, 'Permesso negato per eliminazione.');
    if (!ticket.__file) return menu.replyAndRefresh(ctx, 'File ticket non valido.');
    const res = deleteTicketInFile(ticket.__file, ticketId);
    state.pendingTicketDeleteByChat.delete(ctx.chat.id);
    if (res.error) return menu.replyAndRefresh(ctx, res.error);
    return menu.replyAndRefresh(ctx, `Ticket eliminato: ${ticketId}`);
  });

  bot.action('aypi:ticket:delete:cancel', (ctx) => {
    logEvent('aypi_ticket_delete_cancel', ctx);
    safeAnswerCbQuery(ctx);
    state.pendingTicketDeleteByChat.delete(ctx.chat.id);
    return menu.sendAyPiTicketMenu(ctx);
  });

  bot.action(/aypi:ticket:list:page:(\d+)/, (ctx) => {
    const page = Number(ctx.match[1]);
    logEvent('aypi_ticket_list_page', ctx, `page=${page}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    return sendTicketList(ctx, page);
  });

  bot.action(/aypi:ticket:detail:(.+)/, (ctx) => {
    const ticketId = ctx.match[1];
    logEvent('aypi_ticket_detail', ctx, `id=${ticketId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ticket')) return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
    if (!canRole(ctx, 'ticket_view_history')) {
      return menu.replyAndRefresh(ctx, 'Permesso negato per lo storico ticket.');
    }
    const ticket = findTicketById(ticketId);
    if (!ticket) return menu.replyAndRefresh(ctx, 'Ticket non trovato.');
    if (!canAccessTicket(ctx, ticket)) {
      return menu.replyAndRefresh(ctx, 'Permesso negato per questo ticket.');
    }
    const requesterName = getRequesterName(ticket) || 'Sconosciuto';
    const requesterEmail = getRequesterEmail(ticket);
    const header = [
      `Ticket ${ticket.id || ''}`,
      `Stato: ${ticket.status || ''}`,
      `Richiedente: ${requesterName}${requesterEmail ? ` (${requesterEmail})` : ''}`,
      `Tipo: ${ticket.issueType || ''}`,
      `Area: ${ticket.area || ''}`,
      `Priorita: ${ticket.priority || ''}`,
      `Descrizione: ${ticket.description || ''}`,
      `Creato: ${formatTicketDate(ticket.createdAt || '')}`,
      `Aggiornato: ${formatTicketDate(ticket.updatedAt || '')}`,
    ].join('\n');
    const history = formatTicketHistory(ticket);
    const backState = state.ticketListStateByChat.get(ctx.chat.id);
    const backCb = backState && backState.page ? `aypi:ticket:list:page:${backState.page}` : 'aypi:ticket:list';
    const rows = [];
    if (canEditTicket(ctx, ticket)) rows.push([{ text: 'Modifica', callback_data: `aypi:ticket:edit:${ticket.id}` }]);
    if (canChangeTicketStatus(ctx, ticket)) rows.push([{ text: 'Cambia stato', callback_data: `aypi:ticket:status:${ticket.id}` }]);
    if (canDeleteTicket(ctx, ticket)) rows.push([{ text: 'Elimina', callback_data: `aypi:ticket:delete:${ticket.id}`, style: 'danger' }]);
    rows.push([
      { text: 'Indietro', callback_data: backCb },
      { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
    ]);
    return menu.sendMenuMessage(ctx, `${header}\n\nStorico:\n${history}`, {
      inline_keyboard: rows,
    });
  });

  bot.action('aypi:back', (ctx) => {
    logEvent('aypi_back', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    return menu.sendAyPiMainMenu(ctx);
  });

  bot.action('aypi:exit', (ctx) => {
    logEvent('aypi_exit', ctx);
    safeAnswerCbQuery(ctx);
    const chatId = ctx.chat.id;
    state.lastMenuByChat.delete(chatId);
    state.menuMessageByChat.delete(chatId);
    return safeDelete(ctx);
  });
}

module.exports = registerAyPi;
module.exports.getVisibleDayHighlights = getVisibleDayHighlights;
module.exports.createTicketFromPending = createTicketFromPending;
module.exports.updateTicketDescription = updateTicketDescription;
module.exports.updateTicketStatus = updateTicketStatus;









