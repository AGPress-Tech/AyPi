const config = require('./config');
const {
  loadAllowedIds,
  loadOwners,
  loadRoles,
  loadRoleList,
  ensureDefaultOwner,
  roleRankMap,
} = require('./storage');
const { lastMenuByChat, menuMessageByChat, calendarHighlightsByChat } = require('./state');
const { roleButtonStyle, encodeRole } = require('./utils/roles');
const { safeReply, recordBotMessage } = require('./utils/telegram');

function buildListMenu(list, owners, roles) {
  const itemRows = [];
  for (let i = 0; i < list.length; i += 2) {
    const leftId = list[i];
    const rightId = list[i + 1];
    const left = {
      text: `${owners[leftId] || 'Senza nome'} (${leftId})`,
      callback_data: `listid:${leftId}`,
      style: roleButtonStyle(roles[leftId]),
    };
    if (rightId) {
      const right = {
        text: `${owners[rightId] || 'Senza nome'} (${rightId})`,
        callback_data: `listid:${rightId}`,
        style: roleButtonStyle(roles[rightId]),
      };
      itemRows.push([left, right]);
    } else {
      itemRows.push([left]);
    }
  }
  return {
    text: 'Seleziona un ID:',
    reply_markup: {
      inline_keyboard: [...itemRows, [{ text: 'Esci', callback_data: 'listids:exit', style: 'danger' }]],
    },
  };
}

async function sendMenuMessage(ctx, text, replyMarkup) {
  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId) return;
  try {
    const msg = await ctx.telegram.sendMessage(chatId, text, { reply_markup: replyMarkup });
    recordBotMessage(chatId, msg && msg.message_id);
    const oldId = menuMessageByChat.get(chatId);
    if (oldId && oldId !== msg.message_id) {
      try {
        await ctx.telegram.deleteMessage(chatId, oldId);
      } catch {
        // ignore
      }
    }
    menuMessageByChat.set(chatId, msg.message_id);
  } catch (err) {
    console.warn('Menu send failed:', err.message);
  }
}

async function sendListMenu(ctx) {
  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId) return;
  const current = loadAllowedIds();
  const list = [...current].sort((a, b) => a - b);
  if (list.length === 0) return;
  const owners = loadOwners();
  const roles = loadRoles();
  lastMenuByChat.set(chatId, 'list');
  const menu = buildListMenu(list, owners, roles);
  await sendMenuMessage(ctx, menu.text, menu.reply_markup);
}

const { isOwnerUser, canRole } = require('./utils/auth');
const fs = require('fs');

async function sendRanksMainMenu(ctx) {
  lastMenuByChat.set(ctx.chat.id, 'ranks-main');
  const rows = [
    [{ text: 'Ruoli', callback_data: 'ranks:roles' }],
    [{ text: 'Utenti', callback_data: 'ranks:users' }],
  ];
  if (isOwnerUser(ctx)) {
    rows.push([{ text: 'Configura', callback_data: 'ranks:config', style: 'primary' }]);
  }
  rows.push([{ text: 'Esci', callback_data: 'ranks:exit', style: 'danger' }]);
  return sendMenuMessage(ctx, 'Menu ruoli:', { inline_keyboard: rows });
}

async function sendRanksRolesMenu(ctx) {
  lastMenuByChat.set(ctx.chat.id, 'ranks-roles');
  const roles = loadRoleList();
  const roleRows = roles.map((r) => [
    { text: r, callback_data: `ranks:role:${r}`, style: roleButtonStyle(r) },
  ]);
  return sendMenuMessage(ctx, 'Seleziona un ruolo:', {
    inline_keyboard: [
      ...roleRows,
      [
        { text: 'Nuovo Rank...', callback_data: 'ranks:new' },
        { text: 'Indietro', callback_data: 'ranks:back' },
      ],
    ],
  });
}

async function sendRanksUsersMenu(ctx) {
  lastMenuByChat.set(ctx.chat.id, 'ranks-users');
  ensureDefaultOwner();
  const owners = loadOwners();
  const roles = loadRoles();
  const rankMap = roleRankMap();
  const ids = [...loadAllowedIds()].map(String);
  const rows = ids.map((id) => {
    const role = roles[id] || 'Senza ruolo';
    const name = owners[id] || `Senza nome (${id})`;
    return { id, name, role, rank: rankMap[role] ?? 999 };
  });
  rows.sort((a, b) => (a.rank - b.rank) || a.name.localeCompare(b.name));
  const userRows = rows.map((r) => [
    {
      text: `${r.name}`,
      callback_data: `ranks:user:${r.id}`,
      style: roleButtonStyle(r.role),
    },
  ]);
  const keyboard = [...userRows, [{ text: 'Indietro', callback_data: 'ranks:back' }]];
  return sendMenuMessage(ctx, rows.length ? 'Seleziona un utente:' : 'Nessun utente.', {
    inline_keyboard: keyboard,
  });
}

