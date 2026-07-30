const config = require('../config');
const storage = require('../storage');
const state = require('../state');
const { logEvent } = require('../utils/log');
const { isAuthorized, isOwnerUser, canRole } = require('../utils/auth');
const { safeAnswerCbQuery } = require('../utils/telegram');
const menu = require('../menu');
const { decodeRole, isValidRoleName } = require('../utils/roles');

function registerRanks(bot) {
  bot.command('ranks', (ctx) => {
    logEvent('ranks', ctx);
    if (!isAuthorized(ctx)) {
      logEvent('ranks_denied', ctx);
      return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    }
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato per /ranks.');
    storage.ensureDefaultOwner();
    return menu.sendRanksMainMenu(ctx);
  });

  bot.action('ranks:exit', (ctx) => {
    logEvent('ranks_exit', ctx);
    safeAnswerCbQuery(ctx);
    const chatId = ctx.chat.id;
    state.lastMenuByChat.delete(chatId);
    state.menuMessageByChat.delete(chatId);
    return ctx.deleteMessage();
  });

  bot.action('ranks:roles', (ctx) => {
    logEvent('ranks_roles', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    return menu.sendRanksRolesMenu(ctx);
  });

  bot.action('ranks:new', (ctx) => {
    logEvent('ranks_new', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    state.pendingRoleByChat.set(ctx.chat.id, { mode: 'create' });
    state.lastMenuByChat.set(ctx.chat.id, 'ranks-roles');
    return menu.sendMenuMessage(ctx, 'Inserisci il nome del nuovo rank:', {
      inline_keyboard: [[{ text: 'Annulla', callback_data: 'ranks:cancel' }]],
    });
  });

  bot.action('ranks:users', (ctx) => {
    logEvent('ranks_users', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    return menu.sendRanksUsersMenu(ctx);
  });

  bot.action('ranks:config', (ctx) => {
    logEvent('ranks_config', ctx);
    safeAnswerCbQuery(ctx);
    if (!isOwnerUser(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    storage.ensureDefaultOwner();
    return menu.sendRanksConfigMenu(ctx);
  });

  bot.action('ranks:back', (ctx) => {
    logEvent('ranks_back', ctx);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    return menu.sendRanksMainMenu(ctx);
  });

  bot.action(/ranks:role:(.+)/, (ctx) => {
    const roleName = ctx.match[1];
    logEvent('ranks_role', ctx, `role=${roleName}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    return menu.sendRanksRoleDetail(ctx, roleName);
  });

  bot.action(/ranks:config:role:(.+)/, (ctx) => {
    const roleName = decodeRole(ctx.match[1]);
    logEvent('ranks_config_role', ctx, `role=${roleName}`);
    safeAnswerCbQuery(ctx);
    if (!isOwnerUser(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    return menu.sendRanksConfigRole(ctx, roleName);
  });

  bot.action(/ranks:config:toggle:(.+):(.+)/, (ctx) => {
    const roleName = decodeRole(ctx.match[1]);
    const permKey = ctx.match[2];
    logEvent('ranks_config_toggle', ctx, `role=${roleName} perm=${permKey}`);
    safeAnswerCbQuery(ctx);
    if (!isOwnerUser(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (roleName === config.defaultRoleName) {
      return menu.replyAndRefresh(ctx, 'Owner non e configurabile.');
    }
    const perms = storage.getRolePerms(roleName);
    const next = !Boolean(perms[permKey]);
    storage.setRolePerm(roleName, permKey, next);
    state.lastMenuByChat.set(ctx.chat.id, `ranks-config-role:${roleName}`);
    return menu.replyAndRefresh(ctx, `Permesso aggiornato: ${permKey} = ${next ? 'ON' : 'OFF'}`);
  });

  bot.action(/ranks:rename:(.+)/, (ctx) => {
    const roleName = ctx.match[1];
    logEvent('ranks_rename', ctx, `role=${roleName}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    state.pendingRoleByChat.set(ctx.chat.id, { mode: 'rename', from: roleName });
    state.lastMenuByChat.set(ctx.chat.id, `ranks-role:${roleName}`);
    return menu.sendMenuMessage(ctx, `Inserisci il nuovo nome per "${roleName}":`, {
      inline_keyboard: [[{ text: 'Annulla', callback_data: 'ranks:cancel' }]],
    });
  });

  bot.action(/ranks:delete:(.+)/, (ctx) => {
    const roleName = ctx.match[1];
    logEvent('ranks_delete', ctx, `role=${roleName}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    if (roleName === config.defaultRoleName) {
      return menu.replyAndRefresh(ctx, 'Non puoi eliminare il ruolo Owner.');
    }
    const list = storage.loadRoleList().filter((r) => r !== roleName);
    storage.saveRoleList(list.length ? list : [config.defaultRoleName]);
    const roles = storage.loadRoles();
    Object.keys(roles).forEach((id) => {
      if (roles[id] === roleName) delete roles[id];
    });
    storage.saveRoles(roles);
    const perms = storage.loadRolePerms();
    if (perms[roleName]) {
      delete perms[roleName];
      storage.saveRolePerms(perms);
    }
    state.lastMenuByChat.set(ctx.chat.id, 'ranks-roles');
    return menu.replyAndRefresh(ctx, `Ruolo eliminato: ${roleName}`);
  });

  bot.action('ranks:cancel', (ctx) => {
    logEvent('ranks_cancel', ctx);
    safeAnswerCbQuery(ctx);
    state.pendingRoleByChat.delete(ctx.chat.id);
    return menu.replyAndRefresh(ctx, 'Operazione annullata.');
  });

  bot.action(/ranks:user:(\d+)/, (ctx) => {
    const userId = ctx.match[1];
    logEvent('ranks_user', ctx, `user=${userId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    return menu.sendRanksUserDetail(ctx, userId);
  });

  bot.action(/ranks:user:rename:(\d+)/, (ctx) => {
    const userId = ctx.match[1];
    logEvent('ranks_user_rename', ctx, `user=${userId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    state.pendingUserByChat.set(ctx.chat.id, { mode: 'rename', id: userId });
    state.lastMenuByChat.set(ctx.chat.id, `ranks-user:${userId}`);
    return menu.sendMenuMessage(ctx, `Inserisci il nuovo Nome Cognome per ID ${userId}:`, {
      inline_keyboard: [[{ text: 'Annulla', callback_data: 'ranks:user:cancel' }]],
    });
  });

  bot.action(/ranks:user:role:(\d+)/, (ctx) => {
    const userId = ctx.match[1];
    logEvent('ranks_user_role', ctx, `user=${userId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    return menu.sendRanksUserRoleMenu(ctx, userId);
  });

  bot.action(/ranks:user:rolepick:(\d+):(.+)/, (ctx) => {
    const userId = ctx.match[1];
    const roleName = decodeRole(ctx.match[2]);
    logEvent('ranks_user_rolepick', ctx, `user=${userId} role=${roleName}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const roles = storage.loadRoles();
    roles[userId] = roleName;
    storage.saveRoles(roles);
    state.lastMenuByChat.set(ctx.chat.id, `ranks-user:${userId}`);
    return menu.replyAndRefresh(ctx, `Ruolo aggiornato: ${roleName}`);
  });

  bot.action(/ranks:user:delete:(\d+)/, (ctx) => {
    const userId = ctx.match[1];
    logEvent('ranks_user_delete', ctx, `user=${userId}`);
    safeAnswerCbQuery(ctx);
    if (!isAuthorized(ctx)) return menu.replyAndRefresh(ctx, 'Non autorizzato.');
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    const allowed = storage.loadAllowedIds();
    allowed.delete(Number(userId));
    storage.saveAllowedIds(allowed);
    state.allowedIds.delete(Number(userId));
    const owners = storage.loadOwners();
    delete owners[String(userId)];
    storage.saveOwners(owners);
    const roles = storage.loadRoles();
    delete roles[String(userId)];
    storage.saveRoles(roles);
    return menu.replyAndRefresh(ctx, `Utente rimosso: ${userId}`);
  });

  bot.action('ranks:user:cancel', (ctx) => {
    logEvent('ranks_user_cancel', ctx);
    safeAnswerCbQuery(ctx);
    if (!canRole(ctx, 'use_ranks')) return menu.replyAndRefresh(ctx, 'Permesso negato.');
    state.pendingUserByChat.delete(ctx.chat.id);
    return menu.replyAndRefresh(ctx, 'Operazione annullata.');
  });
}

module.exports = registerRanks;

