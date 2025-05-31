import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import env from "dotenv";

import Stripe from "stripe";
import { prisma } from "./lib/prisma.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import requestsRoutes from "./routes/requests.js";

env.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use("/auth", authRoutes);
app.use("/users", userRoutes);
app.use("/requests", requestsRoutes);

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.listen(process.env.BACKEND_PORT, () => {
  console.log(`Server is running on port ${process.env.BACKEND_PORT}`);
});
