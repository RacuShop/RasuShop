import { google } from "googleapis";

export default async function handler(req,res){

const auth=new google.auth.OAuth2(
process.env.GOOGLE_CLIENT_ID,
process.env.GOOGLE_CLIENT_SECRET
);

auth.setCredentials({
refresh_token:process.env.GOOGLE_REFRESH_TOKEN
});

const token=await auth.getAccessToken();

res.status(200).json({
accessToken:token.token
});

}