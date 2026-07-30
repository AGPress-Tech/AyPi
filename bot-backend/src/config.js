const path = require('path');

const os = require('os');

const botDataDir =
  process.env.AYPI_BOT_DATA_DIR ||
  '\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\AyPiZoea';
const botCacheDir =
  process.env.AYPI_BOT_CACHE_DIR ||
  path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'AyPiBotBackend', 'cache');
const backendBaseUrl = String(
  process.env.AYPI_BACKEND_URL || 'http://127.0.0.1:3000'
).replace(/\/+$/, '');
const allowOpenAccess =
  String(process.env.AYPI_BOT_ALLOW_OPEN_ACCESS || '').trim() === '1';

const allowedFile = process.env.ADMIN_IDS_FILE || path.join(botDataDir, 'allowed.json');
const ownersFile = process.env.OWNERS_FILE || path.join(botDataDir, 'owners.json');
const logFile = process.env.LOG_FILE || path.join(botDataDir, 'bot.log');
const rolesFile = process.env.ROLES_FILE || path.join(botDataDir, 'roles.json');
const rolesListFile = process.env.ROLES_LIST_FILE || path.join(botDataDir, 'roles_list.json');
const rolesPermsFile = process.env.ROLES_PERMS_FILE || path.join(botDataDir, 'roles_perms.json');
const botMessagesFile = process.env.BOT_MESSAGES_FILE || path.join(botDataDir, 'bot_messages.json');
const calendarPendingFile =
  process.env.AYPI_CALENDAR_PENDING_FILE ||
  path.join(botCacheDir, 'calendar', 'Calendar Years', `requests-${new Date().getFullYear()}.json`);
const calendarConfigFile =
  process.env.AYPI_CALENDAR_CONFIG_FILE ||
  path.join(botCacheDir, 'calendar', 'config-calendar.json');
const calendarBalancesFile =
  process.env.AYPI_CALENDAR_BALANCES_FILE ||
  path.join(botCacheDir, 'calendar', 'ferie-permessi-balances.json');
const calendarClosuresFile =
  process.env.AYPI_CALENDAR_CLOSURES_FILE ||
  path.join(botCacheDir, 'calendar', 'ferie-permessi-closures.json');
const calendarHolidaysFile =
  process.env.AYPI_CALENDAR_HOLIDAYS_FILE ||
  path.join(botCacheDir, 'calendar', 'ferie-permessi-holidays.json');
const userLocationsFile =
  process.env.USER_LOCATIONS_FILE ||
  path.join(botDataDir, 'user_locations.json');
const dictionaryFile =
  process.env.DICTIONARY_FILE || path.join(botDataDir, 'dictionary.json');
const assigneesFile =
  process.env.AYPI_ASSIGNEES_FILE ||
  path.join(botCacheDir, 'shared', 'amministrazione-assignees.json');
const heartbeatDir =
  process.env.HEARTBEAT_DIR || path.join(botCacheDir, 'runtime');
const heartbeatFile =
  process.env.HEARTBEAT_FILE || path.join(heartbeatDir, 'bot_heartbeat.txt');
const heartbeatIntervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS || 30000);
const heartbeatEnabled =
  String(process.env.AYPI_BOT_HEARTBEAT_ENABLED || '').trim() === '1';
const weatherAllowInsecureTls = String(process.env.WEATHER_ALLOW_INSECURE_TLS || '').trim() === '1';
const weatherApiKey = String(process.env.WEATHERAPI_KEY || '').trim();
const weatherApiBaseUrl = String(process.env.WEATHERAPI_BASE_URL || 'https://api.weatherapi.com/v1').trim();

const ticketBaseDir = process.env.AYPI_FP_BASE_DIR || botCacheDir;
const ticketDir = ticketBaseDir ? path.join(ticketBaseDir, 'AyPi Ticket') : '';
const ticketYearsDir = ticketDir ? path.join(ticketDir, 'Ticket Years') : '';
const ticketCategoriesPath = ticketDir ? path.join(ticketDir, 'ticket-categories.json') : '';
const ticketBackupDir = ticketBaseDir ? path.join(ticketBaseDir, 'Backup Ticket') : '';

const defaultOwnerName = 'Ayrton Pizzi';
const defaultRoleName = 'Owner';
const defaultOperatorRole = 'Operatore';

const permissions = [
  { key: 'approve_registration', label: 'Conferma ID' },
  { key: 'modify_owner', label: 'Modifica Owner' },
  { key: 'use_logs', label: 'Usa /logs' },
  { key: 'use_aypi', label: 'Usa /aypi' },
  { key: 'use_ticket', label: 'AyPi Ticket: accesso' },
  { key: 'ticket_list_mine', label: 'AyPi Ticket: lista miei ticket' },
  { key: 'ticket_list_all', label: 'AyPi Ticket: lista tutti' },
  { key: 'ticket_view_history', label: 'AyPi Ticket: storico' },
  { key: 'ticket_edit', label: 'AyPi Ticket: modifica' },
  { key: 'ticket_status', label: 'AyPi Ticket: cambio stato' },
  { key: 'ticket_delete', label: 'AyPi Ticket: elimina' },
  { key: 'use_listids', label: 'Usa /listids' },
  { key: 'use_ranks', label: 'Usa /ranks' },
  { key: 'use_clean', label: 'Usa /clean' },
  { key: 'use_ping', label: 'Usa /ping' },
  { key: 'use_diceroll', label: 'Usa /diceroll' },
  { key: 'use_qr', label: 'Usa /qr' },
  { key: 'use_today', label: 'Usa /today' },
  { key: 'use_nextclosure', label: 'Usa /nextclosure' },
  { key: 'calendar_pending', label: 'Calendario: richieste in attesa' },
  { key: 'top_absences', label: 'Top assenze' },
];

const restrictedPerms = ['approve_registration', 'modify_owner', 'top_absences', 'ticket_list_all'];

module.exports = {
  botDataDir,
  botCacheDir,
  backendBaseUrl,
  allowOpenAccess,
  allowedFile,
  ownersFile,
  logFile,
  rolesFile,
  rolesListFile,
  rolesPermsFile,
  botMessagesFile,
  calendarPendingFile,
  calendarConfigFile,
  calendarBalancesFile,
  calendarClosuresFile,
  calendarHolidaysFile,
  userLocationsFile,
  dictionaryFile,
  assigneesFile,
  heartbeatFile,
  heartbeatIntervalMs,
  heartbeatEnabled,
  weatherAllowInsecureTls,
  weatherApiKey,
  weatherApiBaseUrl,
  ticketBaseDir,
  ticketDir,
  ticketYearsDir,
  ticketCategoriesPath,
  ticketBackupDir,
  defaultOwnerName,
  defaultRoleName,
  defaultOperatorRole,
  permissions,
  restrictedPerms,
};
