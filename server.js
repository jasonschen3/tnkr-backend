import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import env from "dotenv";

import Stripe from "stripe";
import { prisma } from "./lib/prisma.js";
import { createClient } from "redis";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import requestsRoutes from "./routes/requests.js";
import chatRoutes from "./routes/chat.js";

import { WebSocketServer } from "ws";
import { createServer } from "http";

env.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/requests", requestsRoutes);
app.use("/chat", chatRoutes);

// --------- Cache client ---------
const redisClient = createClient();
// createClient({
//   url: 'redis://alice:foobared@awesome.redis.server:6380'
// });
redisClient.on("error", (err) => console.log("Redis Client Error", err));
await redisClient.connect();
app.locals.redisClient = redisClient;

// --------- Stripe ---------

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --------- WebSocket for messaging ---------

const wss = new WebSocketServer({ port: 8080 });

wss.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("message", (message) => {
    console.log("Received:", message);
    socket.send(`Server says: ${message}`);
  });

  socket.on("close", () => {
    console.log("Client disconnected");
  });
});

// const server = createServer(app); // Creates HTTP server from Express app
// const wss = new WebSocketServer({ server });

// // Store active connections
const connections = new Map();

// wss.on("connection", (ws, req) => {
//   console.log("New WebSocket connection");

//   const token = localStorage.get("token");
//   const user = token.user;
//   console.log("USER", user);

//   if (!user) {
//     ws.close(1008, "Unauthorized");
//     return;
//   }

//   // Store connection
//   connections.set(user.id, ws);
//   console.log(`User ${user.id} connected`);

//   // Send online status to user
//   ws.send(
//     JSON.stringify({
//       type: "CONNECTED",
//       userId: user.id,
//     })
//   );

//   ws.on("message", async (data) => {
//     try {
//       const message = JSON.parse(data);

//       switch (message.type) {
//         case "SEND_MESSAGE":
//           await handleSendMessage(ws, message, user.id);
//           break;

//         case "TYPING_START":
//           handleTypingStart(ws, message, user.id);
//           break;

//         case "TYPING_STOP":
//           handleTypingStop(ws, message, user.id);
//           break;

//         case "MARK_AS_READ":
//           await handleMarkAsRead(ws, message, user.id);
//           break;

//         default:
//           ws.send(
//             JSON.stringify({
//               type: "ERROR",
//               message: "Unknown message type",
//             })
//           );
//       }
//     } catch (error) {
//       console.error("WebSocket message error:", error);
//       ws.send(
//         JSON.stringify({
//           type: "ERROR",
//           message: "Invalid message format",
//         })
//       );
//     }
//   });

//   ws.on("close", () => {
//     connections.delete(user.id);
//     console.log(`User ${user.id} disconnected`);
//   });
// });

// // WebSocket message handlers
// async function handleSendMessage(ws, message, senderId) {
//   const { receiverId, content, requestId } = message;

//   try {
//     // Save message to database
//     const savedMessage = await prisma.Message.create({
//       data: {
//         content,
//         senderId,
//         receiverId,
//         requestId,
//       },
//       include: {
//         sender: {
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             profilePictureUrl: true,
//           },
//         },
//         receiver: {
//           select: {
//             id: true,
//             firstName: true,
//             lastName: true,
//             profilePictureUrl: true,
//           },
//         },
//       },
//     });

//     // Send to receiver if online
//     const receiverWs = connections.get(receiverId);
//     if (receiverWs && receiverWs.readyState === 1) {
//       receiverWs.send(
//         JSON.stringify({
//           type: "NEW_MESSAGE",
//           message: {
//             id: savedMessage.id,
//             content: savedMessage.content,
//             sender: savedMessage.sender,
//             receiver: savedMessage.receiver,
//             requestId: savedMessage.requestId,
//             createdAt: savedMessage.createdAt,
//           },
//         })
//       );
//     }

//     // Confirm to sender
//     ws.send(
//       JSON.stringify({
//         type: "MESSAGE_SENT",
//         messageId: savedMessage.id,
//       })
//     );
//   } catch (error) {
//     console.error("Error saving message:", error);
//     ws.send(
//       JSON.stringify({
//         type: "ERROR",
//         message: "Failed to send message",
//       })
//     );
//   }
// }

// function handleTypingStart(ws, message, senderId) {
//   const { receiverId } = message;
//   const receiverWs = connections.get(receiverId);

//   if (receiverWs && receiverWs.readyState === 1) {
//     receiverWs.send(
//       JSON.stringify({
//         type: "TYPING_START",
//         senderId,
//       })
//     );
//   }
// }

// function handleTypingStop(ws, message, senderId) {
//   const { receiverId } = message;
//   const receiverWs = connections.get(receiverId);

//   if (receiverWs && receiverWs.readyState === 1) {
//     receiverWs.send(
//       JSON.stringify({
//         type: "TYPING_STOP",
//         senderId,
//       })
//     );
//   }
// }

// async function handleMarkAsRead(ws, message, userId) {
//   const { senderId } = message;

//   try {
//     // You can add an isRead field to your Message model if needed
//     // await prisma.Message.updateMany({
//     //   where: {
//     //     senderId,
//     //     receiverId: userId,
//     //     isRead: false
//     //   },
//     //   data: { isRead: true }
//     // });

//     // Notify sender that messages were read
//     const senderWs = connections.get(senderId);
//     if (senderWs && senderWs.readyState === 1) {
//       senderWs.send(
//         JSON.stringify({
//           type: "MESSAGES_READ",
//           readerId: userId,
//         })
//       );
//     }
//   } catch (error) {
//     console.error("Error marking messages as read:", error);
//   }
// }

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.listen(process.env.BACKEND_PORT, () => {
  console.log(`Server is running on port ${process.env.BACKEND_PORT}`);
});
