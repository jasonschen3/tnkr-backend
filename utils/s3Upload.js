import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

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
  // Generate a unique identifier for each photo to prevent overwriting
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 15);
  const uniqueId = `${userId}_${timestamp}_${randomId}`;
  return uploadToS3(file, `requests/${requestId}`, uniqueId);
}

// Delete all photos for a specific request
export async function deleteRequestPhotosS3(userId, requestId) {
  try {
    // List all objects in the request folder
    const listParams = {
      Bucket: process.env.BUCKET_NAME,
      Prefix: `requests/${requestId}/`,
    };

    const listCommand = new ListObjectsV2Command(listParams);
    const listResult = await s3.send(listCommand);

    if (!listResult.Contents) {
      console.log("No objects found for request:", requestId);
      return;
    }

    // Delete all objects in the request folder
    const deletePromises = listResult.Contents.map((obj) => {
      const deleteParams = {
        Bucket: process.env.BUCKET_NAME,
        Key: obj.Key,
      };
      const deleteCommand = new DeleteObjectCommand(deleteParams);
      return s3.send(deleteCommand);
    });

    await Promise.all(deletePromises);
    console.log(
      `Deleted ${listResult.Contents.length} photos for request:`,
      requestId
    );
  } catch (error) {
    console.error("Error deleting request photos from S3:", error);
    // Don't throw error to prevent request deletion from failing if S3 deletion fails
  }
}
