const GROUP_CHAT_ID = -1003781457668;

const tickets = {};
const activeReply = {}; // managerId -> ticketId

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
        // CALLBACKS
        // =========================
        if (cb) {
            const data = cb.data;

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
                    userChatId: cb.message.chat.id,
                    status: "collecting"
                };

                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: cb.message.chat.id,
                        text: "✍️ Напишите ваш вопрос одним сообщением"
                    })
                });
            }

            // =========================
            // MANAGER: REPLY
            // =========================
            if (data.startsWith("reply_")) {
                const ticketId = data.split("_")[1];

                activeReply[cb.from.id] = ticketId;

                // 👉 ВАЖНО: сообщение в ГРУППУ
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        chat_id: GROUP_CHAT_ID,
                        text: `✍️ Менеджер начал ответ по тикету #${ticketId}

➡️ Теперь просто отправьте следующее сообщение в этот чат — оно уйдёт клиенту.`
                    })
                });
            }

            // =========================
            // IGNORE
            // =========================
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

                if (ticket) ticket.status = "closed";
            }

            // =========================
            // CONTINUE
            // =========================
            if (data.startsWith("continue_")) {
                const ticketId = data.split("_")[1];
                if (tickets[ticketId]) {
                    tickets[ticketId].status = "open";
                }
            }

            // =========================
            // CLOSE
            // =========================
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
        // MESSAGE
        // =========================
        if (!msg) return res.status(200).send("ok");

        const chatId = msg.chat.id;
        const text = msg.text;
        const isPrivate = msg.chat.type === "private";

        // =========================
        // START
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
        // USER MESSAGE FLOW
        // =========================
        if (isPrivate && text) {

            // ищем тикет
            const ticketId = Object.keys(tickets).find(
                t => tickets[t].userChatId === chatId && tickets[t].status !== "closed"
            );

            if (!ticketId) return res.status(200).send("ok");

            const ticket = tickets[ticketId];

            // ❗ БЛОКИРУЕМ СПАМ
            if (ticket.status === "collecting") {
                ticket.status = "open";
            }

            if (ticket.status === "closed") {
                return res.status(200).send("ok");
            }

            // отправка в группу
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
        // MANAGER → CLIENT REPLY FLOW
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