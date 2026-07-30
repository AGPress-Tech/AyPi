const fs = require('fs');
const path = require('path');
const config = require('../config');

const REQUEST_TIMEOUT_MS = Number(process.env.AYPI_BOT_BACKEND_TIMEOUT_MS || 10000);
let syncQueue = Promise.resolve();

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  ensureParent(filePath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function api(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.backendBaseUrl}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-aypi-user': 'AyPi Telegram Bot',
        'x-aypi-client': 'telegram-bot',
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`AyPi Backend ${response.status}: ${pathname}`);
    }
    return response.status === 204 ? null : response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function requestYear(request) {
  const candidate = request?.start || request?.createdAt || request?.updatedAt || '';
  const match = /^(\d{4})/.exec(String(candidate));
  return match ? match[1] : String(new Date().getFullYear());
}

function ticketYear(ticket) {
  const parsed = new Date(ticket?.createdAt || '');
  return Number.isFinite(parsed.getTime())
    ? String(parsed.getFullYear())
    : String(new Date().getFullYear());
}

function calendarYearsDir() {
  return path.dirname(config.calendarPendingFile);
}

function writeCalendarCache(payload) {
  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const grouped = new Map();
  requests.forEach((request) => {
    const year = requestYear(request);
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(request);
  });
  const currentYear = String(new Date().getFullYear());
  if (!grouped.has(currentYear)) grouped.set(currentYear, []);
  if (fs.existsSync(calendarYearsDir())) {
    fs.readdirSync(calendarYearsDir())
      .filter((name) => /^requests-\d{4}\.json$/i.test(name))
      .forEach((name) => {
        const year = name.match(/\d{4}/)?.[0];
        if (year && !grouped.has(year)) grouped.set(year, []);
      });
  }
  grouped.forEach((items, year) => {
    writeJson(path.join(calendarYearsDir(), `requests-${year}.json`), items);
  });
  writeJson(config.calendarBalancesFile, payload?.balances || {});
  writeJson(config.calendarClosuresFile, payload?.closures || []);
  writeJson(config.calendarHolidaysFile, payload?.holidays || []);
}

function writeTicketCache(store, categories) {
  const tickets = Array.isArray(store?.tickets) ? store.tickets : [];
  const grouped = new Map();
  tickets.forEach((ticket) => {
    const year = ticketYear(ticket);
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(ticket);
  });
  const currentYear = String(new Date().getFullYear());
  if (!grouped.has(currentYear)) grouped.set(currentYear, []);
  if (fs.existsSync(config.ticketYearsDir)) {
    fs.readdirSync(config.ticketYearsDir)
      .filter((name) => /^ticket-\d{4}\.json$/i.test(name))
      .forEach((name) => {
        const year = name.match(/\d{4}/)?.[0];
        if (year && !grouped.has(year)) grouped.set(year, []);
      });
  }
  grouped.forEach((items, year) => {
    writeJson(path.join(config.ticketYearsDir, `ticket-${year}.json`), {
      version: Number(store?.version) || 1,
      year: Number(year),
      tickets: items,
    });
  });
  writeJson(config.ticketCategoriesPath, categories || {
    version: 1,
    issueTypes: [],
    areas: [],
  });
}

function readAllCalendarRequests() {
  if (!fs.existsSync(calendarYearsDir())) return [];
  return fs
    .readdirSync(calendarYearsDir())
    .filter((name) => /^requests-\d{4}\.json$/i.test(name))
    .flatMap((name) => {
      const data = readJson(path.join(calendarYearsDir(), name), []);
      return Array.isArray(data) ? data : data?.requests || [];
    });
}

function readAllTickets() {
  if (!fs.existsSync(config.ticketYearsDir)) return [];
  return fs
    .readdirSync(config.ticketYearsDir)
    .filter((name) => /^ticket-\d{4}\.json$/i.test(name))
    .flatMap((name) => {
      const data = readJson(path.join(config.ticketYearsDir, name), {});
      return Array.isArray(data?.tickets) ? data.tickets : [];
    });
}

function stable(value) {
  return JSON.stringify(value);
}

async function pullBackendState() {
  const [calendar, tickets, categories, assignees, accessConfig] = await Promise.all([
    api('/api/ferie-permessi/payload'),
    api('/api/ticket-support/store'),
    api('/api/ticket-support/categories'),
    api('/api/shared/assignees'),
    api('/api/shared/calendar-access-config').catch(() => null),
  ]);
  writeCalendarCache(calendar);
  writeTicketCache(tickets, categories);
  writeJson(config.assigneesFile, assignees || { groups: {}, options: [], emails: {} });
  if (accessConfig) {
    writeJson(config.calendarConfigFile, {
      filters: accessConfig?.operations?.filters || {},
    });
  }
  return {
    calendar,
    tickets,
    calendarRequests: readAllCalendarRequests(),
    ticketItems: readAllTickets(),
  };
}

async function pushCalendarChanges(beforeRequests) {
  const afterRequests = readAllCalendarRequests();
  const beforeById = new Map(
    (beforeRequests || []).map((item) => [String(item?.id || ''), item]),
  );
  for (const next of afterRequests) {
    const id = String(next?.id || '');
    if (!id) continue;
    const previous = beforeById.get(id);
    if (!previous || stable(previous) === stable(next)) continue;
    const previousStatus = String(previous.status || '').toLowerCase();
    const nextStatus = String(next.status || '').toLowerCase();
    if (nextStatus === 'approved' && previousStatus !== 'approved') {
      await api(`/api/ferie-permessi/requests/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        body: JSON.stringify({ actor: next.approvedBy || 'AyPi Telegram Bot' }),
      });
      continue;
    }
    if (nextStatus === 'rejected' && previousStatus !== 'rejected') {
      await api(`/api/ferie-permessi/requests/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ actor: next.rejectedBy || 'AyPi Telegram Bot' }),
      });
      continue;
    }
    await api(`/api/ferie-permessi/requests/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(next),
    });
  }
}

async function pushTicketChanges(beforeStore, beforeTickets) {
  const afterTickets = readAllTickets();
  if (stable(beforeTickets || []) === stable(afterTickets)) return;
  await api('/api/ticket-support/store', {
    method: 'PUT',
    body: JSON.stringify({
      version: Number(beforeStore?.version) || 1,
      tickets: afterTickets,
    }),
  });
}

async function runSynchronizedUpdate(ctx, next) {
  let snapshot = null;
  try {
    snapshot = await pullBackendState();
  } catch (error) {
    console.warn('[telegram-bot] Backend sync pull failed:', error.message);
  }
  const result = await next();
  if (!snapshot) return result;
  try {
    await pushCalendarChanges(snapshot.calendarRequests);
    await pushTicketChanges(snapshot.tickets, snapshot.ticketItems);
  } catch (error) {
    console.error('[telegram-bot] Backend sync push failed:', error.message);
    try {
      await ctx.reply('⚠️ Operazione eseguita nel bot, ma la sincronizzazione con AyPi Backend non è riuscita.');
    } catch {
      // ignore Telegram notification failures
    }
  }
  return result;
}

function backendSyncMiddleware(ctx, next) {
  const task = syncQueue.then(() => runSynchronizedUpdate(ctx, next));
  syncQueue = task.catch(() => {});
  return task;
}

module.exports = {
  backendSyncMiddleware,
  pullBackendState,
};
