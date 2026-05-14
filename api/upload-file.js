import formidable from "formidable";
import fs from "fs";

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
const parseResponse = async (response) => {
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch (error) {
      return { __parseError: error.message, __rawText: text };
    }
  }
  return { __rawText: text };
};
const sanitizePathSegment = (value) => String(value || '')
  .trim()
  .replace(/[\\/\\:?%\\*|"<>]/g, '_')
  .replace(/\s+/g, ' ');

const sanitizeFileName = (name) => String(name || 'file')
  .trim()
  .replace(/[:\\/\?%\*|"<>]/g, '_')
  .replace(/\s+/g, ' ')
  .slice(0, 200) || 'file';

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  if (!process.env.YANDEX_DISK_TOKEN) {
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

    const createFolderUrl = new URL('https://cloud-api.yandex.net/v1/disk/resources');
    createFolderUrl.searchParams.set('path', folderPath);

    const createFolderRes = await fetch(createFolderUrl.toString(), {
      method: "PUT",
      headers: {
        Authorization: `OAuth ${process.env.YANDEX_DISK_TOKEN}`,
        Accept: 'application/json',
      },
    });

    if (![201, 409].includes(createFolderRes.status)) {
      const errorText = await createFolderRes.text();
      console.error('Yandex Disk folder creation failed:', createFolderRes.status, errorText);
      return res.status(500).json({ error: "Failed to create folder on Yandex Disk", details: errorText });
    }

    const uploadedFiles = [];

    for (const file of fileList) {
      const originalFilename = sanitizeFileName(file.originalFilename || file.newFilename || 'file');
      const fileName = `${Date.now()}_${originalFilename}`;
      const uploadUrl = new URL('https://cloud-api.yandex.net/v1/disk/resources/upload');
      uploadUrl.searchParams.set('path', `${folderPath}/${fileName}`);
      uploadUrl.searchParams.set('overwrite', 'true');

      const uploadRes = await fetch(uploadUrl.toString(), {
        headers: {
          Authorization: `OAuth ${process.env.YANDEX_DISK_TOKEN}`,
          Accept: 'application/json',
        },
      });

      if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        console.error('Yandex Disk upload URL request failed:', uploadRes.status, errorText);
        return res.status(500).json({ error: "Upload URL request failed", status: uploadRes.status, details: errorText });
      }

      const uploadData = await parseResponse(uploadRes);
      if (!uploadData.href) {
        console.error('Upload URL error:', uploadData);
        return res.status(500).json({ error: "Upload URL error", details: uploadData });
      }

      const fileBuffer = fs.readFileSync(file.filepath);
      const putRes = await fetch(uploadData.href, {
        method: "PUT",
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: fileBuffer,
      });

      if (!putRes.ok) {
        const errorText = await putRes.text();
        console.error('Yandex Disk file upload failed:', putRes.status, errorText);
        return res.status(500).json({ error: "File upload failed", details: errorText });
      }

      uploadedFiles.push({
        originalFilename,
        fileName,
        size: file.size,
        path: `${folderPath}/${fileName}`,
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
