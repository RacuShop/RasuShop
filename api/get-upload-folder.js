import { google } from "googleapis";

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

auth.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const drive = google.drive({
  version: "v3",
  auth
});

const sanitizePathSegment = (value) =>
  String(value || "")
    .trim()
    .replace(/[\/\\:?%*|"<>]/g, "_")
    .replace(/\s+/g, " ");

async function findOrCreateFolder(folderName, parentFolderId) {
  const escapedName = folderName.replace(/'/g, "\\'");

  const existing = await drive.files.list({
    q: `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: 1
  });

  if (existing.data.files.length) {
    return existing.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId]
    },
    fields: "id"
  });

  return created.data.id;
}

export default async function handler(req,res){

 if(req.method!=="POST"){
   return res.status(405).json({
     error:"Only POST"
   });
 }

 try{

   const {telegramId}=req.body;

   if(!telegramId){
     return res.status(400).json({
       error:"No telegramId"
     });
   }

   const folderId = await findOrCreateFolder(
   sanitizePathSegment(telegramId),
   process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
);

// получаем access token
const accessTokenObject =
    await auth.getAccessToken();

const accessToken =
    accessTokenObject.token;

if(!accessToken){
    throw new Error(
        'Failed to get access token'
    );
}

return res.status(200).json({
    folderId,
    accessToken
});

 } catch(err){

   console.error(err);

   return res.status(500).json({
      error:err.message
   });
 }
}