require('dotenv').config();
const { Telegraf } = require('telegraf');

const config = require('./config');
const storage = require('./storage');
const state = require('./state');

const registerCore = require('./handlers/core');
const registerListids = require('./handlers/listids');
const registerRanks = require('./handlers/ranks');
const registerRegister = require('./handlers/register');
const registerAyPi = require('./handlers/aypi');
const registerText = require('./handlers/text');
const { logEvent } = require('./utils/log');
const { __sendStartWelcome } = require('./handlers/core');
const { backendSyncMiddleware, pullBackendState } = require('./utils/backend-sync');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

const bot = new Telegraf(token);
bot.catch((err, ctx) => {
  const msg = err?.message || String(err);
  logEvent('bot_error', ctx, `reason="${msg}"`);
  console.error('Bot error:', msg);
});

bot.use(backendSyncMiddleware);

// Access control middleware (always allow /help and /register)
bot.use((ctx, next) => {
  const chatId = ctx.chat && ctx.chat.id;
  const text = ctx.message && ctx.message.text;
  if (chatId && !state.startedByChat.has(chatId) && text) {
    state.startedByChat.set(chatId, true);
    const t = text.trim().toLowerCase();
    if (!t.startsWith('/start')) {
      __sendStartWelcome(ctx);
    }
  }
  if (text) {
    const t = text.trim().toLowerCase();
    if (
      t.startsWith('/help') ||
      t.startsWith('/register') ||
      t.startsWith('/id') ||
      t.startsWith('/clean') ||
      t.startsWith('/start')
    )
      return next();
  }
  const cb = ctx.callbackQuery && ctx.callbackQuery.data;
  if (cb && cb.startsWith('help:')) return next();
  if (state.allowedIds.size === 0 && config.allowOpenAccess) return next();
  if (state.pendingRegisterByChat.has(chatId)) return next();
  if (state.pendingAutoRegisterByChat.has(chatId)) return next();
  if (state.allowedIds.has(chatId)) return next();
  // not authorized -> prompt registration
  if (text || cb) {
    const menu = require('./menu');
    state.pendingAutoRegisterByChat.set(chatId, true);
    menu.replyAndRefresh(
      ctx,
      'Per usare il bot devi richiedere la registrazione con /register. Se vuoi procedere, scrivi "si".'
    );
  }
});

registerCore(bot);
registerListids(bot);
registerRanks(bot);
registerRegister(bot);
registerAyPi(bot);
registerText(bot);

function notifyOwners(bot, message) {
  const owners = storage.loadOwners();
  const ownerIds = Object.entries(owners)
    .filter(([, name]) => name === config.defaultOwnerName)
    .map(([id]) => Number(id));
  if (!ownerIds.length) return Promise.resolve(null);
  return Promise.all(
    ownerIds.map((id) =>
      bot.telegram.sendMessage(id, message).catch((err) => {
        const msg = err?.message || String(err);
        logEvent('owner_notify_fail', { chat: { id } }, `reason="${msg}"`);
        return null;
      })
    )
  );
}

let launchPromise = null;
let running = false;

