const { loadAllowedIds, loadBotMessages } = require('./storage');

const config = require('./config');
const allowedIds = loadAllowedIds();
if (allowedIds.size === 0) {
  console.warn(
    config.allowOpenAccess
      ? 'Warning: No allowed IDs configured. Explicit open access is enabled.'
      : 'Warning: No allowed IDs configured. Bot access is locked pending registration.'
  );
}

const pendingOwnerByChat = new Map();
const pendingRoleByChat = new Map();
const pendingUserByChat = new Map();
const pendingRegisterByChat = new Map();
const pendingCalendarJumpByChat = new Map();
const calendarReqsStateByChat = new Map();
const calendarClosuresFiltersByChat = new Map();
const ticketListStateByChat = new Map();
const pendingTicketCreateByChat = new Map();
const pendingTicketStatusByChat = new Map();
const pendingTicketEditByChat = new Map();
const pendingTicketDeleteByChat = new Map();
const topAbsencesByChat = new Map();
const pendingAutoRegisterByChat = new Map();
const startedByChat = new Map();

const lastMenuByChat = new Map();
const menuMessageByChat = new Map();
const calendarHighlightsByChat = new Map();
const botMessagesByChat = new Map();

const stored = loadBotMessages();
Object.keys(stored).forEach((chatId) => {
  const list = Array.isArray(stored[chatId]) ? stored[chatId] : [];
  botMessagesByChat.set(Number(chatId), list.filter((n) => Number.isFinite(n)));
});

module.exports = {
  allowedIds,
  pendingOwnerByChat,
  pendingRoleByChat,
  pendingUserByChat,
  pendingRegisterByChat,
  pendingAutoRegisterByChat,
  startedByChat,
  pendingCalendarJumpByChat,
  calendarReqsStateByChat,
  calendarClosuresFiltersByChat,
  ticketListStateByChat,
  pendingTicketCreateByChat,
  pendingTicketStatusByChat,
  pendingTicketEditByChat,
  pendingTicketDeleteByChat,
  topAbsencesByChat,
  lastMenuByChat,
  menuMessageByChat,
  calendarHighlightsByChat,
  botMessagesByChat,
};

