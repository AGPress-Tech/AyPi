const config = require('../config');
const storage = require('../storage');
const state = require('../state');
const { logEvent } = require('../utils/log');
const { safeReply, safeDelete } = require('../utils/telegram');
const { canRole, isAuthorized, isOwnerUser } = require('../utils/auth');
const menu = require('../menu');
const { Markup } = require('telegraf');
const { botMessagesByChat, lastMenuByChat, menuMessageByChat, topAbsencesByChat } = require('../state');
const fs = require('fs');
const https = require('https');
const QRCode = require('qrcode');

function httpsGetJson(url, opts = {}) {
  const { timeoutMs = 8000, insecureTls = false, label = 'https' } = opts;
  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': 'AyPiBotTG/1.0' },
        agent: new https.Agent({ rejectUnauthorized: !insecureTls }),
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            console.warn(`[${label}] http ${res.statusCode}`);
            return resolve(null);
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            console.warn(`[${label}] invalid json`);
            resolve(null);
          }
        });
      }
    );
    req.on('error', (err) => {
      console.warn(`[${label}] error: ${err.code || err.message}`);
      resolve(null);
    });
    req.setTimeout(timeoutMs, () => {
      console.warn(`[${label}] timeout after ${timeoutMs}ms`);
      req.destroy();
      resolve(null);
    });
    req.end();
  });
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
  const start = toDateOnly(item.start || item.from || item.date || item.day);
  const end = toDateOnly(item.end || item.to || item.date || item.day || item.start || item.from);
  if (!start) return false;
  const d = dateObj(dateStr);
  const s = dateObj(start);
  const e = dateObj(end || start);
  if (!d || !s || !e) return false;
  return d.getTime() >= s.getTime() && d.getTime() <= e.getTime();
}

function parseDateTime(value) {
  if (!value) return { date: '', time: '' };
  if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
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

function getExtraName(item) {
  return (
    item.name ||
    item.title ||
    item.label ||
    item.event ||
    item.reason ||
    item.tipo ||
    'Evento'
  );
}

function loadCalendarExtra(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    return [];
  } catch {
    return [];
  }
}

function loadCalendarRequestsAllYears() {
  const path = require('path');
  if (!config.calendarPendingFile) return [];
  const baseDir = path.dirname(config.calendarPendingFile);
  const baseName = path.basename(config.calendarPendingFile);
  const files = [];
  if (fs.existsSync(config.calendarPendingFile)) files.push(config.calendarPendingFile);
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
    } catch {
      // ignore
    }
  }
  return all;
}