async function sendRanksRoleDetail(ctx, roleName) {
  lastMenuByChat.set(ctx.chat.id, `ranks-role:${roleName}`);
  ensureDefaultOwner();
  const owners = loadOwners();
  const roles = loadRoles();
  const ids = [...loadAllowedIds()].map(String);
  const users = ids
    .filter((id) => (roles[id] || 'Senza ruolo') === roleName)
    .map((id) => owners[id] || `Senza nome (${id})`);
  let perms;
  if (roleName === config.defaultRoleName) {
    perms = 'tutti i comandi e configurazioni';
  } else {
    const rolePerms = require('./storage').getRolePerms(roleName);
    const allowed = config.permissions.filter((p) => rolePerms[p.key]).map((p) => `✅ ${p.label}`);
    const denied = config.permissions.filter((p) => !rolePerms[p.key]).map((p) => `❌ ${p.label}`);
    perms = [
      allowed.length ? allowed.join('\n') : '✅ Nessun permesso attivo',
      denied.length ? denied.join('\n') : '❌ Nessun permesso disattivo',
    ].join('\n');
  }
  const body = [
    `Gli utenti "${roleName}" sono i seguenti:`,
    users.length ? users.join('\n') : '(nessuno)',
    '',
    `Permessi per "${roleName}":`,
    perms,
  ].join('\n');
  return sendMenuMessage(ctx, body, {
    inline_keyboard: [
      [{ text: 'Modifica', callback_data: `ranks:rename:${roleName}` }],
      [{ text: 'Elimina', callback_data: `ranks:delete:${roleName}`, style: 'danger' }],
      [
        { text: 'Indietro', callback_data: 'ranks:roles' },
        { text: 'Esci', callback_data: 'ranks:exit', style: 'danger' },
      ],
    ],
  });
}

async function sendRanksUserDetail(ctx, userId) {
  lastMenuByChat.set(ctx.chat.id, `ranks-user:${userId}`);
  ensureDefaultOwner();
  const owners = loadOwners();
  const roles = loadRoles();
  const name = owners[userId] || `Senza nome (${userId})`;
  const role = roles[userId] || 'Senza ruolo';
  const body = [`Utente: ${name}`, `Ruolo: ${role}`, `ID: ${userId}`].join('\n');
  return sendMenuMessage(ctx, body, {
    inline_keyboard: [
      [{ text: 'Modifica', callback_data: `ranks:user:rename:${userId}` }],
      [{ text: 'Cambia ruolo', callback_data: `ranks:user:role:${userId}` }],
      [{ text: 'Elimina', callback_data: `ranks:user:delete:${userId}`, style: 'danger' }],
      [
        { text: 'Indietro', callback_data: 'ranks:users' },
        { text: 'Esci', callback_data: 'ranks:exit', style: 'danger' },
      ],
    ],
  });
}

async function sendRanksUserRoleMenu(ctx, userId) {
  lastMenuByChat.set(ctx.chat.id, `ranks-user-role:${userId}`);
  const roles = loadRoleList();
  const roleRows = [];
  for (let i = 0; i < roles.length; i += 2) {
    const left = roles[i];
    const right = roles[i + 1];
    const leftBtn = { text: left, callback_data: `ranks:user:rolepick:${userId}:${encodeRole(left)}` };
    if (right) {
      const rightBtn = { text: right, callback_data: `ranks:user:rolepick:${userId}:${encodeRole(right)}` };
      roleRows.push([leftBtn, rightBtn]);
    } else {
      roleRows.push([leftBtn]);
    }
  }
  const keyboard = [
    ...roleRows,
    [
      { text: 'Indietro', callback_data: `ranks:user:${userId}` },
      { text: 'Esci', callback_data: 'ranks:exit', style: 'danger' },
    ],
  ];
  return sendMenuMessage(ctx, 'Seleziona un ruolo:', { inline_keyboard: keyboard });
}

async function sendRanksConfigMenu(ctx) {
  lastMenuByChat.set(ctx.chat.id, 'ranks-config');
  const roles = loadRoleList().filter((r) => r !== config.defaultRoleName);
  const roleRows = roles.map((r) => [
    { text: r, callback_data: `ranks:config:role:${encodeRole(r)}` },
  ]);
  return sendMenuMessage(ctx, 'Configura ruoli:', {
    inline_keyboard: [
      ...roleRows,
      [{ text: 'Indietro', callback_data: 'ranks:back' }],
    ],
  });
}

