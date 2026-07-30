const config = require('../config');
const storage = require('../storage');
const state = require('../state');
const { logEvent } = require('../utils/log');
const { isOwnerUser } = require('../utils/auth');
const { encodeRole, decodeRole } = require('../utils/roles');
const { safeReply, safeAnswerCbQuery, recordBotMessage } = require('../utils/telegram');
const menu = require('../menu');

function registerRegister(bot) {
  bot.command('register', (ctx) => {
    logEvent('register', ctx);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.has(requesterId)) {
      return menu.replyAndRefresh(ctx, 'Sei già registrato. Non è necessario ripetere la richiesta.');
    }
    state.pendingRegisterByChat.set(ctx.chat.id, true);
    menu.replyAndRefresh(
      ctx,
      'Inserisci il tuo Nome e Cognome con iniziali maiuscole (es: Mario Rossi).'
    );
  });

  bot.action(/register:approve:(\d+):(.+)/, (ctx) => {
    const userId = ctx.match[1];
    const name = decodeRole(ctx.match[2]);
    logEvent('register_approve', ctx, `user=${userId} name=${name}`);
    safeAnswerCbQuery(ctx);
    if (!isOwnerUser(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    const allowed = storage.loadAllowedIds();
    allowed.add(Number(userId));
    storage.saveAllowedIds(allowed);
    state.allowedIds.add(Number(userId));
    const owners = storage.loadOwners();
    owners[String(userId)] = name;
    storage.saveOwners(owners);
    const roles = storage.loadRoles();
    roles[String(userId)] = config.defaultOperatorRole;
    storage.saveRoles(roles);
    ctx.telegram
      .sendMessage(Number(userId), "La tua registrazione e' stata approvata.")
      .then((msg) => recordBotMessage(Number(userId), msg && msg.message_id))
      .catch(() => {});
    return menu.replyAndRefresh(ctx, `Registrazione approvata: ${name}`);
  });

  bot.action(/register:reject:(\d+)/, (ctx) => {
    const userId = ctx.match[1];
    logEvent('register_reject', ctx, `user=${userId}`);
    safeAnswerCbQuery(ctx);
    if (!isOwnerUser(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    ctx.telegram
      .sendMessage(Number(userId), "La tua registrazione e' stata rifiutata.")
      .then((msg) => recordBotMessage(Number(userId), msg && msg.message_id))
      .catch(() => {});
    return menu.replyAndRefresh(ctx, `Registrazione rifiutata per ID ${userId}.`);
  });
}

module.exports = registerRegister;
