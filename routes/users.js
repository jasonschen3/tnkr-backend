import express from "express";
import { prisma } from "../lib/prisma.js";
import dotenv from "dotenv";

import { verifyToken } from "./auth.js";

dotenv.config();

const router = express.Router();

router.get("/profile", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const userData = await prisma.User.findUnique({
      where: {
        id: userId,
      },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        profilePictureUrl: true,
        role: true,
        ratingsReceived: {
          select: {
            rating: true,
            description: true,
            createdAt: true,
            reviewer: {
              select: {
                firstName: true,
                lastName: true,
                profilePictureUrl: true,
              },
            },
          },
        },
        ratingsGiven: {
          select: {
            rating: true,
            description: true,
            createdAt: true,
            reviewee: {
              select: {
                firstName: true,
                lastName: true,
                profilePictureUrl: true,
              },
            },
          },
        },
      },
    });

    const averageRating =
      userData.ratingsReceived.length > 0
        ? userData.ratingsReceived.reduce((acc, curr) => acc + curr.rating, 0) /
          userData.ratingsReceived.length
        : 0;

    const enhancedUserData = {
      ...userData,
      averageRating: Math.round(averageRating * 10) / 10,
      totalRatings: userData.ratingsReceived.length,
    };

    return res.status(200).json(enhancedUserData);
  } catch (error) {
    console.error("Couldn't fetch userdata", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/profile", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { firstName, lastName, phone, profilePictureUrl } = req.body;

  try {
    await prisma.User.update({
      where: { id: userId },
      data: {
        firstName,
        lastName,
        phone,
        profilePictureUrl,
      },
    });

    console.log("done");
    return res.status(200).json();
  } catch (error) {
    console.error("Couldn't update user profile", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
