import formidable from "formidable";
import fs from "fs";
import yaDisk from 'ya-disk';

export const config = {
  api: {
    bodyParser: false,
  },
};

const parseForm = (req) => new Promise((resolve, reject) => {
  const form = formidable({ multiples: true, keepExtensions: true });
  form.parse(req, (err, fields, files) => {
    if (err) return reject(err);
    resolve({ fields, files });
  });
});

const sanitizePathSegment = (value) => String(value || '')
  .trim()
  .replace(/[\/\\:?%\*|"<>]/g, '_')
  .replace(/\s+/g, ' ');

const sanitizeFileName = (name) => String(name || 'file')
  .trim()
  .replace(/[:\/\\?%\*|"<>]/g, '_')
  .replace(/\s+/g, ' ')
  .slice(0, 200) || 'file';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const token = process.env.YANDEX_DISK_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "Yandex Disk token is not configured" });
  }

  try {
    const { fields, files } = await parseForm(req);
    const telegramId = Array.isArray(fields.telegramId) ? fields.telegramId[0] : fields.telegramId;
    const fileInput = files.file;
    const fileList = Array.isArray(fileInput) ? fileInput : fileInput ? [fileInput] : [];

    if (!telegramId || !fileList.length) {
      return res.status(400).json({ error: "No telegramId or files provided" });
    }

    const safeTelegramId = sanitizePathSegment(telegramId);
    const folderPath = `app:/clients/${safeTelegramId}`;

    // Create folder
    try {
      await yaDisk.mkdir(token, folderPath);
    } catch (error) {
      if (!error.message.includes('уже существует')) { // Folder already exists is ok
        console.error('Yandex Disk folder creation failed:', error);
        return res.status(500).json({ error: "Failed to create folder on Yandex Disk", details: error.message });
      }
    }

    const uploadedFiles = [];

    for (const file of fileList) {
      const originalFilename = sanitizeFileName(file.originalFilename || file.newFilename || 'file');
      const fileName = `${Date.now()}_${originalFilename}`;
      const fullPath = `${folderPath}/${fileName}`;

      try {
        await yaDisk.uploadFile(token, fullPath, fs.createReadStream(file.filepath));
      } catch (error) {
        console.error('Yandex Disk file upload failed:', error);
        return res.status(500).json({ error: "File upload failed", details: error.message });
      }

      uploadedFiles.push({
        originalFilename,
        fileName,
        size: file.size,
        path: fullPath,
      });
    }

    return res.status(200).json({
      success: true,
      uploadedFiles,
    });
  } catch (error) {
    console.error('Upload-file handler error:', error);
    return res.status(500).json({ error: 'Upload handler failed', details: error.message });
  }
}
