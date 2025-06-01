import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  credentials: {
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
  region: process.env.BUCKET_REGION,
});

async function uploadToS3(file, folder, identifierId) {
  const fileExtension = file.originalname.split(".").pop();
  const key = `${folder}/${identifierId}.${fileExtension}`;

  const params = {
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  const command = new PutObjectCommand(params);
  await s3.send(command);

  return `https://${process.env.BUCKET_NAME}.s3.${process.env.BUCKET_REGION}.amazonaws.com/${key}`;
}

// Specific upload functions that use the generic uploadToS3
export async function uploadProfilePictureS3(file, userId) {
  return uploadToS3(file, "profile-pictures", userId);
}

export async function uploadRequestPhotosS3(file, userId, requestId) {
  return uploadToS3(file, `requests/${userId}`, requestId);
}
