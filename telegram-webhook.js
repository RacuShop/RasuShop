module.exports = async (req, res) => {
    console.log("🔥 HIT WEBHOOK");

    console.log("METHOD:", req.method);
    console.log("BODY:", req.body);

    if (req.method !== "POST") {
        return res.status(200).send("ok");
    }

    const message = req.body?.message;

    if (!message) {
        return res.status(200).send("no message");
    }

    const chatId = message.chat.id;
    const text = message.text;

    console.log("CHAT:", chatId);
    console.log("TEXT:", text);

    return res.status(200).send("ok");
};