function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=Europe/Rome`;
  return httpsGetJson(url, { insecureTls: config.weatherAllowInsecureTls, label: 'weather' });
}

function overlapPeriod(startStr, endStr, periodStart, periodEnd) {
  const s = dateObj(toDateOnly(startStr));
  const e = dateObj(toDateOnly(endStr || startStr));
  if (!s || !e) return false;
  return e.getTime() >= periodStart.getTime() && s.getTime() <= periodEnd.getTime();
}

function getMonthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatMonthLabel(date = new Date()) {
  const month = new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(date);
  const year = date.getFullYear();
  const capMonth = month.replace(/\b\p{L}/u, (m) => m.toUpperCase());
  return `${capMonth} ${year}`;
}

function formatDateLabel(isoDate) {
  if (!isoDate) return '--/--/----';
  const d = dateObj(isoDate);
  if (!d) return '--/--/----';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function buildTopAbsencesKeyboard(state) {
  return {
    inline_keyboard: [
      [
        { text: `Da: ${formatDateLabel(state.startDate)}`, callback_data: 'topabs:set:start' },
        { text: `A: ${formatDateLabel(state.endDate)}`, callback_data: 'topabs:set:end' },
      ],
      [
        {
          text: 'Ferie/Permessi',
          callback_data: 'topabs:toggle:feriep',
          style: state.feriep ? 'success' : 'primary',
        },
        {
          text: 'Mutua',
          callback_data: 'topabs:toggle:mutua',
          style: state.mutua ? 'success' : 'primary',
        },
      ],
      [
        { text: 'Mostra', callback_data: 'topabs:show' },
        { text: 'Annulla', callback_data: 'topabs:cancel', style: 'danger' },
      ],
    ],
  };
}

function sendTopAbsMenu(ctx, state) {
  lastMenuByChat.set(ctx.chat.id, 'topabs');
  return menu.sendMenuMessage(ctx, 'Seleziona i filtri:', { inline_keyboard: buildTopAbsencesKeyboard(state).inline_keyboard });
}

function weatherEmoji(code) {
  const c = Number(code);
  if (c === 0) return '☀️';
  if (c === 1) return '🌤️';
  if (c === 2) return '⛅';
  if (c === 3) return '☁️';
  if (c === 45 || c === 48) return '🌫️';
  if ([51, 53, 55, 56, 57].includes(c)) return '🌦️';
  if ([61, 63, 65, 66, 67].includes(c)) return '🌧️';
  if ([71, 73, 75, 77].includes(c)) return '❄️';
  if ([80, 81, 82].includes(c)) return '🌧️';
  if ([85, 86].includes(c)) return '🌨️';
  if (c === 95) return '⛈️';
  if (c === 96 || c === 99) return '⛈️';
  return '❔';
}

function weatherApiEmoji(text, code) {
  const t = String(text || '').toLowerCase();
  if (code === 1000 || t.includes('sunny') || t.includes('clear')) return '☀️';
  if (t.includes('partly cloudy')) return '🌤️';
  if (t.includes('overcast') || t.includes('cloud')) return '☁️';
  if (t.includes('fog') || t.includes('mist')) return '🌫️';
  if (t.includes('thunder')) return '⛈️';
  if (t.includes('snow') || t.includes('sleet') || t.includes('blizzard') || t.includes('ice')) return '❄️';
  if (t.includes('rain') || t.includes('drizzle') || t.includes('shower')) return '🌧️';
  return '❔';
}

function fetchGeoName(lat, lon) {
  const url =
    `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}` +
    `&count=1&language=it`;
  return httpsGetJson(url, { insecureTls: config.weatherAllowInsecureTls, label: 'geocode' }).then((json) => {
    const first = json && Array.isArray(json.results) ? json.results[0] : null;
    const name = first && first.name ? first.name : null;
    const admin = first && first.admin1 ? first.admin1 : null;
    if (name && admin) return `${name} (${admin})`;
    if (name) return name;
    return null;
  });
}

function fetchWeatherWeatherApi(lat, lon) {
  if (!config.weatherApiKey) return Promise.resolve(null);
  const q = encodeURIComponent(`${lat},${lon}`);
  const url =
    `${config.weatherApiBaseUrl}/forecast.json?key=${encodeURIComponent(config.weatherApiKey)}` +
    `&q=${q}&days=1&aqi=no&alerts=no`;
  return httpsGetJson(url, { insecureTls: config.weatherAllowInsecureTls, label: 'weatherapi' });
}

function getMainKeyboard(ctx) {
  if (!isAuthorized(ctx)) {
    return Markup.keyboard([['/register', '/help']]).resize().persistent();
  }
  return Markup.keyboard([['AyPi Calendar']]).resize().persistent();
}

function sendStartWelcome(ctx) {
  return menu.replyAndRefresh(ctx, 'AyPiZoea online. Come posso esserti utile?', getMainKeyboard(ctx));
}

async function sendTodayMessage(ctx) {
  logEvent('today', ctx);
  if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
  if (!canRole(ctx, 'use_today')) return menu.replyAndRefresh(ctx, 'Permesso negato per /today.');
  const owners = storage.loadOwners();
  const me = owners[String(ctx.chat.id)] || ctx?.from?.first_name || 'Operatore';

  const now = new Date();
  const time = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
    const dateStrRaw = new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
    const dateStr = dateStrRaw.replace(/\b\p{L}/u, (m) => m.toUpperCase());
  const dayKey = toDateOnly(now);
  const weekday = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long',
  })
    .format(now)
    .toLowerCase();
  const isWeekend = weekday === 'sabato' || weekday === 'domenica';

  const lines = [`Buongiorno ${me}, sono le ${time} di ${dateStr}.`];

  const locations = storage.loadUserLocations();
  const saved = locations[String(ctx.chat.id)];
  const lat = saved?.lat ?? 45.8333;
  const lon = saved?.lon ?? 8.3667;
  let weather = await fetchWeather(lat, lon);
  let weatherProvider = 'open-meteo';
  if (!(weather && weather.current && weather.daily)) {
    const alt = await fetchWeatherWeatherApi(lat, lon);
    if (alt && alt.current && alt.forecast) {
      weather = alt;
      weatherProvider = 'weatherapi';
    }
  }

  let placeName = saved ? 'Località' : 'Cesara (VB)';
  if (weatherProvider === 'weatherapi') {
    const loc = weather?.location;
    const name = loc?.name;
    const region = loc?.region;
    if (name && region) placeName = `${name} (${region})`;
    else if (name) placeName = name;
  } else {
    placeName = (await fetchGeoName(lat, lon)) || placeName;
  }

  if (weatherProvider === 'open-meteo' && weather && weather.current && weather.daily) {
    const cur = weather.current;
    const daily = weather.daily;
    const tMin = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
    const tMax = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
    const emoji = weatherEmoji(cur.weather_code);
    if (
      typeof cur.temperature_2m === 'number' &&
      typeof tMin === 'number' &&
      typeof tMax === 'number' &&
      typeof cur.wind_speed_10m === 'number'
    ) {
      lines.push(
        `${placeName}: ${emoji} ${cur.temperature_2m}°C (📉${tMin}°C / 📈${tMax}°C), vento ${cur.wind_speed_10m} km/h`
      );
    } else {
      const lineParts = [];
      if (typeof cur.temperature_2m === 'number') lineParts.push(`${emoji} ${cur.temperature_2m}°C`);
      if (typeof tMin === 'number' && typeof tMax === 'number')
        lineParts.push(`📉${tMin}°C / 📈${tMax}°C`);
      if (typeof cur.wind_speed_10m === 'number') lineParts.push(`vento ${cur.wind_speed_10m} km/h`);
      if (lineParts.length) lines.push(`${placeName}: ${lineParts.join(', ')}`);
    }
  } else if (weatherProvider === 'weatherapi' && weather && weather.current && weather.forecast) {
    const cur = weather.current;
    const day = weather.forecast?.forecastday?.[0]?.day || {};
    const tMin = typeof day.mintemp_c === 'number' ? day.mintemp_c : null;
    const tMax = typeof day.maxtemp_c === 'number' ? day.maxtemp_c : null;
    const emoji = weatherApiEmoji(cur?.condition?.text, cur?.condition?.code);
    if (
      typeof cur.temp_c === 'number' &&
      typeof tMin === 'number' &&
      typeof tMax === 'number' &&
      typeof cur.wind_kph === 'number'
    ) {
      lines.push(
        `${placeName}: ${emoji} ${cur.temp_c}°C (📉${tMin}°C / 📈${tMax}°C), vento ${cur.wind_kph} km/h`
      );
    } else {
      const lineParts = [];
      if (typeof cur.temp_c === 'number') lineParts.push(`${emoji} ${cur.temp_c}°C`);
      if (typeof tMin === 'number' && typeof tMax === 'number')
        lineParts.push(`📉${tMin}°C / 📈${tMax}°C`);
      if (typeof cur.wind_kph === 'number') lineParts.push(`vento ${cur.wind_kph} km/h`);
      if (lineParts.length) lines.push(`${placeName}: ${lineParts.join(', ')}`);
    }
  } else {
    lines.push('Meteo: non disponibile al momento.');
  }

  if (!isWeekend) {
    const closures = loadCalendarExtra(config.calendarClosuresFile).filter((c) => isOnDate(c, dayKey));
    const holidays = loadCalendarExtra(config.calendarHolidaysFile).filter((h) => isOnDate(h, dayKey));
    if (closures.length) {
      lines.push("Oggi l'azienda è chiusa.");
    }
    holidays.forEach((h) => {
      lines.push(`Oggi è ${getExtraName(h)}`);
    });

    if (closures.length === 0 && holidays.length === 0) {
      const list = loadCalendarRequestsAllYears();
      const absences = list.filter((r) => {
        if (!r || typeof r !== 'object') return false;
        const status = String(r.status || '').toLowerCase();
        if (status !== 'approved') return false;
        if (!isOnDate(r, dayKey)) return false;
        const type = String(r.type || '').toLowerCase().trim();
        if (type === 'straordinari') return false;
        return true;
      });

      if (absences.length) {
        const items = absences.map((r) => {
          const name = r.employee || 'Sconosciuto';
          const allDayVal = r.allDay;
          const allDay = allDayVal === true || String(allDayVal).toLowerCase() === 'true';
          if (!allDay) {
            const start = parseDateTime(r.start);
            const end = parseDateTime(r.end || r.start);
            if (start.date === end.date && start.time && end.time) {
              return `${name} dalle ${start.time} alle ${end.time}`;
            }
          }
          return name;
        });
        lines.push(`Oggi sono assenti le seguenti persone: ${items.join(', ')}`);
      } else {
        lines.push('Oggi non risultano assenze.');
      }
    }
  }

  return menu.replyAndRefresh(ctx, lines.join('\n'), getMainKeyboard(ctx));
}

function registerCore(bot) {
  bot.on('location', async (ctx) => {
    if (!isAuthorized(ctx)) return;
    const loc = ctx.message && ctx.message.location;
    if (!loc) return;
    const locations = storage.loadUserLocations();
    locations[String(ctx.chat.id)] = {
      lat: loc.latitude,
      lon: loc.longitude,
      updatedAt: new Date().toISOString(),
    };
    storage.saveUserLocations(locations);
    return menu.replyAndRefresh(ctx, 'Posizione salvata.');
  });
  bot.start((ctx) => {
    logEvent('start', ctx);
    sendStartWelcome(ctx);
  });

  if (config.heartbeatEnabled && config.heartbeatFile) {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(config.heartbeatFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      setInterval(() => {
        try {
          fs.writeFileSync(config.heartbeatFile, `${Date.now()}\n`, 'utf8');
        } catch {}
      }, config.heartbeatIntervalMs || 30000);
    } catch {}
  }

  bot.command('id', (ctx) => {
    logEvent('id', ctx);
    const chatId = ctx.chat.id;
    return menu.replyAndRefresh(ctx, `Il tuo chat ID è: ${chatId}`, getMainKeyboard(ctx));
  });

  bot.command('help', (ctx) => {
    logEvent('help', ctx);
    const lines = [
      '/start: avvia il bot',
      '/help: mostra questo aiuto',
      '/id: mostra il tuo chat ID',
      '/register: richiesta registrazione',
      '/aypi: menu AyPi',
      '/listids: lista e gestione operatori',
      '/ranks: ruoli e utenti',
      '/logs: mostra gli ultimi 10 eventi',
      '/clean [n]: elimina gli ultimi messaggi del bot (o tutti)',
      '/diceroll [n]: lancia 1 o più dadi',
      '/qr <testo o URL>: genera un QR',
      '/today: riepilogo giornaliero (meteo locale se condividi la posizione manualmente)',
      '/nextclosure: prossima chiusura o festività',
      '/topabsences: chi ha più assenze nel mese corrente',
      '/ping: verifica che il bot risponda',
    ];
    menu.replyAndRefresh(ctx, lines.join('\n'), getMainKeyboard(ctx));
  });

  bot.command('ping', (ctx) => {
    logEvent('ping', ctx);
    if (!canRole(ctx, 'use_ping')) return menu.replyAndRefresh(ctx, 'Permesso negato per /ping.');
    menu.replyAndRefresh(ctx, 'pong');
  });

  bot.command('diceroll', async (ctx) => {
    logEvent('diceroll', ctx, `text="${ctx.message.text}"`);
    if (!canRole(ctx, 'use_diceroll')) return menu.replyAndRefresh(ctx, 'Permesso negato per /diceroll.');
    const parts = ctx.message.text.trim().split(/\s+/);
    let count = 1;
    if (parts[1]) {
      const n = Number(parts[1]);
      if (Number.isFinite(n) && n > 0) count = Math.min(Math.floor(n), 10);
    }
    const { recordBotMessage } = require('../utils/telegram');
    for (let i = 0; i < count; i += 1) {
      try {
        const msg = await ctx.telegram.sendDice(ctx.chat.id);
        recordBotMessage(ctx.chat && ctx.chat.id, msg && msg.message_id);
      } catch {
        // ignore
      }
    }
  });

  bot.command('qr', async (ctx) => {
    logEvent('qr', ctx, `text="${ctx.message.text}"`);
    if (!canRole(ctx, 'use_qr')) return menu.replyAndRefresh(ctx, 'Permesso negato per /qr.');
    const raw = ctx.message.text || '';
    const payload = raw.replace(/^\/qr(@\w+)?\s*/i, '').trim();
    if (!payload) {
      return menu.replyAndRefresh(ctx, 'Uso: /qr <testo o URL>');
    }
    if (payload.length > 1000) {
      return menu.replyAndRefresh(ctx, 'Testo troppo lungo. Massimo 1000 caratteri.');
    }
    try {
      const buffer = await QRCode.toBuffer(payload, {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 512,
      });
      const msg = await ctx.replyWithPhoto({ source: buffer }, { caption: 'QR generato.' });
      require('../utils/telegram').recordBotMessage(ctx.chat && ctx.chat.id, msg && msg.message_id);
    } catch (err) {
      const msg = err?.message || String(err);
      logEvent('qr_fail', ctx, `reason="${msg}"`);
      return menu.replyAndRefresh(ctx, 'Impossibile generare il QR.');
    }
  });

  bot.command('today', async (ctx) => sendTodayMessage(ctx));

  bot.command('nextclosure', async (ctx) => {
    logEvent('nextclosure', ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_nextclosure')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayKey = toDateOnly(today);
    const items = [];
    const closures = loadCalendarExtra(config.calendarClosuresFile);
    closures.forEach((c) => {
      const start = toDateOnly(c.start || c.from || c.date || c.day || '');
      const end = toDateOnly(c.end || c.to || c.date || c.day || c.start || c.from || '');
      if (!start) return;
      if (end && end < dayKey) return;
      items.push({
        kind: 'Chiusura',
        name: getExtraName(c),
        start,
        end: end || start,
      });
    });
    const holidays = loadCalendarExtra(config.calendarHolidaysFile);
    holidays.forEach((h) => {
      const start = toDateOnly(h.start || h.from || h.date || h.day || '');
      const end = toDateOnly(h.end || h.to || h.date || h.day || h.start || h.from || '');
      if (!start) return;
      if (end && end < dayKey) return;
      items.push({
        kind: 'Festività',
        name: getExtraName(h),
        start,
        end: end || start,
      });
    });
    if (!items.length) return menu.replyAndRefresh(ctx, 'Nessuna chiusura o festività futura.');
    items.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const next = items[0];
    const start = formatDateLabel(next.start);
    const end = formatDateLabel(next.end);
    const when = start === end ? start : `da ${start} a ${end}`;
    const startDate = dateObj(next.start);
    const todayDate = dateObj(dayKey);
    let daysLeft = null;
    if (startDate && todayDate) {
      const diff = Math.ceil((startDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      daysLeft = Math.max(0, diff);
    }
    const suffix = daysLeft === null ? '' : ` - Mancano ${daysLeft} giorni`;
    return menu.replyAndRefresh(ctx, `${next.kind}: ${next.name} - ${when}${suffix}`);
  });

  bot.command('topabsences', async (ctx) => {
    logEvent('topabsences', ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'top_absences')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const range = getMonthRange(new Date());
    const state = {
      feriep: true,
      mutua: true,
      startDate: toDateOnly(range.start),
      endDate: toDateOnly(range.end),
    };
    topAbsencesByChat.set(ctx.chat.id, state);
    return sendTopAbsMenu(ctx, state);
  });

  bot.action(/topabs:toggle:(feriep|mutua)/, (ctx) => {
    const key = ctx.match[1];
    logEvent('topabs_toggle', ctx, `key=${key}`);
    if (!isAuthorized(ctx)) return;
    if (!canRole(ctx, 'top_absences')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const state = topAbsencesByChat.get(ctx.chat.id) || { feriep: true, mutua: true };
    state[key] = !state[key];
    topAbsencesByChat.set(ctx.chat.id, state);
    return sendTopAbsMenu(ctx, state);
  });

  bot.action('topabs:set:start', (ctx) => {
    logEvent('topabs_set_start', ctx);
    if (!isAuthorized(ctx)) return;
    if (!canRole(ctx, 'top_absences')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const state = topAbsencesByChat.get(ctx.chat.id) || {
      feriep: true,
      mutua: true,
      startDate: null,
      endDate: null,
    };
    state.waitingFor = 'start';
    topAbsencesByChat.set(ctx.chat.id, state);
    return menu.sendMenuMessage(
      ctx,
      'Inserisci data inizio (GG/MM/AAAA) oppure premi Annulla.',
      {
        inline_keyboard: [[{ text: 'Annulla', callback_data: 'topabs:cancel_input', style: 'danger' }]],
      }
    );
  });

  bot.action('topabs:set:end', (ctx) => {
    logEvent('topabs_set_end', ctx);
    if (!isAuthorized(ctx)) return;
    if (!canRole(ctx, 'top_absences')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const state = topAbsencesByChat.get(ctx.chat.id) || {
      feriep: true,
      mutua: true,
      startDate: null,
      endDate: null,
    };
    state.waitingFor = 'end';
    topAbsencesByChat.set(ctx.chat.id, state);
    return menu.sendMenuMessage(
      ctx,
      'Inserisci data fine (GG/MM/AAAA) oppure premi Annulla.',
      {
        inline_keyboard: [[{ text: 'Annulla', callback_data: 'topabs:cancel_input', style: 'danger' }]],
      }
    );
  });

  bot.action('topabs:cancel', (ctx) => {
    logEvent('topabs_cancel', ctx);
    if (!canRole(ctx, 'top_absences')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    topAbsencesByChat.delete(ctx.chat.id);
    return safeDelete(ctx);
  });

  bot.action('topabs:cancel_input', (ctx) => {
    logEvent('topabs_cancel_input', ctx);
    if (!canRole(ctx, 'top_absences')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const state = topAbsencesByChat.get(ctx.chat.id);
    if (state) {
      state.waitingFor = null;
      topAbsencesByChat.set(ctx.chat.id, state);
    }
    safeDelete(ctx);
    return sendTopAbsMenu(ctx, state || { feriep: true, mutua: true });
  });

  bot.action('topabs:show', (ctx) => {
    logEvent('topabs_show', ctx);
    if (!isAuthorized(ctx)) return;
    if (!canRole(ctx, 'top_absences')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const state = topAbsencesByChat.get(ctx.chat.id) || { feriep: true, mutua: true };
    const list = loadCalendarRequestsAllYears();
    const start = dateObj(state.startDate);
    const end = dateObj(state.endDate);
    if (!start || !end) {
      return menu.replyAndRefresh(ctx, 'Inserisci sia data inizio che data fine.');
    }
    if (start.getTime() > end.getTime()) {
      return menu.replyAndRefresh(ctx, 'La data di fine non può essere precedente alla data di inizio.');
    }
    const counts = new Map();
    const closures = loadCalendarExtra(config.calendarClosuresFile);
    const holidays = loadCalendarExtra(config.calendarHolidaysFile);
    list.forEach((r) => {
      if (!r || typeof r !== 'object') return;
      const status = String(r.status || '').toLowerCase();
      if (status !== 'approved') return;
      if (!overlapPeriod(r.start, r.end || r.start, start, end)) return;
      const type = String(r.type || '').toLowerCase().trim();
      const isFeriePermesso = type === 'ferie' || type === 'permesso';
      const isMutua = type === 'mutua';
      if ((isFeriePermesso && !state.feriep) || (isMutua && !state.mutua)) return;
      if (!isFeriePermesso && !isMutua) return;
      const name = r.employee || 'Sconosciuto';
      const allDayVal = r.allDay;
      const allDay = allDayVal === true || String(allDayVal).toLowerCase() === 'true';
      let hours = 0;
      if (allDay) {
        const s = dateObj(toDateOnly(r.start));
        const e = dateObj(toDateOnly(r.end || r.start));
        if (s && e) {
          let cur = new Date(s.getTime());
          let total = 0;
          let guard = 0;
          while (cur <= e && guard < 400) {
            const day = cur.getDay();
            const iso = toDateOnly(cur);
            const isClosure = closures.some((c) => isOnDate(c, iso));
            const isHoliday = holidays.some((h) => isOnDate(h, iso));
            if (day !== 0 && day !== 6 && !isClosure && !isHoliday) total += 8;
            cur.setDate(cur.getDate() + 1);
            guard += 1;
          }
          hours = total;
        } else {
          hours = 8;
        }
      } else {
        const startDt = new Date(r.start);
        const endDt = new Date(r.end || r.start);
        if (!Number.isNaN(startDt.getTime()) && !Number.isNaN(endDt.getTime())) {
          const diff = (endDt.getTime() - startDt.getTime()) / (1000 * 60 * 60);
          const day = startDt.getDay();
          const iso = toDateOnly(startDt);
          const isClosure = closures.some((c) => isOnDate(c, iso));
          const isHoliday = holidays.some((h) => isOnDate(h, iso));
          if (day !== 0 && day !== 6 && !isClosure && !isHoliday) {
            hours = Math.max(0, Math.round(diff * 100) / 100);
          }
        }
      }
      counts.set(name, (counts.get(name) || 0) + hours);
    });
    if (counts.size === 0) {
      return menu.replyAndRefresh(ctx, 'Nessuna assenza trovata per il periodo selezionato.');
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const lines = rows.map(([name, hours]) => `${name}: ${hours}h`);
    const title = `Top assenze - ${formatDateLabel(state.startDate)} → ${formatDateLabel(state.endDate)}`;
    safeDelete(ctx);
    return menu.replyAndRefresh(ctx, `${title}\n${lines.join('\n')}`);
  });

  bot.command('allow', (ctx) => {
    logEvent('allow', ctx, `text="${ctx.message.text}"`);
    if (!require('../utils/auth').isOwnerUser(ctx)) {
      logEvent('allow_denied', ctx);
      return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 2) {
      return menu.replyAndRefresh(ctx, 'Uso: /allow <chatId>');
    }
    const newId = Number(parts[1]);
    if (!Number.isFinite(newId)) {
      logEvent('allow_invalid_id', ctx, `value="${parts[1]}"`);
      return menu.replyAndRefresh(ctx, 'Chat ID non valido.');
    }
    state.allowedIds.add(newId);
    storage.saveAllowedIds(state.allowedIds);
    logEvent('allow_ok', ctx, `added=${newId}`);
    return menu.replyAndRefresh(ctx, `Autorizzato: ${newId}`);
  });

  bot.command('maintenance_on', async (ctx) => {
    logEvent('maintenance_on', ctx, `text="${ctx.message.text}"`);
    if (!isOwnerUser(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const raw = ctx.message.text || '';
    const period = raw.replace(/^\/maintenance_on(@\w+)?\s*/i, '').trim();
    if (!period) {
      return menu.replyAndRefresh(ctx, 'Uso: /maintenance_on <durata> (es: "1 giorno")');
    }
    const message =
      `Il bot è temporaneamente in fase di sviluppo e manutenzione. ` +
      `Il downtime sarà di circa: ${period}.`;
    const owners = storage.loadOwners();
    const ownerIds = Object.entries(owners)
      .filter(([, name]) => name === config.defaultOwnerName)
      .map(([id]) => Number(id))
      .filter((id) => Number.isFinite(id));
    const targets =
      state.allowedIds.size > 0 ? new Set([...state.allowedIds]) : new Set(ownerIds);
    if (!targets.size) return menu.replyAndRefresh(ctx, 'Nessun destinatario trovato.');
    const results = await Promise.all(
      [...targets].map((id) =>
        ctx.telegram
          .sendMessage(id, message, { disable_notification: true })
          .then(() => ({ id, ok: true }))
          .catch(() => ({ id, ok: false }))
      )
    );
    const nameOf = (id) => owners[String(id)] || String(id);
    const ok = results.filter((r) => r.ok).map((r) => nameOf(r.id));
    const fail = results.filter((r) => !r.ok).map((r) => nameOf(r.id));
    const lines = [
      `Messaggio manutenzione inviato a ${ok.length} chat.`,
      ok.length ? `Ricevuto: ${ok.join(', ')}` : 'Ricevuto: (nessuno)',
    ];
    if (fail.length) lines.push(`Non raggiunti: ${fail.join(', ')}`);
    return menu.replyAndRefresh(ctx, lines.join('\n'));
  });

  bot.command('maintenance_off', async (ctx) => {
    logEvent('maintenance_off', ctx, `text="${ctx.message.text}"`);
    if (!isOwnerUser(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const message = 'La fase di manutenzione è temporaneamente terminata e il servizio è stato ripristinato!';
    const owners = storage.loadOwners();
    const ownerIds = Object.entries(owners)
      .filter(([, name]) => name === config.defaultOwnerName)
      .map(([id]) => Number(id))
      .filter((id) => Number.isFinite(id));
    const targets =
      state.allowedIds.size > 0 ? new Set([...state.allowedIds]) : new Set(ownerIds);
    if (!targets.size) return menu.replyAndRefresh(ctx, 'Nessun destinatario trovato.');
    const results = await Promise.all(
      [...targets].map((id) =>
        ctx.telegram
          .sendMessage(id, message, { disable_notification: true })
          .then(() => ({ id, ok: true }))
          .catch(() => ({ id, ok: false }))
      )
    );
    const nameOf = (id) => owners[String(id)] || String(id);
    const ok = results.filter((r) => r.ok).map((r) => nameOf(r.id));
    const fail = results.filter((r) => !r.ok).map((r) => nameOf(r.id));
    const lines = [
      `Messaggio manutenzione inviato a ${ok.length} chat.`,
      ok.length ? `Ricevuto: ${ok.join(', ')}` : 'Ricevuto: (nessuno)',
    ];
    if (fail.length) lines.push(`Non raggiunti: ${fail.join(', ')}`);
    return menu.replyAndRefresh(ctx, lines.join('\n'));
  });

  bot.command('logs', (ctx) => {
    logEvent('logs', ctx);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.size > 0 && !state.allowedIds.has(requesterId)) {
      logEvent('logs_denied', ctx);
      return safeReply(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_logs')) {
      logEvent('logs_denied_perm', ctx);
      return menu.replyAndRefresh(ctx, 'Permesso negato per /logs.');
    }
    try {
      const fs = require('fs');
      if (!fs.existsSync(config.logFile)) return menu.replyAndRefresh(ctx, 'Nessun log disponibile.');
      const raw = fs.readFileSync(config.logFile, 'utf8');
      const lines = raw.trim().split(/\r?\n/).filter(Boolean);
      const parts = ctx.message.text.trim().split(/\s+/);
      const req = Number(parts[1] || 10);
      const count = Number.isFinite(req) ? Math.min(Math.max(req, 1), 100) : 10;
      const last = lines.slice(-count);
      return menu.replyAndRefresh(ctx, `Ultimi ${count} eventi:\n${last.join('\n')}`);
    } catch (err) {
      console.error('Failed to read log file:', err.message);
      return menu.replyAndRefresh(ctx, 'Errore nella lettura dei log.');
    }
  });

  bot.command('clean', async (ctx) => {
    logEvent('clean', ctx, `text="${ctx.message.text}"`);
    if (!canRole(ctx, 'use_clean')) return menu.replyAndRefresh(ctx, 'Permesso negato per /clean.');
    const chatId = ctx.chat.id;
    const parts = ctx.message.text.trim().split(/\s+/);
    let count = Infinity;
    if (parts[1]) {
      const n = Number(parts[1]);
      if (Number.isFinite(n) && n > 0) count = Math.floor(n);
    }
    const list = botMessagesByChat.get(chatId) || [];
    const target = count === Infinity ? list.slice() : list.slice(-count);
    for (const id of target) {
      try {
        await ctx.telegram.deleteMessage(chatId, id);
      } catch {
        // ignore
      }
    }
    if (count === Infinity) {
      botMessagesByChat.set(chatId, []);
    } else {
      botMessagesByChat.set(chatId, list.slice(0, Math.max(0, list.length - count)));
    }
    const storage = require('../storage');
    const obj = storage.loadBotMessages();
    obj[String(chatId)] = botMessagesByChat.get(chatId) || [];
    storage.saveBotMessages(obj);
    lastMenuByChat.delete(chatId);
    menuMessageByChat.delete(chatId);
  });
}

module.exports = registerCore;
module.exports.__sendTodayMessage = sendTodayMessage;
module.exports.__sendTopAbsMenu = sendTopAbsMenu;
module.exports.__sendStartWelcome = sendStartWelcome;
