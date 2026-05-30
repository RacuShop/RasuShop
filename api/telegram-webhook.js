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
// СООБЩЕНИЕ ОТ КЛИЕНТА
const GROUP_CHAT_ID = -1003781457668;

module.exports = async (req, res) => {
    try {
        const body = await new Promise((resolve) => {
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => resolve(JSON.parse(data || '{}')));
        });

        const msg = body.message;
        if (!msg) return res.status(200).send("ok");

        const chatId = msg.chat.id;
        const text = msg.text;
        const isPrivate = msg.chat.type === "private";

        console.log("========== NEW MESSAGE ==========");
        console.log("CHAT ID:", chatId);
        console.log("TYPE:", msg.chat.type);
        console.log("TEXT:", text);

        // 🟢 1. ЛИЧКА → В ГРУППУ
        if (isPrivate && text) {

            await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: GROUP_CHAT_ID,
                    text: `📩 Новое сообщение

👤 @${msg.from.username || "no_username"}
🆔 ${chatId}

💬 ${text}`
                })
            });

            // ответ пользователю
            await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "✅ Сообщение отправлено менеджерам"
                })
            });
        }

        return res.status(200).send("ok");

    } catch (e) {
        console.error(e);
        return res.status(200).send("error");
    }
};