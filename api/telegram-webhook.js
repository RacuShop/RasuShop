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
module.exports = async (req, res) => {
    try {
        const body = await new Promise((resolve) => {
            let data = '';
            req.on('data', chunk => data += chunk);
            req.on('end', () => resolve(JSON.parse(data || '{}')));
        });

        const message = body.message;

        if (!message) {
            return res.status(200).send("ok");
        }

        const chatId = message.chat.id;
        const text = message.text;
        const username = message.from?.username;

        // 🔥 ЛОГ ВСЕГО ЧТО ПРИХОДИТ
        console.log("========== NEW MESSAGE ==========");
        console.log("CHAT ID:", chatId);
        console.log("USERNAME:", username);
        console.log("TEXT:", text);
        console.log("CHAT TYPE:", message.chat.type);

        // 🧪 ответ чтобы Telegram не ругался
        return res.status(200).send("ok");

    } catch (e) {
        console.error("WEBHOOK ERROR:", e);
        return res.status(200).send("error");
    }
};