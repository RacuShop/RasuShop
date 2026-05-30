// Telegram webhook handler for Vercel serverless (CommonJS)
// Technologies: Node.js, Telegram Bot API, fetch, no external libs
// Exports: module.exports = async (req, res) => {}

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ID группы менеджеров
const GROUP_CHAT_ID = -1003781457668;

// In-memory storage (ephemeral)
const tickets = {}; // ticketId -> { ticketId, userChatId, username, status, userMessageId, groupMessageId, allowed }
const activeReply = {}; // managerId -> ticketId (waiting for next manager message)
const collecting = {}; // userChatId -> ticketId (user pressed Support and should send one message)
const userCooldown = {}; // userChatId -> timestamp

// Helpers
const fetch = global.fetch || require('node-fetch');

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s){
  if(!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function tg(method, body){
  const url = `${API_BASE}/${method}`;
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const r = await fetch(url, opts);
  try { return await r.json(); } catch(e){ return null; }
}

async function sendMessage(chat_id, text, extra){
  return tg('sendMessage', Object.assign({ chat_id, text, parse_mode: 'HTML' }, extra));
}

async function deleteMessage(chat_id, message_id){
  return tg('deleteMessage', { chat_id, message_id });
}

async function answerCallback(callback_query_id, text){
  return tg('answerCallbackQuery', { callback_query_id, text });
}

// Rate-limit helper (basic spam protection)
function tooSoon(userId){
  const now = Date.now();
  const last = userCooldown[userId] || 0;
  if(now - last < 3000) return true; // 3s
  userCooldown[userId] = now;
  return false;
}

// Main handler
module.exports = async (req, res) => {
  if (!BOT_TOKEN) {
    res.status(200).send('BOT_TOKEN not configured');
    return;
  }

  // Only accept POST from Telegram; respond to GET for healthcheck
  if (req.method === 'GET') { res.status(200).send('OK'); return; }

  const update = req.body || {};
  const message = update.message;
  const callback = update.callback_query;

  try {
    // ------------------- Handle callback_query -------------------
    if (callback) {
      const data = callback.data || '';
      const from = callback.from || {};
      const cbid = callback.id;

      // Always answer callback to remove loading
      await answerCallback(cbid, '');

      // Support button pressed by user
      if (data === 'support') {
        const userChatId = from.id;
        if (tooSoon(userChatId)) { await answerCallback(cbid, 'Подождите немного'); res.status(200).end(); return; }

        // create ticket and expect a single message
        const ticketId = genId();
        tickets[ticketId] = { ticketId, userChatId, username: from.username || `${from.first_name || ''} ${from.last_name || ''}`.trim(), status: 'collecting' };
        collecting[userChatId] = ticketId;

        await sendMessage(userChatId, '✍️ Напишите ваш вопрос одним сообщением');
        res.status(200).end();
        return;
      }

      // callback pattern: action_ticketId
      const parts = (data || '').split('_');
      const action = parts[0];
      const ticketId = parts.slice(1).join('_');
      const ticket = tickets[ticketId];

      // Manager actions in group
      if (action === 'ignore' && ticket) {
        // delete group message if exists
        if (ticket.groupMessageId) await deleteMessage(GROUP_CHAT_ID, ticket.groupMessageId).catch(()=>{});
        ticket.status = 'closed';
        await answerCallback(cbid, 'Тикет отмечен как игнорируемый');
        res.status(200).end();
        return;
      }

      if (action === 'reply' && ticket) {
        // create reply session for manager: next message from this manager will be forwarded to the user
        activeReply[from.id] = ticketId;
        ticket.status = 'in_progress';
        await answerCallback(cbid, 'Отправьте сообщение, и оно будет переслано клиенту');
        res.status(200).end();
        return;
      }

      if (action === 'continue' && ticket) {
        ticket.status = 'open';
        ticket.allowed = 1; // allow one message from client
        await answerCallback(cbid, 'Тикет снова открыт — клиент может ответить одним сообщением');
        res.status(200).end();
        return;
      }

      if (action === 'close' && ticket) {
        ticket.status = 'closed';
        // notify client
        try { await sendMessage(ticket.userChatId, '❌ Ваше обращение закрыто'); } catch(e){}
        await answerCallback(cbid, 'Тикет закрыт');
        res.status(200).end();
        return;
      }

      // Unknown callback
      res.status(200).end();
      return;
    }

    // ------------------- Handle text messages -------------------
    if (message) {
      const chat = message.chat || {};
      const from = message.from || {};
      const text = message.text || '';

      // -- User in private chat
      if (chat.type === 'private') {
        const userId = from.id;

        // If user is expected to send initial question
        if (collecting[userId]) {
          const ticketId = collecting[userId];
          const ticket = tickets[ticketId];
          if (!ticket) { delete collecting[userId]; res.status(200).end(); return; }

          // spam protection
          if (tooSoon(userId)) { res.status(200).end(); return; }

          // send to group
          const body = `<b>Ticket:</b> ${escapeHtml(ticketId)}\n` +
            `<b>Username:</b> ${escapeHtml(ticket.username || from.username || `${from.first_name||''}`)}\n` +
            `<b>UserId:</b> ${escapeHtml(String(userId))}\n\n` +
            `${escapeHtml(text)}`;

          const keyboard = { inline_keyboard: [[ { text: '✉️ Ответ', callback_data: `reply_${ticketId}` }, { text: '🗑 Игнор', callback_data: `ignore_${ticketId}` } ]] };

          const sent = await sendMessage(GROUP_CHAT_ID, body, { reply_markup: keyboard });
          const groupMessageId = sent && sent.result && sent.result.message_id;

          ticket.userMessageId = message.message_id;
          ticket.groupMessageId = groupMessageId;
          ticket.status = 'pending';
          delete collecting[userId];

          // confirm to user
          await sendMessage(userId, '✅ Спасибо! Вам ответит первый освободившийся менеджер');
          res.status(200).end();
          return;
        }

        // If user has an open ticket and allowed messages
        const maybeTicket = Object.values(tickets).find(t => t.userChatId === from.id && t.status === 'open' && t.allowed > 0);
        if (maybeTicket) {
          const ticket = maybeTicket;
          // send message to group as follow-up
          const body = `<b>Ticket:</b> ${escapeHtml(ticket.ticketId)}\n` +
            `<b>Username:</b> ${escapeHtml(ticket.username || from.username || `${from.first_name||''}`)}\n` +
            `<b>UserId:</b> ${escapeHtml(String(from.id))}\n\n` +
            `${escapeHtml(text)}`;

          const keyboard = { inline_keyboard: [[ { text: '✉️ Ответ', callback_data: `reply_${ticket.ticketId}` }, { text: '🗑 Игнор', callback_data: `ignore_${ticket.ticketId}` } ]] };

          const sent = await sendMessage(GROUP_CHAT_ID, body, { reply_markup: keyboard });
          ticket.groupMessageId = sent && sent.result && sent.result.message_id;
          ticket.status = 'pending';
          ticket.allowed = 0; // block further messages until manager continues

          await sendMessage(from.id, '✅ Спасибо! Вам ответит первый освободившийся менеджер');
          res.status(200).end();
          return;
        }

        // Otherwise ignore (do nothing) — protects from spam
        res.status(200).end();
        return;
      }

      // -- Message in group (managers)
      if (chat.id === GROUP_CHAT_ID) {
        const managerId = from.id;

        // If manager has active reply session, forward this message to the ticket owner
        if (activeReply[managerId]) {
          const ticketId = activeReply[managerId];
          const ticket = tickets[ticketId];
          delete activeReply[managerId]; // single-use
          if (!ticket || ticket.status === 'closed') { res.status(200).end(); return; }

          // Forward manager's message text to client
          const textToClient = `📩 Ответ от менеджера:\n${message.text || ''}`;
          await sendMessage(ticket.userChatId, textToClient);

          // In group, notify that answer was sent and provide Continue / Close buttons
          const keyboard = { inline_keyboard: [[ { text: '🔄 Продолжить', callback_data: `continue_${ticketId}` }, { text: '❌ Закрыть', callback_data: `close_${ticketId}` } ]] };
          await sendMessage(GROUP_CHAT_ID, `📨 Ответ отправлен (ticket ${ticketId})`, { reply_markup: keyboard });

          // Ticket remains blocked until Continue
          ticket.status = 'awaiting_manager_action';
          res.status(200).end();
          return;
        }

        // Otherwise ignore messages in group
        res.status(200).end();
        return;
      }
    }

    // Default response
    res.status(200).end();
  } catch (err) {
    console.error('Webhook handler error', err);
    // Ensure Telegram receives 200 to avoid retries
    res.status(200).end();
  }
};
