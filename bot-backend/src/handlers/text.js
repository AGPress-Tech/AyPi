const config = require('../config');
const storage = require('../storage');
const state = require('../state');
const { logEvent } = require('../utils/log');
const { isValidRoleName, encodeRole } = require('../utils/roles');
const { safeReply } = require('../utils/telegram');
const { isAuthorized, canRole } = require('../utils/auth');
const menu = require('../menu');

function registerText(bot) {
  bot.on('text', async (ctx) => {
    const text = ctx.message && ctx.message.text;
    if (text && text.trim().startsWith('/')) return;
    const requesterId = ctx.chat.id;
    const cleaned = text.trim().toLowerCase();
    if (!isAuthorized(ctx) && state.pendingAutoRegisterByChat.has(requesterId)) {
      if (cleaned === 'si' || cleaned === 'sì') {
        state.pendingAutoRegisterByChat.delete(requesterId);
        state.pendingRegisterByChat.set(requesterId, true);
        return menu.replyAndRefresh(
          ctx,
          'Inserisci il tuo Nome e Cognome con iniziali maiuscole (es: Mario Rossi).'
        );
      }
    }

    const pendingTicket = state.pendingTicketCreateByChat.get(requesterId);
    if (pendingTicket && pendingTicket.step === 'description') {
      if (!isAuthorized(ctx)) {
        state.pendingTicketCreateByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Non autorizzato.');
      }
      if (!canRole(ctx, 'use_ticket')) {
        state.pendingTicketCreateByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Permesso negato per AyPi Ticket.');
      }
      const desc = text.trim();
      if (!desc) {
        return menu.replyAndRefresh(ctx, 'Descrizione vuota. Scrivi il problema e invia il messaggio.');
      }
      const { createTicketFromPending } = require('./aypi');
      const result = createTicketFromPending(ctx, pendingTicket, desc);
      state.pendingTicketCreateByChat.delete(requesterId);
      if (result && result.error) {
        return menu.replyAndRefresh(ctx, result.error);
      }
      const id = result && result.id ? result.id : 'n/a';
      logEvent('aypi_ticket_created', ctx, `id=${id}`);
      return menu.replyAndRefresh(ctx, `Ticket creato: ${id}`);
    }

    const pendingEdit = state.pendingTicketEditByChat.get(requesterId);
    if (pendingEdit && pendingEdit.step === 'value' && pendingEdit.field === 'description') {
      if (!isAuthorized(ctx)) {
        state.pendingTicketEditByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Non autorizzato.');
      }
      if (!canRole(ctx, 'ticket_edit')) {
        state.pendingTicketEditByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Permesso negato per la modifica.');
      }
      const desc = text.trim();
      if (!desc) {
        return menu.replyAndRefresh(ctx, 'Descrizione vuota. Invia un testo valido.');
      }
      const { updateTicketDescription } = require('./aypi');
      if (!updateTicketDescription) {
        state.pendingTicketEditByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Aggiornamento non disponibile.');
      }
      const result = updateTicketDescription(ctx, pendingEdit.ticketId, desc, pendingEdit.ticketFile);
      state.pendingTicketEditByChat.delete(requesterId);
      if (result && result.error) return menu.replyAndRefresh(ctx, result.error);
      return menu.replyAndRefresh(ctx, `Ticket aggiornato: ${pendingEdit.ticketId}`);
    }

    const pendingStatus = state.pendingTicketStatusByChat.get(requesterId);
    if (pendingStatus && pendingStatus.step === 'note') {
      if (!isAuthorized(ctx)) {
        state.pendingTicketStatusByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Non autorizzato.');
      }
      if (!canRole(ctx, 'ticket_status')) {
        state.pendingTicketStatusByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Permesso negato per cambio stato.');
      }
      const note = text.trim();
      if (!note) {
        return menu.replyAndRefresh(ctx, 'Nota vuota. Invia un testo valido.');
      }
      const { updateTicketStatus } = require('./aypi');
      if (!updateTicketStatus) {
        state.pendingTicketStatusByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, 'Aggiornamento non disponibile.');
      }
      const result = updateTicketStatus(
        ctx,
        pendingStatus.ticketId,
        pendingStatus.toStatus,
        note,
        pendingStatus.ticketFile
      );
      state.pendingTicketStatusByChat.delete(requesterId);
      if (result && result.error) return menu.replyAndRefresh(ctx, result.error);
      return menu.replyAndRefresh(ctx, `Stato aggiornato: ${pendingStatus.ticketId}`);
    }

    const pendingId = state.pendingOwnerByChat.get(requesterId);
    if (pendingId) {
      logEvent('owner_name_input', ctx, `target=${pendingId}`);
      const name = text.trim();
      const valid = /^([A-ZÀ-Ü][\p{L}'-]+)(\s+[A-ZÀ-Ü][\p{L}'-]+)+$/u.test(name);
      if (!valid) {
        logEvent('owner_name_invalid', ctx, `value="${name}"`);
        return menu.replyAndRefresh(
          ctx,
          'Formato non valido. Invia Nome e Cognome con iniziali maiuscole (es: Mario Rossi).'
        );
      }
      const owners = storage.loadOwners();
      owners[String(pendingId)] = name;
      storage.saveOwners(owners);
      state.pendingOwnerByChat.delete(requesterId);
      logEvent('owner_name_saved', ctx, `target=${pendingId} name="${name}"`);
      return menu.replyAndRefresh(ctx, `Associato: ${name} -> ${pendingId}`);
    }

    const topAbs = state.topAbsencesByChat.get(requesterId);
    if (topAbs && topAbs.waitingFor) {
      const val = text.trim();
      const match = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) {
        return menu.replyAndRefresh(ctx, 'Formato non valido. Usa GG/MM/AAAA.');
      }
      const d = Number(match[1]);
      const m = Number(match[2]);
      const y = Number(match[3]);
      if (!d || !m || m < 1 || m > 12 || d < 1 || d > 31) {
        return menu.replyAndRefresh(ctx, 'Data non valida.');
      }
      const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (topAbs.waitingFor === 'start') topAbs.startDate = iso;
      if (topAbs.waitingFor === 'end') topAbs.endDate = iso;
      topAbs.waitingFor = null;
      state.topAbsencesByChat.set(requesterId, topAbs);
      return require('./core').__sendTopAbsMenu(ctx, topAbs);
    }

    const pendingRole = state.pendingRoleByChat.get(requesterId);
    if (pendingRole) {
      const name = text.trim();
      if (!isValidRoleName(name)) return menu.replyAndRefresh(ctx, 'Nome non valido.');
      const rolesList = storage.loadRoleList();
      if (pendingRole.mode === 'create') {
        if (rolesList.includes(name)) {
          return menu.replyAndRefresh(ctx, 'Esiste gia un ruolo con questo nome.');
        }
        storage.saveRoleList([...rolesList, name]);
        state.pendingRoleByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, `Ruolo creato: ${name}`);
      }
      if (pendingRole.mode === 'rename') {
        if (pendingRole.from === config.defaultRoleName) {
          return menu.replyAndRefresh(ctx, 'Non puoi rinominare il ruolo Owner.');
        }
        if (rolesList.includes(name)) {
          return menu.replyAndRefresh(ctx, 'Esiste gia un ruolo con questo nome.');
        }
        const updated = rolesList.map((r) => (r === pendingRole.from ? name : r));
        storage.saveRoleList(updated);
        const roles = storage.loadRoles();
        Object.keys(roles).forEach((id) => {
          if (roles[id] === pendingRole.from) roles[id] = name;
        });
        storage.saveRoles(roles);
        state.pendingRoleByChat.delete(requesterId);
        return menu.replyAndRefresh(ctx, `Ruolo rinominato: ${pendingRole.from} -> ${name}`);
      }
    }

    const pendingUser = state.pendingUserByChat.get(requesterId);
    if (pendingUser && pendingUser.mode === 'rename') {
      const name = text.trim();
      const valid = /^([A-ZÀ-Ü][\p{L}'-]+)(\s+[A-ZÀ-Ü][\p{L}'-]+)+$/u.test(name);
      if (!valid) {
        return menu.replyAndRefresh(
          ctx,
          'Formato non valido. Invia Nome e Cognome con iniziali maiuscole (es: Mario Rossi).'
        );
      }
      const owners = storage.loadOwners();
      owners[String(pendingUser.id)] = name;
      storage.saveOwners(owners);
      state.pendingUserByChat.delete(requesterId);
      return menu.replyAndRefresh(ctx, `Nome aggiornato: ${name}`);
    }

    const pendingRegister = state.pendingRegisterByChat.get(requesterId);
    if (pendingRegister) {
      const name = text.trim();
      const valid = /^([A-ZÀ-Ü][\p{L}'-]+)(\s+[A-ZÀ-Ü][\p{L}'-]+)+$/u.test(name);
      if (!valid) {
        return menu.replyAndRefresh(
          ctx,
          'Formato non valido. Invia Nome e Cognome con iniziali maiuscole (es: Mario Rossi).'
        );
      }
      state.pendingRegisterByChat.delete(requesterId);
      menu.replyAndRefresh(ctx, 'Richiesta di registrazione avviata!');
      const owners = storage.loadOwners();
      const ownerEntry = Object.entries(owners).find(([, n]) => n === config.defaultOwnerName);
      if (!ownerEntry) {
        console.warn('Owner not found for registration notification.');
        return safeReply(ctx, 'Nessun Owner configurato per approvare la richiesta.');
      }
      const [ownerId] = ownerEntry;
      const msg = `Registrazione richiesta:\nNome: ${name}\nID: ${requesterId}`;
      return ctx.telegram.sendMessage(Number(ownerId), msg, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Accetta', callback_data: `register:approve:${requesterId}:${encodeRole(name)}`, style: 'success' },
              { text: 'Rifiuta', callback_data: `register:reject:${requesterId}`, style: 'danger' },
            ],
          ],
        },
      });
    }

    const pendingJump = state.pendingCalendarJumpByChat.get(requesterId);
    if (pendingJump) {
      const val = text.trim();
      const match = val.match(/^(\d{1,2})\/(\d{4})$/);
      if (!match) {
        return menu.replyAndRefresh(ctx, 'Formato non valido. Usa MM/YYYY (es. 05/2026).');
      }
      const mNum = Number(match[1]);
      if (!Number.isFinite(mNum) || mNum < 1 || mNum > 12) {
        return menu.replyAndRefresh(ctx, 'Formato non valido. Usa MM/YYYY (es. 05/2026).');
      }
      const mm = String(mNum).padStart(2, '0');
      const yyyy = match[2];
      state.pendingCalendarJumpByChat.delete(requesterId);
      const monthKey = `${yyyy}-${mm}`;
      const { getVisibleDayHighlights } = require('./aypi');
      const highlights = getVisibleDayHighlights(ctx, monthKey);
      return menu.sendAyPiCalendarMonth(ctx, monthKey, highlights);
    }

    const normalizeGreeting = (s) =>
      s
        .toLowerCase()
        .replace(/[!?.:,;]+/g, '')
        .replace(/(\p{L})\1+/gu, '$1')
        .trim();
    const dict = storage.loadDictionary();
    const greetings = Array.isArray(dict.greetings)
      ? dict.greetings.map((g) => normalizeGreeting(String(g))).filter(Boolean)
      : ['ciao', 'ciao!', 'buongiorno', 'salve', 'hey', 'hola', 'hello'].map(normalizeGreeting);
    const normalized = normalizeGreeting(cleaned);
    if (greetings.includes(normalized)) {
      const owners = storage.loadOwners();
      const fullName = owners[String(ctx.chat.id)] || ctx?.from?.first_name || 'Operatore';
      const name = String(fullName).split(/\s+/)[0] || fullName;
      const { Markup } = require('telegraf');
      return menu.replyAndRefresh(
        ctx,
        `Buongiorno ${name}, come posso esserti utile?`,
        Markup.keyboard([['AyPi Calendar']]).resize().persistent()
      );
    }
    const helpTriggers = Array.isArray(dict.helpTriggers)
      ? dict.helpTriggers.map((h) => normalizeGreeting(String(h))).filter(Boolean)
      : [];
    if (normalized.includes('calendario')) {
      if (!canRole(ctx, 'use_aypi')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
      return menu.sendAyPiCalendarMenu(ctx);
    }
    if (helpTriggers.some((t) => normalized.includes(t))) {
      const lines = [
        '/start: avvia il bot',
        '/help: mostra questo aiuto',
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
        '/topabsences: top assenze periodo',
        '/ping: verifica che il bot risponda',
      ];
      const { Markup } = require('telegraf');
      return menu.replyAndRefresh(ctx, lines.join('\n'), Markup.keyboard([['AyPi Calendar']]).resize().persistent());
    }
    if (text.trim() === '❌ Chiudi') {
      const { Markup } = require('telegraf');
      return menu.replyAndRefresh(ctx, 'Ok.', Markup.keyboard([['AyPi Calendar']]).resize().persistent());
    }
    if (isAuthorized(ctx)) {
      if (cleaned === 'aypi calendar') {
        if (!canRole(ctx, 'use_aypi')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
        return menu.sendAyPiCalendarMenu(ctx);
      }
      if (cleaned === 'dice roll') {
        if (!canRole(ctx, 'use_diceroll')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
        try {
          const msg = await ctx.telegram.sendDice(ctx.chat.id);
          require('../utils/telegram').recordBotMessage(ctx.chat && ctx.chat.id, msg && msg.message_id);
        } catch {}
        return;
      }
      if (cleaned === 'listids') {
        if (!canRole(ctx, 'use_listids')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
        return menu.sendListMenu(ctx);
      }
      if (cleaned === 'ranks') {
        if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
        return menu.sendRanksMainMenu(ctx);
      }
      if (cleaned === 'logs') {
        if (!canRole(ctx, 'use_logs')) return menu.replyAndRefresh(ctx, 'Permesso negato per /logs.');
        try {
          const fs = require('fs');
          if (!fs.existsSync(config.logFile)) return menu.replyAndRefresh(ctx, 'Nessun log disponibile.');
          const raw = fs.readFileSync(config.logFile, 'utf8');
          const lines = raw.trim().split(/\r?\n/).filter(Boolean);
          const last = lines.slice(-10);
          return menu.replyAndRefresh(ctx, `Ultimi 10 eventi:\n${last.join('\n')}`);
        } catch (err) {
          console.error('Failed to read log file:', err.message);
          return menu.replyAndRefresh(ctx, 'Errore nella lettura dei log.');
        }
      }
      if (cleaned === '/help' || cleaned === 'help') {
        const lines = [
          '/start: avvia il bot',
          '/help: mostra questo aiuto',
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
          '/topabsences: top assenze periodo',
          '/ping: verifica che il bot risponda',
        ];
        return menu.replyAndRefresh(ctx, lines.join('\n'));
      }
    }

    logEvent('free_text', ctx, `value="${text}"`);
    const { Markup } = require('telegraf');
    menu.replyAndRefresh(
      ctx,
      'Non sono ancora stato programmato per conversazioni umane. Per ora, puoi usare i comandi dal menu per comunicare con me.',
      Markup.keyboard([['AyPi Calendar']]).resize().persistent()
    );
  });
}

module.exports = registerText;
