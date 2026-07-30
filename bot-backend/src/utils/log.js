const fs = require('fs');
const path = require('path');
const config = require('../config');
const MAX_LOG_BYTES = 50 * 1024 * 1024;

function enforceLogLimit(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= MAX_LOG_BYTES) return;
    const start = Math.max(0, stat.size - MAX_LOG_BYTES);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let slice = buf;
    const firstNl = buf.indexOf('\n');
    if (firstNl !== -1 && start > 0) slice = buf.slice(firstNl + 1);
    fs.writeFileSync(filePath, slice, 'utf8');
  } catch (err) {
    console.warn('Log trim failed:', err.message);
  }
}

function appendLog(line) {
  try {
    const dir = path.dirname(config.logFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(config.logFile, `${line}\n`, 'utf8');
    enforceLogLimit(config.logFile);
  } catch (err) {
    console.warn('Log write failed:', err.message);
  }
}

function logEvent(event, ctx, details) {
  const chatId = ctx?.chat?.id;
  const user = ctx?.from?.username || ctx?.from?.first_name || 'unknown';
  const base = `[${new Date().toISOString()}] ${event} chat=${chatId} user=${user}`;
  if (details) {
    const line = `${base} ${details}`;
    console.log(line);
    appendLog(line);
  } else {
    console.log(base);
    appendLog(base);
  }
}

module.exports = { logEvent };
