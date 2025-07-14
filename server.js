import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import env from "dotenv";

import { prisma } from "./lib/prisma.js";
import { createClient } from "redis";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import requestsRoutes from "./routes/requests.js";
import chatRoutes from "./routes/chat.js";
import technicianRoutes from "./routes/technicians.js";

import { Server } from "socket.io";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";

env.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/requests", requestsRoutes);
app.use("/chat", chatRoutes);
app.use("/technicians", technicianRoutes);

// --------- Cache client ---------
const redisClient = createClient();
// createClient({
//   url: 'redis://alice:foobared@awesome.redis.server:6380'
// });
redisClient.on("error", (error) =>
  console.log("Redis Client Error", error.message)
);
await redisClient.connect();
app.locals.redisClient = redisClient;

// --------- Stripe ---------

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --------- SocketIO for messaging ---------

const socketServer = createServer(app);

const io = new Server(socketServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
  },
});

// Make io available to routes
app.locals.io = io;

// Middleware: runs before "connection" event for auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Missing token"));
  }

  try {
    const user = jwt.verify(token, process.env.JWT_SECRET_KEY);
    socket.user = user;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

// On connection, give socket instance
io.on("connection", (socket) => {
  console.log("User connected:", socket.user.id);

  // Join user to their personal room
  socket.join(`user:${socket.user.id}`);
  console.log("User joined room:", `user:${socket.user.id}`);

  socket.on("send message", async (messageData, callback) => {
    console.log("Received send message request:", {
      messageData,
      userId: socket.user.id,
    });
    try {
      const { receiverId, content } = messageData;

      // Rate limiting using Redis (stateless)
      const rateLimitKey = `rate_limit:${socket.user.id}`;
      const now = Date.now();
      const windowStart = now - 60000; // 1 minute window

      try {
        // Get current rate limit data from Redis
        const rateLimitData = await redisClient.get(rateLimitKey);
        let messageCount = 0;

        if (rateLimitData) {
          const messages = JSON.parse(rateLimitData);
          // Filter messages within the current window
          const recentMessages = messages.filter(
            (timestamp) => timestamp > windowStart
          );
          messageCount = recentMessages.length;
        }

        if (messageCount >= 10) {
          // Max 10 messages per minute
          return callback({
            status: "error",
            error:
              "Rate limit exceeded. Please wait before sending more messages.",
          });
        }

        // Add current message timestamp
        let messages = [];
        if (rateLimitData) {
          messages = JSON.parse(rateLimitData);
        }
        messages.push(now);

        // Store updated rate limit data with 1 minute expiration
        await redisClient.setEx(rateLimitKey, 60, JSON.stringify(messages));
      } catch (error) {
        console.error("Rate limiting error:", error);
        // Continue without rate limiting if Redis fails
      }

      // Input validation
      if (
        !content ||
        typeof content !== "string" ||
        content.trim().length === 0
      ) {
        return callback({
          status: "error",
          error: "Message content is required and cannot be empty",
        });
      }

      if (!receiverId || typeof receiverId !== "string") {
        return callback({
          status: "error",
          error: "Receiver ID is required",
        });
      }

      // Sanitize content to prevent XSS
      const sanitizedContent = content.trim();

      // Verify the receiver exists
      const receiver = await prisma.User.findUnique({
        where: { id: receiverId },
        select: { id: true },
      });

      if (!receiver) {
        return callback({
          status: "error",
          error: "Recipient user not found",
        });
      }

      // Create message in database
      const message = await prisma.Message.create({
        data: {
          content: sanitizedContent,
          senderId: socket.user.id,
          receiverId,
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

      // Send to receiver using Socket.IO rooms (stateless approach)
      console.log("Emitting new message to receiver:", {
        receiverId,
        messageId: message.id,
        senderId: message.senderId,
        messageReceiverId: message.receiverId,
      });
      io.to(`user:${receiverId}`).emit("new message", message);

      // Send confirmation to sender
      callback({ status: "ok", message });
    } catch (error) {
      console.error("Error sending message:", error);
      callback({ status: "error", error: "Failed to send message" });
    }
  });

  socket.on("join conversation", (requestId) => {
    socket.join(`request:${requestId}`);
    console.log(
      `User ${socket.user.id} joined conversation for request ${requestId}`
    );
  });

  socket.on("leave conversation", (requestId) => {
    socket.leave(`request:${requestId}`);
    console.log(
      `User ${socket.user.id} left conversation for request ${requestId}`
    );
  });

  socket.on("disconnect", (reason) => {
    console.log("User disconnected:", socket.user.id, reason);
  });
});

socketServer.listen(process.env.BACKEND_PORT, () => {
  console.log(`Server is running on port ${process.env.BACKEND_PORT}`);
});
