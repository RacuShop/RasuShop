const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;

const bot = new TelegramBot(token);

module.exports = async (req, res) => {
    try {
        if (req.method !== 'POST') {
            return res.status(405).send('Method Not Allowed');
        }

        const message = req.body.message;

        if (!message) {
            return res.status(200).send('ok');
        }

        const chatId = message.chat.id;
        const username = message.from.username;

        console.log('User:', chatId, username);

        // Команда /start
        if (message.text === '/start') {
            await bot.sendMessage(
                chatId,
                'Добро пожаловать в rasu!\nДля заказа услуги откройте каталог',
                {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: 'Каталог',
                                web_app: {
                                    url: 'https://rasushop.vercel.app/'
                                }
                            }
                        ]]
                    }
                }
            );
        }

        return res.status(200).send('ok');

    } catch (error) {
        console.error(error);
        return res.status(500).send('Server Error');
    }
};