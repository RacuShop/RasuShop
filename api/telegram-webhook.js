// Telegram webhook handler for Vercel serverless.
// This bot is stateless and uses Telegram update metadata only.
// No local memory, no external database, no Express, no polling.

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_CHAT_ID = '-1003781457668';
const WEB_APP_URL = 'https://rasushop.vercel.app/';
const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : null;
const SUPPORT_PROMPT_TEXT = '✍️ Напишите ваш вопрос одним сообщением';
const SUPPORT_BUTTON_HINT_TEXT = 'Для обращения, нажмите кнопку "Поддержка"';

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Perform a request to Telegram API using fetch.
async function telegram(method, body) {
  if (!TELEGRAM_API) {
    throw new Error('BOT_TOKEN is not configured in process.env.BOT_TOKEN');
  }

  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || JSON.stringify(data)}`);
  }

  return data.result;
}

function buildStartButtons() {
  return {
    inline_keyboard: [
      [
        { text: '🛒 Каталог', web_app: { url: WEB_APP_URL } },
        { text: '💬 Поддержка', callback_data: 'support' },
      ],
    ],
  };
}

function buildSupportPrompt() {
  return {
    text: SUPPORT_PROMPT_TEXT,
    reply_markup: {
      force_reply: true,
      input_field_placeholder: 'Ваш вопрос',
      selective: true,
    },
    parse_mode: 'HTML',
  };
}

function getTicketInfoFromText(text) {
  if (!text) return null;

  const userChatIdMatch = text.match(/userChatId\s*:\s*(-?[0-9]+)/i);

  return {
    userChatId: userChatIdMatch ? Number(userChatIdMatch[1]) : null,
  };
}

function buildTicketMessage(message, userChatId) {
  const username = message.from.username
    ? `@${message.from.username}`
    : `${message.from.first_name || ''} ${message.from.last_name || ''}`.trim() || 'Пользователь';

  return [
    '📩 <b>Новое обращение в поддержку</b>',
    `username: ${username}`,
    `userChatId: ${userChatId}`,
    '',
    `<b>Сообщение пользователя</b>:\n${escapeHtml(message.text)}`,
  ].join('\n');
}

function buildManagerReplyToUser(message) {
  return [
    `📬 <b>Ответ менеджера</b>`,
    '',
    escapeHtml(message.text),
  ].join('\n');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Main webhook entrypoint. Compatible with Vercel serverless.
module.exports = async function telegramWebhook(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).send('Method Not Allowed');
    }

    const update = req.body;
    if (!update || typeof update !== 'object') {
      return res.status(400).send('Invalid request body');
    }

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return res.status(200).send('ok');
    }

    if (update.message) {
      await handleMessage(update.message);
      return res.status(200).send('ok');
    }

    return res.status(200).send('ok');
  } catch (error) {
    console.error('Telegram webhook error:', formatError(error));
    return res.status(500).send('Internal Server Error');
  }
};

// Handle callback queries from inline buttons.
// Two supported actions: support request and ticket close.
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message?.chat?.id;
  const data = callbackQuery.data;

  if (!chatId || !data) {
    await answerCallbackQuery(callbackQuery.id, 'Невозможно обработать запрос.');
    return;
  }

  if (data === 'support') {
    const prompt = buildSupportPrompt();
    await telegram('sendMessage', {
    chat_id: chatId,
    text: prompt.text,
    parse_mode: prompt.parse_mode,
    reply_markup: {
    inline_keyboard: [[
      {
        text: 'Написать',
        callback_data: `reply:${chatId}`,
      },
    ]],
  },
});

    await answerCallbackQuery(callbackQuery.id, '✍️ Напишите ваш вопрос одним сообщением.');
    return;
  }

  // Кнопка "Написать" — удаляем старый промпт, отправляем новый с force_reply
  if (data.startsWith('reply:')) {
    const oldMessageId = callbackQuery.message?.message_id;

    try {
      await telegram('deleteMessage', {
        chat_id: chatId,
        message_id: oldMessageId,
      });
    } catch (error) {
      console.warn('Unable to delete old prompt:', formatError(error));
    }

    await telegram('sendMessage', {
      chat_id: chatId,
      text: SUPPORT_PROMPT_TEXT,
      parse_mode: 'HTML',
      reply_markup: {
        force_reply: true,
        input_field_placeholder: 'Ваш вопрос',
        selective: true,
      },
    });

    await answerCallbackQuery(callbackQuery.id, '');
    return;
  }

  if (data.startsWith('close:') || data.startsWith('delete:')) {
    const parts = data.split(':');
    const action = parts[0];
    const userChatId = Number(parts[1]);

    if (userChatId) {
      await telegram('sendMessage', {
        chat_id: userChatId,
        text: '❌ Ваше обращение закрыто',
        parse_mode: 'HTML',
      });
    }

    await answerCallbackQuery(callbackQuery.id, action === 'delete' ? 'Обращение удалено' : 'Тикет закрыт');

    try {
      if (action === 'delete') {
        await telegram('deleteMessage', {
          chat_id: chatId,
          message_id: callbackQuery.message.message_id,
        });
      } else {
        await telegram('editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: callbackQuery.message.message_id,
        });
      }
    } catch (error) {
      console.warn('Unable to update manager message after close/delete:', formatError(error));
    }

    return;
  }

  await answerCallbackQuery(callbackQuery.id, 'Неподдерживаемая операция.');
}

// Handle incoming text messages.
// Private chat messages are treated as user support replies.
// Group chat messages are treated as manager replies to ticket posts.
async function handleMessage(message) {
  // Обрабатываем текст или фото
  if (!message.text && !message.photo) {
    return;
  }

  const chatType = message.chat.type;

  if (message.text?.trim().startsWith('/start')) {
    await handleStartCommand(message.chat.id);
    return;
  }

  if (chatType === 'private') {
    await handlePrivateChatMessage(message);
    return;
  }

  if (String(message.chat.id) === String(GROUP_CHAT_ID)) {
    await handleGroupChatMessage(message);
  }
}

async function handleStartCommand(chatId) {
  await telegram('sendMessage', {
    chat_id: chatId,
    text: 'Я бот поддержки Rasu\n\nВыберите действие ниже:',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buildStartButtons().inline_keyboard },
  });
}

// The user must reply to the support prompt message.
// This ensures one-message-per-session without server-side state.
async function handlePrivateChatMessage(message) {
  const replyTo = message.reply_to_message;
  if (!replyTo || !replyTo.text) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: SUPPORT_BUTTON_HINT_TEXT,
      parse_mode: 'HTML',
    });
    return;
  }

  if (!replyTo.text.startsWith(SUPPORT_PROMPT_TEXT)) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: SUPPORT_BUTTON_HINT_TEXT,
      parse_mode: 'HTML',
    });
    return;
  }

  // Проверяем лимит фото: максимум 1
  if (message.photo && message.photo.length > 1) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: '⚠️ Можно прикреплять только одну фотографию.',
      parse_mode: 'HTML',
    });
    return;
  }

  const userChatId = message.chat.id;

  try {
    await telegram('deleteMessage', {
      chat_id: userChatId,
      message_id: replyTo.message_id,
    });
  } catch (error) {
    console.warn('Unable to delete support prompt:', formatError(error));
  }

  const ticketText = buildTicketMessage(message, userChatId);
  
  // Отправляем тикет в группу
  const ticketMessage = await telegram('sendMessage', {
    chat_id: GROUP_CHAT_ID,
    text: ticketText,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '❌ Закрыть',
            callback_data: `close:${userChatId}`,
          },
          {
            text: '🗑 Удалить',
            callback_data: `delete:${userChatId}`,
          },
        ],
      ],
    },
  });

  // Если есть фото, отправляем его отдельно
  if (message.photo) {
    const photoFileId = message.photo[message.photo.length - 1].file_id;
    await telegram('sendPhoto', {
      chat_id: GROUP_CHAT_ID,
      photo: photoFileId,
      caption: '📸 Фото от клиента',
      reply_to_message_id: ticketMessage.message_id,
    });
  }

  await telegram('sendMessage', {
    chat_id: userChatId,
    text: '✅ Ваше сообщение отправлено менеджерам. Ожидайте ответа.',
    parse_mode: 'HTML',
  });
}

// Manager responses are detected by replies to ticket messages in the group.
// The bot extracts userChatId from the replied-to message.
async function handleGroupChatMessage(message) {
  const replyTo = message.reply_to_message;
  if (!replyTo || !replyTo.text) {
    return;
  }

  const meta = getTicketInfoFromText(replyTo.text);
  if (!meta || !meta.userChatId) {
    return;
  }

  // Проверяем лимит фото: максимум 3
  if (message.photo && message.photo.length > 3) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: '⚠️ Можно прикреплять максимум 3 фотографии за раз.',
      parse_mode: 'HTML',
    });
    return;
  }

  const userChatId = meta.userChatId;

  const answerText = buildManagerReplyToUser(message);
  await telegram('sendMessage', {
    chat_id: userChatId,
    text: answerText,
    parse_mode: 'HTML',
  });

  // Если есть фото, отправляем каждое отдельно
  if (message.photo) {
    for (const photo of message.photo) {
      const photoFileId = photo.file_id;
      await telegram('sendPhoto', {
        chat_id: userChatId,
        photo: photoFileId,
        caption: '📸 Фото от менеджера',
      });
    }
  }

  // Отправляем промпт с кнопкой "Написать"
  const promptMessage = await telegram('sendMessage', {
    chat_id: userChatId,
    text: SUPPORT_PROMPT_TEXT,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        {
          text: 'Написать',
          callback_data: `reply:${userChatId}`,
        },
      ]],
    },
  });

  await telegram('sendMessage', {
    chat_id: message.chat.id,
    text: '✅ Ответ отправлен пользователю и клиент снова может написать одно сообщение.',
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  await telegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}