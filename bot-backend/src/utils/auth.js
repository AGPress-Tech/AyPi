const { loadOwners, loadRoles, getRolePerms } = require('../storage');
const config = require('../config');
const { allowedIds } = require('../state');

function isAuthorized(ctx) {
  if (allowedIds.size === 0) return config.allowOpenAccess;
  const chatId = ctx?.chat?.id;
  return allowedIds.has(chatId);
}

function isOwnerUser(ctx) {
  const chatId = ctx?.chat?.id;
  if (!chatId) return false;
  const owners = loadOwners();
  const name = owners[String(chatId)];
  if (name && name === config.defaultOwnerName) return true;
  const roles = loadRoles();
  return roles[String(chatId)] === config.defaultRoleName;
}

function isAdminUser(ctx) {
  if (isOwnerUser(ctx)) return true;
  const chatId = ctx?.chat?.id;
  if (!chatId) return false;
  const roles = loadRoles();
  return String(roles[String(chatId)] || '').toLowerCase() === 'admin';
}

function canRole(ctx, permKey) {
  const chatId = ctx?.chat?.id;
  if (!chatId) return false;
  if (isOwnerUser(ctx)) return true;
  const roles = loadRoles();
  const roleName = roles[String(chatId)] || 'Senza ruolo';
  const perms = getRolePerms(roleName);
  return Boolean(perms[permKey]);
}

module.exports = { isAuthorized, isOwnerUser, isAdminUser, canRole };
