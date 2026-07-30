function encodeRole(role) {
  return encodeURIComponent(role);
}

function decodeRole(role) {
  try {
    return decodeURIComponent(role);
  } catch {
    return role;
  }
}

function isValidRoleName(name) {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.length > 24) return false;
  if (trimmed.includes('\n')) return false;
  return true;
}

function roleButtonStyle(roleName) {
  if (!roleName) return undefined;
  if (roleName.toLowerCase() === 'owner') return 'success';
  if (roleName.toLowerCase() === 'admin') return 'primary';
  return undefined;
}

module.exports = { encodeRole, decodeRole, isValidRoleName, roleButtonStyle };
