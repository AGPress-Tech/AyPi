const { botMessagesByChat } = require('../state');
const storage = require('../storage');
const { logEvent } = require('./log');

function recordBotMessage(chatId, messageId) {
  if (!chatId || !messageId) return;
  const list = botMessagesByChat.get(chatId) || [];
  list.push(messageId);
  const max = 500;
  if (list.length > max) list.splice(0, list.length - max);
  botMessagesByChat.set(chatId, list);
  const obj = storage.loadBotMessages();
  obj[String(chatId)] = list;
  storage.saveBotMessages(obj);
}

async function safeReply(ctx, text, extra) {
  try {
    const msg = await ctx.reply(text, extra);
    recordBotMessage(ctx.chat && ctx.chat.id, msg && msg.message_id);
    return msg;
  } catch (err) {
    console.warn('Reply failed:', err.message);
  }
}

async function safeEdit(ctx, text, extra) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err?.message && err.message.includes('message is not modified')) return;
    console.warn('Edit failed:', err.message);
  }
}

async function safeAnswerCbQuery(ctx) {
  try {
    return await ctx.answerCbQuery();
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg.includes('query is too old') || msg.includes('query ID is invalid')) {
      logEvent('cbquery_ignored', ctx, `reason="${msg}"`);
      return;
    }
    logEvent('cbquery_failed', ctx, `reason="${msg}"`);
  }
}

async function safeDelete(ctx) {
  try {
    return await ctx.deleteMessage();
  } catch (err) {
    const msg = err?.message || String(err);
    logEvent('delete_failed', ctx, `reason="${msg}"`);
  }
}

module.exports = { safeReply, safeEdit, safeAnswerCbQuery, safeDelete, recordBotMessage };
