const GROUP_CHAT_ID = -1003781457668;

// временная память (потом база)
const tickets = {};
const activeReply = {};

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

        console.log("🔥 WEBHOOK HIT");

        // =========================
        // CALLBACKS (ВСЕ КНОПКИ)
        // =========================
        if (cb) {
            const data = cb.data;
            const chatId = cb.message.chat.id;

            // ОБЯЗАТЕЛЬНО закрываем callback
            await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    callback_query_id: cb.id
                })
            });

            // =========================
            // SUPPORT START
            // =========================
            if (data === "support") {
                const ticketId = genTicketId();

                tickets[ticketId] = {
                    userChatId: chatId,
                    status: "waiting"
                };

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: "✍️ Опишите ваш вопрос одним сообщением"
                    })
                });
            }

            // =========================
            // MANAGER ACTIONS
            // =========================

            if (data.startsWith("reply_")) {
                const ticketId = data.split("_")[1];
                activeReply[cb.from.id] = ticketId;

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: cb.from.id,
                        text: `✍️ Напишите ответ клиенту (ticket ${ticketId})`
                    })
                });
            }

            if (data.startsWith("ignore_")) {
                const ticketId = data.split("_")[1];
                const ticket = tickets[ticketId];

                if (ticket?.messageId) {
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

            if (data.startsWith("continue_")) {
                const ticketId = data.split("_")[1];
                if (tickets[ticketId]) {
                    tickets[ticketId].status = "open";
                }
            }

            if (data.startsWith("close_")) {
                const ticketId = data.split("_")[1];
                const ticket = tickets[ticketId];

                if (ticket) {
                    ticket.status = "closed";

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
        // MESSAGE FLOW
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
        // /START
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
                            [{ text: "💬 Поддержка", callback_data: "support" }]
                        ]
                    }
                })
            });

            return res.status(200).send("ok");
        }

        // =========================
        // USER MESSAGE → GROUP
        // =========================
        if (isPrivate && text) {

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
                    text: `📩 Тикет #${ticketId}

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
        // MANAGER REPLY → CLIENT
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