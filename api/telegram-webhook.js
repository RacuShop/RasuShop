module.exports = async (req, res) => {
    try {
        const body = await new Promise((resolve) => {
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => resolve(JSON.parse(data || '{}')));
        });

        console.log("🔥 WEBHOOK HIT");
        console.log(body);

        const message = body.message;

        if (!message) {
            return res.status(200).send("ok");
        }

        const chatId = message.chat.id;
        const text = message.text;
        // КОМАНДА /START, НАЧАЛО ЧАТА
        if (text === "/start") {
            await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "Добро пожаловать в rasu!\nДля заказа услуги откройте каталог",
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: "Каталог",
                                web_app: {
                                    url: "https://rasushop.vercel.app/"
                                }
                            }
                        ]]
                    }
                })
            });
        }

        return res.status(200).send("ok");

    } catch (e) {
        console.error(e);
        return res.status(200).send("error");
    }
};
        const GROUP_CHAT_ID = -1003781457668;

// память (позже заменишь на DB)
const tickets = {};
const activeReply = {};

// генератор тикетов
const genTicketId = () => Math.random().toString(36).substring(2, 10);

module.exports = async (req, res) => {
    try {
        const body = await new Promise((resolve) => {
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => resolve(JSON.parse(data || '{}')));
        });

        const botToken = process.env.BOT_TOKEN;

        const msg = body.message;
        const cb = body.callback_query;

        // =========================
        // CALLBACK КНОПКИ
        // =========================
        if (cb) {
            const data = cb.data;
            const managerId = cb.from.id;

            // 👉 REPLY
            if (data.startsWith("reply_")) {
                const ticketId = data.split("_")[1];
                activeReply[managerId] = ticketId;

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: managerId,
                        text: `✍️ Введите ответ клиенту (ticket ${ticketId})`
                    })
                });
            }

            // 👉 IGNORE
            if (data.startsWith("ignore_")) {
                const ticketId = data.split("_")[1];
                const ticket = tickets[ticketId];

                if (ticket) {
                    await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: GROUP_CHAT_ID,
                            message_id: ticket.messageId
                        })
                    });
                }
            }

            // 👉 CONTINUE
            if (data.startsWith("continue_")) {
                const ticketId = data.split("_")[1];
                if (tickets[ticketId]) {
                    tickets[ticketId].status = "open";
                }
            }

            // 👉 CLOSE
            if (data.startsWith("close_")) {
                const ticketId = data.split("_")[1];
                const ticket = tickets[ticketId];

                if (ticket) {
                    tickets[ticketId].status = "closed";

                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            chat_id: ticket.userChatId,
                            text: "❌ Ваше обращение закрыто"
                        })
                    });
                }
            }

            return res.status(200).send("ok");
        }

        // =========================
        // СООБЩЕНИЕ
        // =========================
        if (!msg) return res.status(200).send("ok");

        const chatId = msg.chat.id;
        const text = msg.text;
        const isPrivate = msg.chat.type === "private";

        console.log("========== NEW MESSAGE ==========");
        console.log("CHAT ID:", chatId);
        console.log("TYPE:", msg.chat.type);
        console.log("TEXT:", text);

        // =========================
        // 1. /start → КНОПКА ПОДДЕРЖКИ
        // =========================
        if (isPrivate && text === "/start") {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "Добро пожаловать 👋",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "💬 Поддержка",
                                    callback_data: "support"
                                }
                            ]
                        ]
                    }
                })
            });

            return res.status(200).send("ok");
        }

        // =========================
        // callback SUPPORT
        // =========================
        if (cb?.data === "support") {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: cb.message.chat.id,
                    text: "✍️ Опишите ваш вопрос одним сообщением"
                })
            });

            // создаём тикет ожидания
            const ticketId = genTicketId();
            tickets[ticketId] = {
                userChatId: cb.message.chat.id,
                status: "waiting"
            };

            return res.status(200).send("ok");
        }

        // =========================
        // 2. сообщение клиента → группа
        // =========================
        if (isPrivate && text) {

            // ищем активный тикет
            const ticketId = Object.keys(tickets).find(
                t => tickets[t].userChatId === chatId && tickets[t].status !== "closed"
            );

            if (!ticketId) return res.status(200).send("ok");

            const ticket = tickets[ticketId];
            ticket.status = "open";

            const sent = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    text: `📩 Новый тикет #${ticketId}

👤 ${msg.from.username || "no_username"}
🆔 ${chatId}

💬 ${text}`,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✉️ Ответ", callback_data: `reply_${ticketId}` },
                                { text: "🗑 Игнор", callback_data: `ignore_${ticketId}` }
                            ]
                        ]
                    }
                })
            });

            const result = await sent.json();

            ticket.messageId = result.result.message_id;

            // ответ клиенту
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "✅ Спасибо! Вам ответит первый освободившийся менеджер"
                })
            });

            return res.status(200).send("ok");
        }

        // =========================
        // 3. ответ менеджера → клиенту
        // =========================
        if (!isPrivate && activeReply[msg.from.id]) {
            const ticketId = activeReply[msg.from.id];
            const ticket = tickets[ticketId];

            if (ticket && text) {

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: ticket.userChatId,
                        text: `💬 Ответ менеджера:

${text}`
                    })
                });

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: GROUP_CHAT_ID,
                        text: `📨 Ответ отправлен в тикет #${ticketId}`,
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "🔄 Продолжить", callback_data: `continue_${ticketId}` },
                                    { text: "❌ Закрыть", callback_data: `close_${ticketId}` }
                                ]
                            ]
                        }
                    })
                });

                delete activeReply[msg.from.id];
            }
        }

        return res.status(200).send("ok");

    } catch (e) {
        console.error(e);
        return res.status(200).send("error");
    }
};