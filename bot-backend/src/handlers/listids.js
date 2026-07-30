const storage = require('../storage');
const state = require('../state');
const { logEvent } = require('../utils/log');
const { canRole } = require('../utils/auth');
const { safeReply, safeEdit, safeAnswerCbQuery } = require('../utils/telegram');
const menu = require('../menu');

function registerListids(bot) {
  bot.command('listids', (ctx) => {
    logEvent('listids', ctx);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.size > 0 && !state.allowedIds.has(requesterId)) {
      logEvent('listids_denied', ctx);
      return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_listids')) return menu.replyAndRefresh(ctx, 'Permesso negato per /listids.');
    const current = storage.loadAllowedIds();
    const list = [...current].sort((a, b) => a - b);
    if (list.length === 0) return menu.replyAndRefresh(ctx, 'Nessun ID autorizzato.');
    return menu.sendListMenu(ctx);
  });

  bot.action('listids:exit', (ctx) => {
    logEvent('listids_exit', ctx);
    safeAnswerCbQuery(ctx);
    const chatId = ctx.chat.id;
    state.lastMenuByChat.delete(chatId);
    state.menuMessageByChat.delete(chatId);
    return ctx.deleteMessage();
  });

  bot.action('listids:back', (ctx) => {
    logEvent('listids_back', ctx);
    safeAnswerCbQuery(ctx);
    return menu.sendListMenu(ctx);
  });

  bot.action(/listid:(\d+)/, (ctx) => {
    logEvent('listid_select', ctx, `target=${ctx.match[1]}`);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.size > 0 && !state.allowedIds.has(requesterId)) {
      safeAnswerCbQuery(ctx);
      logEvent('listid_select_denied', ctx);
      return safeReply(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_listids')) {
      safeAnswerCbQuery(ctx);
      return safeReply(ctx, 'Permesso negato.');
    }
    const targetId = Number(ctx.match[1]);
    const owners = storage.loadOwners();
    const hasOwner = Boolean(owners[String(targetId)]);
    safeAnswerCbQuery(ctx);
    const actionRows = [];
    if (!hasOwner) {
      actionRows.push([{ text: 'Assegna Proprietario', callback_data: `owner:assign:${targetId}` }]);
    } else {
      actionRows.push([{ text: 'Modifica Proprietario', callback_data: `owner:modify:${targetId}` }]);
      actionRows.push([{ text: 'Rimuovi Proprietario', callback_data: `owner:remove:${targetId}` }]);
    }
    actionRows.push([{ text: 'Rimuovi ID', callback_data: `listids:remove:${targetId}`, style: 'danger' }]);
    actionRows.push([{ text: 'Indietro', callback_data: 'listids:back' }]);
    return safeEdit(ctx, `ID selezionato: ${targetId}\nScegli un'azione:`, {
      reply_markup: { inline_keyboard: actionRows },
    });
  });

  bot.action(/listids:remove:(\d+)/, (ctx) => {
    const targetId = ctx.match[1];
    logEvent('listids_remove_confirm', ctx, `target=${targetId}`);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.size > 0 && !state.allowedIds.has(requesterId)) {
      safeAnswerCbQuery(ctx);
      return safeReply(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_listids')) {
      safeAnswerCbQuery(ctx);
      return safeReply(ctx, 'Permesso negato.');
    }
    safeAnswerCbQuery(ctx);
    return safeEdit(ctx, `Confermi la rimozione dell'ID ${targetId}?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'SI', callback_data: `listids:remove:yes:${targetId}`, style: 'success' },
            { text: 'NO', callback_data: `listids:remove:no:${targetId}`, style: 'danger' },
          ],
        ],
      },
    });
  });

  bot.action(/listids:remove:yes:(\d+)/, (ctx) => {
    const targetId = ctx.match[1];
    logEvent('listids_remove_yes', ctx, `target=${targetId}`);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.size > 0 && !state.allowedIds.has(requesterId)) {
      safeAnswerCbQuery(ctx);
      return safeReply(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_listids')) {
      safeAnswerCbQuery(ctx);
      return safeReply(ctx, 'Permesso negato.');
    }
    const allowed = storage.loadAllowedIds();
    allowed.delete(Number(targetId));
    storage.saveAllowedIds(allowed);
    state.allowedIds.delete(Number(targetId));
    const owners = storage.loadOwners();
    delete owners[String(targetId)];
    storage.saveOwners(owners);
    const roles = storage.loadRoles();
    delete roles[String(targetId)];
    storage.saveRoles(roles);
    safeAnswerCbQuery(ctx);
    return menu.replyAndRefresh(ctx, `ID rimosso: ${targetId}`);
  });

  bot.action(/listids:remove:no:(\d+)/, (ctx) => {
    const targetId = ctx.match[1];
    logEvent('listids_remove_no', ctx, `target=${targetId}`);
    safeAnswerCbQuery(ctx);
    return menu.replyAndRefresh(ctx, `Rimozione annullata per ID ${targetId}.`);
  });

  // Owner assignment
  bot.action(/owner:(assign|modify):(\d+)/, (ctx) => {
    logEvent('owner_assign_or_modify', ctx, `mode=${ctx.match[1]} target=${ctx.match[2]}`);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.size > 0 && !state.allowedIds.has(requesterId)) {
      safeAnswerCbQuery(ctx);
      logEvent('owner_assign_or_modify_denied', ctx);
      return safeReply(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_listids')) {
      safeAnswerCbQuery(ctx);
      return safeReply(ctx, 'Permesso negato.');
    }
    const targetId = Number(ctx.match[2]);
    state.pendingOwnerByChat.set(requesterId, targetId);
    safeAnswerCbQuery(ctx);
    return safeEdit(ctx, `Invia ora Nome e Cognome per l'ID ${targetId} (es: Mario Rossi).`, {
      reply_markup: { inline_keyboard: [[{ text: 'Annulla', callback_data: 'owner:cancel' }]] },
    });
  });

  bot.action('owner:cancel', (ctx) => {
    logEvent('owner_cancel', ctx);
    const requesterId = ctx.chat.id;
    state.pendingOwnerByChat.delete(requesterId);
    safeAnswerCbQuery(ctx);
    return safeEdit(ctx, 'Operazione annullata.', {
      reply_markup: { inline_keyboard: [[{ text: 'Indietro', callback_data: 'listids:back' }]] },
    });
  });

  bot.action(/owner:remove:(\d+)/, (ctx) => {
    logEvent('owner_remove', ctx, `target=${ctx.match[1]}`);
    const requesterId = ctx.chat.id;
    if (state.allowedIds.size > 0 && !state.allowedIds.has(requesterId)) {
      safeAnswerCbQuery(ctx);
      logEvent('owner_remove_denied', ctx);
      return safeReply(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_listids')) {
      safeAnswerCbQuery(ctx);
      return safeReply(ctx, 'Permesso negato.');
    }
    const targetId = Number(ctx.match[1]);
    const owners = storage.loadOwners();
    delete owners[String(targetId)];
    storage.saveOwners(owners);
    safeAnswerCbQuery(ctx);
    return safeEdit(ctx, `Rimosso proprietario per ID ${targetId}.`, {
      reply_markup: { inline_keyboard: [[{ text: 'Indietro', callback_data: 'listids:back' }]] },
    });
  });
}

module.exports = registerListids;

