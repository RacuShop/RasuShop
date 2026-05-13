import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {

    if (err) {
      return res.status(500).json({ error: "Form error" });
    }

    const telegramId = fields.telegramId?.[0];
    const file = files.file?.[0];

    if (!telegramId || !file) {
      return res.status(400).json({ error: "No data" });
    }

    const folderPath = `app:/clients/${telegramId}`;

    // создаём папку (если её нет)
    await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(folderPath)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `OAuth ${process.env.YANDEX_DISK_TOKEN}`,
        },
      }
    );

    const fileName = `${Date.now()}_${file.originalFilename}`;

    // получаем ссылку для загрузки
    const uploadRes = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(
        folderPath + "/" + fileName
      )}&overwrite=true`,
      {
        headers: {
          Authorization: `OAuth ${process.env.YANDEX_DISK_TOKEN}`,
        },
      }
    );

    const uploadData = await uploadRes.json();

    if (!uploadData.href) {
      return res.status(500).json({ error: "Upload URL error" });
    }

    const fileBuffer = fs.readFileSync(file.filepath);

    // отправляем файл
    await fetch(uploadData.href, {
      method: "PUT",
      body: fileBuffer,
    });

    return res.status(200).json({
      success: true,
      fileName,
    });

  });
}