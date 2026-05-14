import formidable from "formidable";
import fs from "fs";
import * as yaDisk from 'ya-disk';

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

    // Create folder if needed
    try {
      await yaDisk.resources.create(token, folderPath);
    } catch (error) {
      const message = error?.message?.toString() || '';
      if (!message.includes('already exists') && !message.includes('уже существует')) {
        console.error('Yandex Disk folder creation failed:', error);
        return res.status(500).json({ error: "Failed to create folder on Yandex Disk", details: message });
      }
    }

    const uploadedFiles = [];

    for (const file of fileList) {
      const originalFilename = sanitizeFileName(file.originalFilename || file.newFilename || 'file');
      const fileName = `${Date.now()}_${originalFilename}`;
      const fullPath = `${folderPath}/${fileName}`;

      let uploadLink;
      try {
        uploadLink = await yaDisk.upload.link(token, fullPath, true);
      } catch (error) {
        console.error('Yandex Disk upload link failed:', error);
        return res.status(500).json({ error: "Failed to get upload URL", details: error?.message || error });
      }

      if (!uploadLink?.href) {
        console.error('Yandex Disk upload link missing href:', uploadLink);
        return res.status(500).json({ error: "Upload URL missing", details: uploadLink });
      }

      try {
        const stream = fs.createReadStream(file.filepath);
        const putRes = await fetch(uploadLink.href, {
          method: uploadLink.method || 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
          },
          body: stream,
        });

        if (!putRes.ok) {
          const errorText = await putRes.text();
          console.error('Yandex Disk file upload failed:', putRes.status, errorText);
          return res.status(500).json({ error: "File upload failed", details: errorText });
        }
      } catch (error) {
        console.error('Yandex Disk file upload failed:', error);
        return res.status(500).json({ error: "File upload failed", details: error?.message || error });
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
