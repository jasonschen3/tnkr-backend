import express from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "./auth.js";
import multer from "multer";
import { uploadRequestPhotosS3 } from "../utils/s3Upload.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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
        customerAddress: {
          connect: { id: address.id }, // Use connect instead of direct assignment
        },
        customer: {
          connect: { id: req.user.id },
        },
      },
      include: {
        customer: true,
        customerAddress: true,
      },
    });

    // Handle picture uploads to S3
    const pictureUrls = await Promise.all(
      req.files.map((file) =>
        uploadRequestPhotosS3(file, req.user.id, request.id)
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

// BOOKED for customer to see all their booked
router.get("/booked", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const request = await prisma.Request.findMany({
      where: {
        customerId: userId,
        requestStatus: "BOOKED",
      },
      include: {},
    });
  } catch (error) {
    console.error("Error retrieving booked", error);
  }
});

// BOOKED AND IN_PROGRESS
router.get("/current", verifyToken, async (req, res) => {
  const userId = req.user.id; // from VerifyToken

  try {
    const requests = await prisma.Request.findMany({
      where: {
        customerId: userId,
        requestStatus: {
          in: ["BOOKED", "IN_PROGRESS"],
        },
      },
      include: {
        customerAddress: true,
      },
      orderBy: {
        requestStatus: "desc",
      },
    });

    return res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching current requests", error);
  }
});

router.get("/completed", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const requests = await prisma.Request.findMany({
      where: {
        customerId: userId,
        requestStatus: "COMPLETE",
      },
      include: {
        customerAddress: true,
      },
      orderBy: {
        dateCreated,
        // eventually by date created
      },
    });
    return res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching completed orders", error);
  }
});

/** Requests for technicians with cursor based pagination */
router.get(
  "/allRequests",
  verifyToken,
  verifyRole("TECHNICIAN"),
  async (req, res) => {
    const { limit, cursor } = req.query;

    try {
      const items = await prisma.Request.findMany({
        where: {
          requestStatus: "BOOKED",
        },
        take: limit,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: {
          createdAt: "asc",
        },
      });

      const nextCursor =
        items.length > limit ? items[items.length - 1].id : null; // Last element's id if exists

      return res.status(200).json({
        data: items,
        nextCursor: nextCursor,
      });
    } catch (error) {
      console.error("Error getting requests");
    }
  }
);

export default router;
