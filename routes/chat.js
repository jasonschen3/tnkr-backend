import express from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "./auth.js";

const router = express.Router();

// Get all conversations for a user (the first page in messages)
router.get("/conversations", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    // Get current user to determine their role
    const currentUser = await prisma.User.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    let conversations = [];

    if (currentUser?.role === "TECHNICIAN") {
      // For technicians, get both existing conversations and potential customers
      const existingConversations = await prisma.$queryRaw`
        SELECT 
          "otherUserId",
          MAX("createdAt") as "lastMessageAt"
        FROM (
          SELECT 
            CASE 
              WHEN m."senderId" = ${userId} THEN m."receiverId"
              ELSE m."senderId"
            END as "otherUserId",
            m."createdAt"
          FROM "Message" m
          WHERE m."senderId" = ${userId} OR m."receiverId" = ${userId}
        ) subquery
        GROUP BY "otherUserId"
      `;

      // Get potential customers (users who have made requests)
      const potentialCustomers = await prisma.$queryRaw`
        SELECT DISTINCT
          r."customerId" as "otherUserId",
          r."createdAt" as "lastMessageAt"
        FROM "Request" r
        WHERE r."customerId" != ${userId}
        AND r."customerId" NOT IN (
          SELECT DISTINCT
            CASE 
              WHEN m."senderId" = ${userId} THEN m."receiverId"
              ELSE m."senderId"
            END
          FROM "Message" m
          WHERE m."senderId" = ${userId} OR m."receiverId" = ${userId}
        )
      `;

      // Combine and deduplicate
      const allUserIds = new Set();
      conversations = [...existingConversations, ...potentialCustomers]
        .filter((conv) => {
          if (allUserIds.has(conv.otherUserId)) {
            return false;
          }
          allUserIds.add(conv.otherUserId);
          return true;
        })
        .sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime()
        );
    } else {
      // For customers, only get existing conversations
      conversations = await prisma.$queryRaw`
        SELECT 
          "otherUserId",
          MAX("createdAt") as "lastMessageAt"
        FROM (
          SELECT 
            CASE 
              WHEN m."senderId" = ${userId} THEN m."receiverId"
              ELSE m."senderId"
            END as "otherUserId",
            m."createdAt"
          FROM "Message" m
          WHERE m."senderId" = ${userId} OR m."receiverId" = ${userId}
        ) subquery
        GROUP BY "otherUserId"
        ORDER BY "lastMessageAt" DESC
      `;
    }

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

        if (!otherUser) {
          return null; // Skip if user doesn't exist
        }

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
          conversationId: conv.otherUserId,
          otherUser,
          lastMessage,
          lastMessageAt: lastMessage
            ? lastMessage.createdAt
            : conv.lastMessageAt,
        };
      })
    );

    // Filter out null entries and return
    const validConversations = conversationsWithDetails.filter(Boolean);
    return res.status(200).json(validConversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

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

router.post("/message/:otherUserId", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { otherUserId } = req.params;
  const { content } = req.body;

  // Input validation
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return res
      .status(400)
      .json({ error: "Message content is required and cannot be empty" });
  }

  // Sanitize content to prevent XSS
  const sanitizedContent = content.trim();

  try {
    // Verify the other user exists
    const otherUser = await prisma.User.findUnique({
      where: { id: otherUserId },
      select: { id: true },
    });

    if (!otherUser) {
      return res.status(404).json({ error: "Recipient user not found" });
    }

    // Create the message
    const message = await prisma.Message.create({
      data: {
        senderId: userId,
        receiverId: otherUserId,
        content: sanitizedContent,
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
    });

    // Emit real-time notification via Socket.IO (stateless approach)
    const io = req.app.locals.io;
    if (io) {
      console.log("REST endpoint emitting new message to receiver:", {
        receiverId: otherUserId,
        messageId: message.id,
        senderId: message.senderId,
        messageReceiverId: message.receiverId,
      });
      io.to(`user:${otherUserId}`).emit("new message", message);
    }

    return res.status(201).json(message);
  } catch (error) {
    console.error("Error sending message:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
