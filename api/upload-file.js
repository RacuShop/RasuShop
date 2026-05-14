import formidable from "formidable";
import fs from "fs";
import path from "path";
import { google } from "googleapis";

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

const loadServiceAccountCredentials = () => {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
      const parsed = JSON.parse(raw);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch (error) {
      throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON: ${error.message}`);
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (fs.existsSync(credentialPath)) {
      const raw = fs.readFileSync(credentialPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    }
  }

  const localFilePath = path.join(process.cwd(), 'api', 'rasu-496307-9d9bfcb2ad9a.json');
  if (fs.existsSync(localFilePath)) {
    const raw = fs.readFileSync(localFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  }

  return null;
};

const getDriveClient = async () => {
  const credentials = loadServiceAccountCredentials();
  if (!credentials) {
    throw new Error('Google service account credentials not found. Set GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_APPLICATION_CREDENTIALS, or place the JSON in api/');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
};

const findOrCreateFolder = async (drive, folderName, parentFolderId) => {
  const escapedName = folderName.replace(/'/g, "\\'");
  const query = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    spaces: 'drive',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  return created.data.id;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    return res.status(500).json({ error: 'Google Drive root folder ID is not configured', details: 'Set GOOGLE_DRIVE_ROOT_FOLDER_ID' });
  }

  try {
    const { fields, files } = await parseForm(req);
    const telegramId = Array.isArray(fields.telegramId) ? fields.telegramId[0] : fields.telegramId;
    const fileInput = files.file;
    const fileList = Array.isArray(fileInput) ? fileInput : fileInput ? [fileInput] : [];

    if (!telegramId || !fileList.length) {
      return res.status(400).json({ error: 'No telegramId or files provided' });
    }

    const safeTelegramId = sanitizePathSegment(telegramId);
    const drive = await getDriveClient();
    const clientFolderId = await findOrCreateFolder(drive, safeTelegramId, rootFolderId);

    const uploadedFiles = [];

    for (const file of fileList) {
      const originalFilename = sanitizeFileName(file.originalFilename || file.newFilename || 'file');
      const fileName = `${Date.now()}_${originalFilename}`;
      const media = {
        mimeType: file.mimetype || 'application/octet-stream',
        body: fs.createReadStream(file.filepath),
      };

      const createdFile = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [clientFolderId],
        },
        media,
        fields: 'id,name,mimeType,size,webViewLink',
        supportsAllDrives: true,
      });

      uploadedFiles.push({
        originalFilename,
        fileName,
        size: file.size,
        path: `https://drive.google.com/drive/folders/${clientFolderId}`,
        id: createdFile.data.id,
        webViewLink: createdFile.data.webViewLink,
      });
    }

    return res.status(200).json({ success: true, uploadedFiles });
  } catch (error) {
    console.error('Google Drive upload handler error:', error);
    return res.status(500).json({ error: 'Upload handler failed', details: error?.message || error });
  }
}