function startTelegramBot() {
  if (launchPromise) return launchPromise;
  launchPromise = pullBackendState()
  .catch((err) => {
    console.warn('[telegram-bot] Initial backend sync failed:', err.message);
  })
  .then(() => bot.launch())
  .then(() => storage.ensureDefaultOwner())
  .then(() => {
    if (!process.env.RESTART_REASON) return null;
    const reason = process.env.RESTART_REASON;
    let tail = '';
    try {
      const fs = require('fs');
      if (fs.existsSync(config.logFile)) {
        const raw = fs.readFileSync(config.logFile, 'utf8');
        const lines = raw.trim().split(/\r?\n/).filter(Boolean);
        const last = lines.slice(-10);
        if (last.length) tail = `\n\nUltimi 10 eventi:\n${last.join('\n')}`;
      }
    } catch {}
    const msg = `⚠️ Riavvio automatico del bot (${reason}).${tail}`;
    return notifyOwners(bot, msg);
  })
  .then(() => {
    const msg = '✅ Bot avviato e pronto all’uso.';
    return new Promise((resolve) => {
      setTimeout(() => resolve(notifyOwners(bot, msg)), 1000);
    });
  })
  .then(() =>
    bot.telegram.setMyCommands([
      { command: 'start', description: 'Avvia AyPiZoea' },
      { command: 'help', description: 'Mostra aiuto' },
      { command: 'id', description: 'Mostra il tuo chat ID' },
      { command: 'register', description: 'Richiedi registrazione' },
      { command: 'aypi', description: 'Menu AyPi' },
      { command: 'diceroll', description: 'Lancia un dado' },
      { command: 'qr', description: 'Genera un QR' },
      { command: 'today', description: 'Riepilogo di oggi' },
      { command: 'nextclosure', description: 'Prossima chiusura o festività' },
      { command: 'topabsences', description: 'Top assenze mese corrente' },
      { command: 'clean', description: 'Elimina messaggi del bot' },
      { command: 'ping', description: 'Verifica che AyPiZoea risponda' },
    ])
  )
  .then(() => {
    const operatorCommands = [
      { command: 'start', description: 'Avvia AyPiZoea' },
      { command: 'help', description: 'Mostra aiuto' },
      { command: 'id', description: 'Mostra il tuo chat ID' },
      { command: 'register', description: 'Richiedi registrazione' },
      { command: 'aypi', description: 'Menu AyPi' },
      { command: 'listids', description: 'Lista e gestione operatori' },
      { command: 'ranks', description: 'Ruoli e utenti' },
      { command: 'logs', description: 'Ultimi 10 eventi' },
      { command: 'diceroll', description: 'Lancia un dado' },
      { command: 'qr', description: 'Genera un QR' },
      { command: 'today', description: 'Riepilogo di oggi' },
      { command: 'nextclosure', description: 'Prossima chiusura o festività' },
      { command: 'topabsences', description: 'Top assenze mese corrente' },
      { command: 'clean', description: 'Elimina messaggi del bot' },
      { command: 'ping', description: 'Verifica che AyPiZoea risponda' },
    ];
    const owners = storage.loadOwners();
    const ownerIds = Object.entries(owners)
      .filter(([, name]) => name === config.defaultOwnerName)
      .map(([id]) => Number(id));
    return Promise.all(
      [...state.allowedIds].map((chatId) => {
        const cmds = ownerIds.includes(chatId)
          ? [
              ...operatorCommands,
              { command: 'allow', description: 'Autorizza un ID' },
              { command: 'maintenance_on', description: 'Avvia manutenzione (solo owner)' },
              { command: 'maintenance_off', description: 'Termina manutenzione (solo owner)' },
            ]
          : operatorCommands;
        return bot.telegram.setMyCommands(cmds, { scope: { type: 'chat', chat_id: chatId } });
      })
    );
  })
  .then(() => {
    running = true;
    console.log('Bot started');
    return bot;
  })
  .catch((err) => {
    launchPromise = null;
    running = false;
    console.error('Bot start error:', err.message);
    throw err;
  });
  return launchPromise;
}

function stopTelegramBot(reason = 'AyPi Backend shutdown') {
  if (!launchPromise && !running) return Promise.resolve();
  try {
    bot.stop(reason);
  } finally {
    launchPromise = null;
    running = false;
  }
  return Promise.resolve();
}

function getTelegramBotStatus() {
  return {
    enabled: true,
    running,
  };
}

if (require.main === module) {
  startTelegramBot().catch(() => {
    process.exitCode = 1;
  });
  process.once('SIGINT', () => stopTelegramBot('SIGINT'));
  process.once('SIGTERM', () => stopTelegramBot('SIGTERM'));
  process.on('unhandledRejection', (err) => {
    const msg = err?.message || String(err);
    logEvent('unhandled_rejection', null, `reason="${msg}"`);
    console.error('Unhandled rejection:', msg);
  });
  process.on('uncaughtException', (err) => {
    const msg = err?.message || String(err);
    logEvent('uncaught_exception', null, `reason="${msg}"`);
    console.error('Uncaught exception:', msg);
  });
}

module.exports = {
  startTelegramBot,
  stopTelegramBot,
  getTelegramBotStatus,
};
