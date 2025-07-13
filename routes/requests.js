import express from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken, verifyRole } from "./auth.js";
import multer from "multer";
import { uploadRequestPhotosS3 } from "../utils/s3Upload.js";
import {
  getCacheKey,
  getCache,
  setCache,
  invalidateCache,
  TEN_MINUTE_TTL,
} from "../utils/cache.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Customer adds requests
router.post(
  "/",
  verifyToken,
  verifyRole("CUSTOMER"),
  upload.array("pictures"),
  async (req, res) => {
    const userId = req.user.id;
    const redisClient = req.app.locals.redisClient;
    const cacheCurrentRequestKey = getCacheKey(userId, "current-requests");
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
          street,
          city,
          stateCode,
          zipCode,
          customer: {
            connect: { id: req.user.id },
          },
        },
        include: {
          customer: true,
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

      invalidateCache(redisClient, cacheCurrentRequestKey);

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
  }
);

// BOOKED for customer to see all their booked
/// NOT USED
// router.get("/booked", verifyToken, async (req, res) => {
//   const userId = req.user.id;
//   const redisClient = req.app.locals.redisClient;
//   const cacheRequestKey = getCacheKey(userId, "request");

//   try {
//     const cachedRequest = await getCache(redisClient, cacheRequestKey);

//     if (cachedRequest) {

//     }

//     const request = await prisma.Request.findMany({
//       where: {
//         customerId: userId,
//         requestStatus: "BOOKED",
//       },
//       include: {},
//     });
//   } catch (error) {
//     console.error("Error retrieving booked", error);
//   }
// });

// BOOKED AND IN_PROGRESS
router.get("/current", verifyToken, async (req, res) => {
  const userId = req.user.id; // from VerifyToken
  const redisClient = req.app.locals.redisClient;
  const cacheCurrentRequestKey = getCacheKey(userId, "current-requests");

  try {
    const cachedRequest = await getCache(redisClient, cacheCurrentRequestKey);

    if (cachedRequest) {
      console.log("hit");
      return res.status(200).json(cachedRequest);
    }
    console.log("miss");

    const requests = await prisma.Request.findMany({
      where: {
        customerId: userId,
        requestStatus: {
          in: ["BOOKED", "IN_PROGRESS"],
        },
      },
      orderBy: {
        requestStatus: "desc",
      },
    });

    await setCache(
      redisClient,
      cacheCurrentRequestKey,
      requests,
      TEN_MINUTE_TTL
    );

    return res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching current requests", error);
  }
});

router.get("/completed", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const redisClient = req.app.locals.redisClient;
  const cacheCompletedRequestKey = getCacheKey(userId, "completed-requests");

  try {
    const cachedRequest = await getCache(redisClient, cacheCompletedRequestKey);

    if (cachedRequest) {
      console.log("hit");
      return res.status(200).json(cachedRequest);
    }
    console.log("miss");

    const requests = await prisma.Request.findMany({
      where: {
        customerId: userId,
        requestStatus: "COMPLETE",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    await setCache(
      redisClient,
      cacheCompletedRequestKey,
      requests,
      TEN_MINUTE_TTL
    );

    return res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching completed orders", error);
  }
});

/** -------- Requests for technicians with cursor based pagination -------- */
router.get(
  "/technicianRequests",
  verifyToken,
  verifyRole("TECHNICIAN"),
  async (req, res) => {
    const { limit, cursor } = req.query;
    const parsedLimited = parseInt(limit);

    try {
      const items = await prisma.Request.findMany({
        where: {
          requestStatus: "BOOKED",
        },
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
        take: parsedLimited,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: {
          createdAt: "asc",
        },
      });

      if (items.length === 0) {
        res.status(200).json({
          data: [],
        });
      }

      const nextCursor = items[items.length - 1].id; // Last element's id

      return res.status(200).json({
        data: items,
        nextCursor: nextCursor,
      });
    } catch (error) {
      console.error("Error getting requests", error);
    }
  }
);

router.get("/:id", verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    const request = await prisma.Request.findUnique({
      where: {
        id: id,
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({
        error: "Request not found",
      });
    }

    return res.status(200).json(request);
  } catch (error) {
    console.error("Error fetching request:", error);
    return res.status(500).json({
      error: "Failed to fetch request",
      details: error.message,
    });
  }
});

export default router;
