const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const app = express();
app.use(express.json());

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;

    console.log(chatId, username);

    bot.sendMessage(
        chatId,
        "Добро пожаловать в rasu!\nДля заказа услуги откройте каталог",
        {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: "Каталог",
                        web_app: { url: "https://rasushop.vercel.app/" }
                    }
                ]]
            }
        }
    );
});

app.listen(3000, () => {
    console.log("Сервер запущен");
});