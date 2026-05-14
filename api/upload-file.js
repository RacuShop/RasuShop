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
  // Check for GOOGLE_SERVICE_ACCOUNT_KEY first
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      console.log('Loading credentials from GOOGLE_SERVICE_ACCOUNT_KEY...');
      const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.trim();
      const parsed = JSON.parse(raw);
      console.log('Credentials parsed successfully, client_email:', parsed.client_email);

      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        console.log('Private key processed');
      } else {
        throw new Error('No private_key found in credentials');
      }
      return parsed;
    } catch (error) {
      console.error('Error parsing GOOGLE_SERVICE_ACCOUNT_KEY:', error.message);
      throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_KEY JSON: ${error.message}`);
    }
  }

  // Check for RasuDrive as alternative name
  if (process.env.RasuDrive) {
    try {
      console.log('Loading credentials from RasuDrive...');
      const raw = process.env.RasuDrive.trim();
      console.log('Raw RasuDrive value length:', raw.length);
      console.log('Raw RasuDrive starts with:', raw.substring(0, 50) + '...');

      const parsed = JSON.parse(raw);
      console.log('Credentials parsed successfully from RasuDrive, client_email:', parsed.client_email);

      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        console.log('Private key processed from RasuDrive');
      } else {
        throw new Error('No private_key found in RasuDrive credentials');
      }
      return parsed;
    } catch (error) {
      console.error('Error parsing RasuDrive:', error.message);
      console.error('Raw RasuDrive value (first 200 chars):', process.env.RasuDrive?.substring(0, 200));
      throw new Error(`Invalid RasuDrive JSON: ${error.message}`);
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    console.log('Loading credentials from GOOGLE_APPLICATION_CREDENTIALS:', credentialPath);
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
  console.log('Checking local file:', localFilePath);
  if (fs.existsSync(localFilePath)) {
    const raw = fs.readFileSync(localFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  }

  console.error('No credentials found in any location');
  return null;
};

const getDriveClient = async () => {
  const credentials = loadServiceAccountCredentials();
  if (!credentials) {
    throw new Error('Google service account credentials not found. Set GOOGLE_SERVICE_ACCOUNT_KEY or RasuDrive environment variable with the service account JSON key');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
};

const findOrCreateFolder = async (drive, folderName, parentFolderId) => {
  try {
    console.log('Checking if root folder exists:', parentFolderId);
    // First check if parent folder exists
    const parentCheck = await drive.files.get({
      fileId: parentFolderId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    console.log('Root folder exists:', parentCheck.data.name);

    const escapedName = folderName.replace(/'/g, "\\'");
    const query = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`;
    console.log('Searching for existing client folder...');
    const response = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (response.data.files && response.data.files.length > 0) {
      console.log('Found existing folder:', response.data.files[0].id);
      return response.data.files[0].id;
    }

    console.log('Creating new client folder...');
    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id',
      supportsAllDrives: true,
    });

    console.log('Created new folder:', created.data.id);
    return created.data.id;
  } catch (error) {
    console.error('Error in findOrCreateFolder:', error.message);
    throw new Error(`Failed to create/find folder: ${error.message}`);
  }
};

export default async function handler(req, res) {
  console.log('Environment variables check:');
  console.log('GOOGLE_SERVICE_ACCOUNT_KEY exists:', !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  console.log('RasuDrive exists:', !!process.env.RasuDrive);
  console.log('GOOGLE_DRIVE_ROOT_FOLDER_ID exists:', !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  console.log('GOOGLE_DRIVE_ROOT_FOLDER_ID value:', process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    return res.status(500).json({ error: 'Google Drive root folder ID is not configured', details: 'Set GOOGLE_DRIVE_ROOT_FOLDER_ID' });
  }

  // Extract folder ID from full URL if needed
  let cleanRootFolderId = rootFolderId.trim();
  if (cleanRootFolderId.includes('drive.google.com')) {
    const match = cleanRootFolderId.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) {
      cleanRootFolderId = match[1];
      console.log('Extracted folder ID from URL:', cleanRootFolderId);
    } else {
      return res.status(500).json({ error: 'Invalid Google Drive folder URL format', details: 'GOOGLE_DRIVE_ROOT_FOLDER_ID should be just the folder ID or a valid Google Drive URL' });
    }
  }

  console.log('Using root folder ID:', cleanRootFolderId);

  try {
    console.log('Starting upload process...');
    const { fields, files } = await parseForm(req);
    console.log('Form parsed successfully');

    const telegramId = Array.isArray(fields.telegramId) ? fields.telegramId[0] : fields.telegramId;
    const fileInput = files.file;
    const fileList = Array.isArray(fileInput) ? fileInput : fileInput ? [fileInput] : [];

    console.log('telegramId:', telegramId);
    console.log('fileList length:', fileList.length);

    if (!telegramId || !fileList.length) {
      return res.status(400).json({ error: 'No telegramId or files provided' });
    }

    const safeTelegramId = sanitizePathSegment(telegramId);
    console.log('Getting drive client...');
    const drive = await getDriveClient();
    console.log('Drive client created successfully');

    console.log('Creating/finding client folder...');
    const clientFolderId = await findOrCreateFolder(drive, safeTelegramId, cleanRootFolderId);
    console.log('Client folder ID:', clientFolderId);

    const uploadedFiles = [];

    for (const file of fileList) {
      console.log('Processing file:', file.originalFilename, 'Path:', file.filepath);

      // Check if file exists
      if (!fs.existsSync(file.filepath)) {
        throw new Error(`Uploaded file not found: ${file.filepath}`);
      }

      const originalFilename = sanitizeFileName(file.originalFilename || file.newFilename || 'file');
      const fileName = `${Date.now()}_${originalFilename}`;
      const media = {
        mimeType: file.mimetype || 'application/octet-stream',
        body: fs.createReadStream(file.filepath),
      };

      console.log('Uploading file to Google Drive...');
      try {
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
        console.log('File uploaded successfully:', createdFile.data.id);
      } catch (uploadError) {
        console.error('Error uploading file:', uploadError.message);
        throw new Error(`Failed to upload file ${originalFilename}: ${uploadError.message}`);
      }
    }

    return res.status(200).json({ success: true, uploadedFiles });
  } catch (error) {
    console.error('Google Drive upload handler error:', error);
    console.error('Error details:', error?.message);
    console.error('Error stack:', error?.stack);
    return res.status(500).json({ error: 'Upload handler failed', details: error?.message || error });
  }
}
