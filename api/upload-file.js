import formidable from "formidable";
import fs from "fs";
import path from "path";
import { google } from "googleapis";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export const maxDuration = 60;

// ---------- FORM PARSER ----------
const parseForm = (req) =>
  new Promise((resolve, reject) => {
    const form = formidable({ multiples: true, keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });

// ---------- SANITIZERS ----------
const sanitizePathSegment = (value) =>
  String(value || "")
    .trim()
    .replace(/[\/\\:?%"<>|*]/g, "_")
    .replace(/\s+/g, " ");

const sanitizeFileName = (name) =>
  String(name || "file")
    .trim()
    .replace(/[\/\\:?%"<>|*]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 200);

// ---------- OAUTH DRIVE CLIENT ----------
const getDriveClient = () => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });

  return google.drive({
    version: "v3",
    auth: oauth2Client,
  });
};

// ---------- FIND OR CREATE FOLDER ----------
const findOrCreateFolder = async (drive, folderName, parentFolderId) => {
  const escapedName = folderName.replace(/'/g, "\\'");
  const query = `
    name='${escapedName}'
    and mimeType='application/vnd.google-apps.folder'
    and '${parentFolderId}' in parents
    and trashed=false
  `;

  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  return created.data.id;
};

// ---------- MAIN HANDLER ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

    if (!rootFolderId) {
      return res.status(500).json({
        error: "Missing GOOGLE_DRIVE_ROOT_FOLDER_ID",
      });
    }

    const { fields, files } = await parseForm(req);

    const telegramId =
      Array.isArray(fields.telegramId)
        ? fields.telegramId[0]
        : fields.telegramId;

    const fileInput = files.file;
    const fileList = Array.isArray(fileInput)
      ? fileInput
      : fileInput
      ? [fileInput]
      : [];

    if (!telegramId || fileList.length === 0) {
      return res.status(400).json({ error: "No telegramId or files" });
    }

    const drive = getDriveClient();

    const safeTelegramId = sanitizePathSegment(telegramId);

    const clientFolderId = await findOrCreateFolder(
      drive,
      safeTelegramId,
      rootFolderId
    );

    const uploadedFiles = [];

    for (const file of fileList) {
      if (!fs.existsSync(file.filepath)) {
        throw new Error("Temp file not found");
      }

      const originalName = sanitizeFileName(
        file.originalFilename || "file"
      );

      const finalName = `${Date.now()}_${originalName}`;

      const createdFile = await drive.files.create({
        requestBody: {
          name: finalName,
          parents: [clientFolderId],
        },
        media: {
          mimeType: file.mimetype || "application/octet-stream",
          body: fs.createReadStream(file.filepath),
        },
        fields: "id,webViewLink",
        supportsAllDrives: true,
      });

      uploadedFiles.push({
        name: finalName,
        id: createdFile.data.id,
        url: createdFile.data.webViewLink,
      });
    }

    return res.status(200).json({
      success: true,
      uploadedFiles,
    });
  } catch (error) {
    console.error("UPLOAD ERROR:", error);
    return res.status(500).json({
      error: error.message || "Upload failed",
    });
  }
}