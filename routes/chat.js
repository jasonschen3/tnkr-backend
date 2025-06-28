import express from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "./auth.js";

const router = express.Router();

// Get all conversations for a user
router.get("/conversations", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    // Get all unique conversations (people the user has messaged with)
    const conversations = await prisma.$queryRaw`
      SELECT DISTINCT 
        CASE 
          WHEN m.senderId = ${userId} THEN m.receiverId
          ELSE m.senderId
        END as otherUserId,
        CASE 
          WHEN m.senderId = ${userId} THEN m.receiverId
          ELSE m.senderId
        END as conversationId,
        MAX(m.createdAt) as lastMessageAt
      FROM "Message" m
      WHERE m.senderId = ${userId} OR m.receiverId = ${userId}
      GROUP BY otherUserId
      ORDER BY lastMessageAt DESC
    `;

    // Get user details and last message for each conversation
    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conv) => {
        const otherUser = await prisma.User.findUnique({
          where: { id: conv.otherUserId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePictureUrl: true,
            role: true,
          },
        });

        const lastMessage = await prisma.Message.findFirst({
          where: {
            OR: [
              { senderId: userId, receiverId: conv.otherUserId },
              { senderId: conv.otherUserId, receiverId: userId },
            ],
          },
          orderBy: { createdAt: "desc" },
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        });

        return {
          conversationId: conv.conversationId,
          otherUser,
          lastMessage,
          lastMessageAt: conv.lastMessageAt,
        };
      })
    );

    return res.status(200).json(conversationsWithDetails);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get messages between two users
router.get("/messages/:otherUserId", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { otherUserId } = req.params;

  try {
    const messages = await prisma.Message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: userId },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePictureUrl: true,
          },
        },
        receiver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePictureUrl: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