async function sendRanksConfigRole(ctx, roleName) {
  lastMenuByChat.set(ctx.chat.id, `ranks-config-role:${roleName}`);
  if (roleName === config.defaultRoleName) {
    return sendMenuMessage(ctx, 'Owner non e configurabile.', {
      inline_keyboard: [[{ text: 'Indietro', callback_data: 'ranks:config' }]],
    });
  }
  const perms = require('./storage').getRolePerms(roleName);
  const rows = config.permissions.map((p) => {
    const enabled = Boolean(perms[p.key]);
    return [
      {
        text: `${p.label}: ${enabled ? 'ON' : 'OFF'}`,
        callback_data: `ranks:config:toggle:${encodeRole(roleName)}:${p.key}`,
        style: enabled ? 'success' : 'danger',
      },
    ];
  });
  rows.push([{ text: 'Indietro', callback_data: 'ranks:config' }]);
  return sendMenuMessage(ctx, `Permessi per ${roleName}:`, { inline_keyboard: rows });
}

async function sendAyPiMainMenu(ctx) {
  lastMenuByChat.set(ctx.chat.id, 'aypi-main');
  return sendMenuMessage(ctx, 'AyPi:', {
    inline_keyboard: [
      [{ text: 'AyPi Calendar', callback_data: 'aypi:calendar', style: 'primary' }],
      [{ text: 'AyPi Purchasing', callback_data: 'aypi:purchasing' }],
      [{ text: 'AyPi Ticket', callback_data: 'aypi:ticket', style: 'primary' }],
      [{ text: 'Esci', callback_data: 'aypi:exit', style: 'danger' }],
    ],
  });
}

