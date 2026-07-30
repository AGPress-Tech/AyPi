const fs = require('fs');
const path = require('path');
const config = require('../config');

function loadAllowedIds() {
  try {
    if (!fs.existsSync(config.allowedFile)) return new Set();
    const raw = fs.readFileSync(config.allowedFile, 'utf8');
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch (err) {
      const trimmed = raw.trim();
      try {
        if (trimmed.startsWith('"')) {
          const inner = JSON.parse(trimmed);
          arr = JSON.parse(inner);
        } else {
          const start = trimmed.indexOf('[');
          const end = trimmed.lastIndexOf(']');
          if (start !== -1 && end !== -1 && end > start) {
            arr = JSON.parse(trimmed.slice(start, end + 1));
          } else {
            throw err;
          }
        }
      } catch {
        console.error('Failed to read allowed file:', err.message);
        console.error('Allowed file path:', config.allowedFile);
        console.error('Allowed file preview:', JSON.stringify(trimmed.slice(0, 200)));
        return new Set();
      }
    }
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
  } catch (err) {
    console.error('Failed to read allowed file:', err.message);
    return new Set();
  }
}

function saveAllowedIds(set) {
  try {
    const dir = path.dirname(config.allowedFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.allowedFile, JSON.stringify([...set], null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write allowed file:', err.message);
  }
}

function loadOwners() {
  try {
    if (!fs.existsSync(config.ownersFile)) return {};
    const raw = fs.readFileSync(config.ownersFile, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj;
  } catch (err) {
    console.error('Failed to read owners file:', err.message);
    return {};
  }
}

function saveOwners(obj) {
  try {
    const dir = path.dirname(config.ownersFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.ownersFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write owners file:', err.message);
  }
}

function loadRoles() {
  try {
    if (!fs.existsSync(config.rolesFile)) return {};
    const raw = fs.readFileSync(config.rolesFile, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj;
  } catch (err) {
    console.error('Failed to read roles file:', err.message);
    return {};
  }
}

function saveRoles(obj) {
  try {
    const dir = path.dirname(config.rolesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.rolesFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write roles file:', err.message);
  }
}

function loadRoleList() {
  try {
    if (!fs.existsSync(config.rolesListFile)) return [config.defaultRoleName];
    const raw = fs.readFileSync(config.rolesListFile, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [config.defaultRoleName];
    const list = arr.map((s) => String(s)).filter(Boolean);
    const withOwner = list.includes(config.defaultRoleName)
      ? list
      : [config.defaultRoleName, ...list];
    return withOwner;
  } catch (err) {
    console.error('Failed to read roles list:', err.message);
    return [config.defaultRoleName];
  }
}

function saveRoleList(arr) {
  try {
    const dir = path.dirname(config.rolesListFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.rolesListFile, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write roles list:', err.message);
  }
}

function ensureDefaultOwner() {
  const owners = loadOwners();
  const roles = loadRoles();
  const roleList = loadRoleList();
  if (!roleList.includes(config.defaultRoleName)) saveRoleList([config.defaultRoleName, ...roleList]);
  if (!roleList.includes(config.defaultOperatorRole)) saveRoleList([...roleList, config.defaultOperatorRole]);
  const entry = Object.entries(owners).find(([, name]) => name === config.defaultOwnerName);
  if (!entry) return;
  const [id] = entry;
  if (roles[id] !== config.defaultRoleName) {
    roles[id] = config.defaultRoleName;
    saveRoles(roles);
  }
}

function roleRankMap() {
  const map = {};
  const roles = loadRoleList();
  roles.forEach((r, i) => (map[r] = i));
  return map;
}

function loadRolePerms() {
  try {
    if (!fs.existsSync(config.rolesPermsFile)) return {};
    const raw = fs.readFileSync(config.rolesPermsFile, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj;
  } catch (err) {
    console.error('Failed to read roles perms file:', err.message);
    return {};
  }
}

function loadBotMessages() {
  try {
    if (!fs.existsSync(config.botMessagesFile)) return {};
    const raw = fs.readFileSync(config.botMessagesFile, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj;
  } catch (err) {
    console.error('Failed to read bot messages file:', err.message);
    return {};
  }
}

function saveBotMessages(obj) {
  try {
    const dir = path.dirname(config.botMessagesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.botMessagesFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write bot messages file:', err.message);
  }
}

function loadUserLocations() {
  try {
    if (!fs.existsSync(config.userLocationsFile)) return {};
    const raw = fs.readFileSync(config.userLocationsFile, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj;
  } catch (err) {
    console.error('Failed to read user locations file:', err.message);
    return {};
  }
}

function saveUserLocations(obj) {
  try {
    const dir = path.dirname(config.userLocationsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.userLocationsFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write user locations file:', err.message);
  }
}

function loadDictionary() {
  try {
    if (!fs.existsSync(config.dictionaryFile)) {
      const def = {
        greetings: ['ciao', 'ciao!', 'buongiorno', 'salve', 'hey', 'hola', 'hello'],
        helpTriggers: [
          'aiuto',
          'aiutami',
          'aiutarmi',
          'non capisco',
          'come funziona',
          'come funzioni',
          'come faccio',
          'cosa devo fare',
        ],
      };
      saveDictionary(def);
      return def;
    }
    const raw = fs.readFileSync(config.dictionaryFile, 'utf8');
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      const trimmed = raw.trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        obj = JSON.parse(trimmed.slice(start, end + 1));
      } else {
        throw err;
      }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj;
  } catch (err) {
    console.error('Failed to read dictionary file:', err.message);
    const fallback = {
      greetings: ['ciao', 'ciao!', 'buongiorno', 'salve', 'hey', 'hola', 'hello'],
      helpTriggers: [
        'aiuto',
        'aiutami',
        'aiutarmi',
        'non capisco',
        'come funziona',
        'come funzioni',
        'come faccio',
        'cosa devo fare',
      ],
    };
    try {
      saveDictionary(fallback);
    } catch {
      // ignore
    }
    return fallback;
  }
}

function saveDictionary(obj) {
  try {
    const dir = path.dirname(config.dictionaryFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.dictionaryFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write dictionary file:', err.message);
  }
}

function saveRolePerms(obj) {
  try {
    const dir = path.dirname(config.rolesPermsFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.rolesPermsFile, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write roles perms file:', err.message);
  }
}

function getRolePerms(roleName) {
  const perms = loadRolePerms();
  const base = {};
  config.permissions.forEach((p) => {
    if (roleName === config.defaultRoleName) {
      base[p.key] = true;
    } else {
      base[p.key] = !config.restrictedPerms.includes(p.key);
    }
  });
  if (!perms[roleName]) return base;
  return { ...base, ...perms[roleName] };
}

function setRolePerm(roleName, key, value) {
  const perms = loadRolePerms();
  const current = getRolePerms(roleName);
  current[key] = value;
  perms[roleName] = current;
  saveRolePerms(perms);
}

module.exports = {
  loadAllowedIds,
  saveAllowedIds,
  loadOwners,
  saveOwners,
  loadRoles,
  saveRoles,
  loadRoleList,
  saveRoleList,
  loadRolePerms,
  saveRolePerms,
  getRolePerms,
  setRolePerm,
  loadBotMessages,
  saveBotMessages,
  loadUserLocations,
  saveUserLocations,
  loadDictionary,
  saveDictionary,
  ensureDefaultOwner,
  roleRankMap,
};
