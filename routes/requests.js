import express from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "./auth.js";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const s3 = new S3Client({
  credentials: {
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
  region: process.env.BUCKET_REGION,
});

async function uploadRequestPhotosS3(file, requestId, userId) {
  const fileExtension = file.originalname.split(".").pop();
  const key = `requests/${userId}/${requestId}.${fileExtension}`;

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

router.post("/", verifyToken, upload.array("pictures"), async (req, res) => {
  try {
    const {
      jobDescription,
      budget,
      shoeSize,
      brand,
      shoeName,
      releaseYear,
      previouslyWorkedWith,
      service,
      subtypes,
      street,
      city,
      stateCode,
      zipCode,
      recommendedPrice,
    } = req.body;

    // Create address first
    const address = await prisma.Address.create({
      data: {
        street,
        city,
        stateCode,
        zipCode,
      },
    });

    const parsedSubtypes = JSON.parse(subtypes);

    // Create request with address and user relation
    const request = await prisma.Request.create({
      data: {
        jobDescription,
        budget: parseInt(budget),
        shoeSize: parseFloat(shoeSize),
        brand,
        shoeName,
        releaseYear: parseInt(releaseYear),
        previouslyWorkedWith,
        service,
        subtypes: parsedSubtypes,
        userId: req.user.id,
        addressId: address.id,
      },
      include: {
        user: true,
        ownerAddress: true,
      },
    });

    // Handle picture uploads to S3
    const pictureUrls = await Promise.all(
      req.files.map((file) =>
        uploadRequestPhotosS3(file, request.id, req.user.id)
      )
    );

    // Update request with picture URLs
    await prisma.Request.update({
      where: { id: request.id },
      data: {
        pictures: pictureUrls,
      },
    });

    return res.status(201).json({
      message: "Request created successfully",
      request: {
        ...request,
        pictures: pictureUrls,
      },
    });
  } catch (error) {
    console.error("Error creating request:", error);
    return res.status(400).json({
      error: "Failed to create request",
      details: error.message,
    });
  }
});

export default router;