async function sendAyPiTicketMenu(ctx) {
  lastMenuByChat.set(ctx.chat.id, 'aypi-ticket');
  return sendMenuMessage(ctx, 'AyPi Ticket:', {
    inline_keyboard: [
      [{ text: 'Nuovo', callback_data: 'aypi:ticket:new', style: 'success' }],
      [{ text: 'Lista Ticket', callback_data: 'aypi:ticket:list' }],
      [
        { text: 'Indietro', callback_data: 'aypi:back' },
        { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
      ],
    ],
  });
}

async function sendAyPiCalendarMenu(ctx) {
  lastMenuByChat.set(ctx.chat.id, 'aypi-calendar');
  const showPending = canRole(ctx, 'calendar_pending');
  let pendingCount = 0;
  if (showPending && config.calendarPendingFile && fs.existsSync(config.calendarPendingFile)) {
    try {
      const raw = fs.readFileSync(config.calendarPendingFile, 'utf8');
      const data = JSON.parse(raw);
      let list = [];
      if (Array.isArray(data)) list = data;
      else if (Array.isArray(data.requests)) list = data.requests;
      else if (Array.isArray(data.pending)) list = data.pending;
      pendingCount = list.filter((r) => {
        const status = (r && r.status) || (r && r.Status) || '';
        const s = String(status).toLowerCase();
        return s === 'pending';
      }).length;
    } catch {
      pendingCount = 0;
    }
  }
  return sendMenuMessage(ctx, 'AyPi Calendar:', {
    inline_keyboard: [
      [{ text: 'Calendario', callback_data: 'aypi:calendar:open' }],
      [
        { text: 'Richieste', callback_data: 'aypi:calendar:reqs' },
        ...(showPending
          ? [{ text: `In Attesa: ${pendingCount}`, callback_data: 'aypi:calendar:pending' }]
          : []),
      ],
      [
        { text: 'Chiusure e Festività', callback_data: 'aypi:calendar:closures' },
        { text: 'Gestione Ore', callback_data: 'aypi:calendar:balances' },
      ],
      [
        { text: 'Indietro', callback_data: 'aypi:back' },
        { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
      ],
    ],
  });
}

function addMonths(monthKey, delta) {
  const [yyyy, mm] = monthKey.split('-').map(Number);
  const d = new Date(yyyy, mm - 1 + delta, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatMonthLabel(monthKey) {
  const [yyyy, mm] = monthKey.split('-').map(Number);
  const names = [
    'Gennaio',
    'Febbraio',
    'Marzo',
    'Aprile',
    'Maggio',
    'Giugno',
    'Luglio',
    'Agosto',
    'Settembre',
    'Ottobre',
    'Novembre',
    'Dicembre',
  ];
  return `${names[mm - 1]} ${yyyy}`;
}

function buildCalendarMonthKeyboard(monthKey, highlightMap) {
  const [yyyy, mm] = monthKey.split('-').map(Number);
  const first = new Date(yyyy, mm - 1, 1);
  const lastDay = new Date(yyyy, mm, 0).getDate();
  const mondayIndex = (first.getDay() + 6) % 7;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  const rows = [];
  rows.push([
    { text: '◀︎', callback_data: `aypi:calendar:month:${addMonths(monthKey, -1)}` },
    { text: formatMonthLabel(monthKey), callback_data: `aypi:calendar:jump:${monthKey}` },
    { text: '▶︎', callback_data: `aypi:calendar:month:${addMonths(monthKey, 1)}` },
  ]);
  const week = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  rows.push(week.map((w) => ({ text: w, callback_data: 'aypi:calendar:noop' })));
  let day = 1;
  let row = [];
  for (let i = 0; i < mondayIndex; i += 1) {
    row.push({ text: '·', callback_data: 'aypi:calendar:noop' });
  }
  while (day <= lastDay) {
    const dayKey = `${monthKey}-${String(day).padStart(2, '0')}`;
    const isToday = dayKey === todayKey;
    const style = highlightMap ? highlightMap.get(dayKey) : undefined;
    row.push({
      text: String(day),
      callback_data: `aypi:calendar:day:${dayKey}`,
      ...(isToday ? { style: 'success' } : style ? { style } : {}),
    });
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
    day += 1;
  }
  if (row.length) {
    while (row.length < 7) {
      row.push({ text: '·', callback_data: 'aypi:calendar:noop' });
    }
    rows.push(row);
  }
  rows.push([
    { text: 'Indietro', callback_data: 'aypi:calendar' },
    { text: 'Esci', callback_data: 'aypi:exit', style: 'danger' },
  ]);
  return rows;
}

async function sendAyPiCalendarMonth(ctx, monthKey, highlightMap) {
  lastMenuByChat.set(ctx.chat.id, `aypi-calendar-month:${monthKey}`);
  if (highlightMap) {
    calendarHighlightsByChat.set(ctx.chat.id, { monthKey, styles: highlightMap });
  }
  return sendMenuMessage(ctx, 'Calendario:', {
    inline_keyboard: buildCalendarMonthKeyboard(monthKey, highlightMap),
  });
}

async function refreshMenu(ctx) {
  const chatId = ctx.chat && ctx.chat.id;
  if (!chatId) return;
  const origin = lastMenuByChat.get(chatId);
  if (!origin) return;
  if (origin === 'list') return sendListMenu(ctx);
  if (origin === 'ranks-main') return sendRanksMainMenu(ctx);
  if (origin === 'ranks-roles') return sendRanksRolesMenu(ctx);
  if (origin === 'ranks-users') return sendRanksUsersMenu(ctx);
  if (origin === 'ranks-config') return sendRanksConfigMenu(ctx);
  if (origin === 'aypi-main') return sendAyPiMainMenu(ctx);
  if (origin === 'aypi-calendar') return sendAyPiCalendarMenu(ctx);
  if (origin === 'aypi-ticket') return sendAyPiTicketMenu(ctx);
  if (origin && origin.startsWith('aypi-calendar-month:')) {
    const monthKey = origin.split(':')[1];
    const cached = calendarHighlightsByChat.get(chatId);
    const styles = cached && cached.monthKey === monthKey ? cached.styles : undefined;
    return sendAyPiCalendarMonth(ctx, monthKey, styles);
  }
  if (origin && origin.startsWith('ranks-config-role:')) {
    const role = origin.split(':')[1];
    return sendRanksConfigRole(ctx, role);
  }
  if (origin && origin.startsWith('ranks-role:')) {
    const role = origin.split(':')[1];
    return sendRanksRoleDetail(ctx, role);
  }
  if (origin && origin.startsWith('ranks-user-role:')) {
    const userId = origin.split(':')[1];
    return sendRanksUserRoleMenu(ctx, userId);
  }
  if (origin && origin.startsWith('ranks-user:')) {
    const userId = origin.split(':')[1];
    return sendRanksUserDetail(ctx, userId);
  }
}

async function replyAndRefresh(ctx, text, extra) {
  await safeReply(ctx, text, extra);
  await refreshMenu(ctx);
}

module.exports = {
  sendMenuMessage,
  sendListMenu,
  sendRanksMainMenu,
  sendRanksRolesMenu,
  sendRanksUsersMenu,
  sendRanksRoleDetail,
  sendRanksUserDetail,
  sendRanksUserRoleMenu,
  sendRanksConfigMenu,
  sendRanksConfigRole,
  sendAyPiMainMenu,
  sendAyPiCalendarMenu,
  sendAyPiTicketMenu,
  sendAyPiCalendarMonth,
  refreshMenu,
  replyAndRefresh,
};


