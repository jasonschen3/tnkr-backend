import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import env from "dotenv";

import Stripe from "stripe";
import { prisma } from "./lib/prisma.js";

env.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.get("/users", async (req, res) => {
  const users = await prisma.users.findMany();
  res.json(users);
});

app.post("/users", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      username,
      email,
      role,
      photo,
      password,
    } = req.body;

    const newUser = await prisma.users.create({
      data: {
        firstName,
        lastName,
        phone,
        username,
        email,
        role: role || "COLLECTOR", // defaults to COLLECTOR if not provided
        photo,
        password, // Note: In production, you should hash the password before storing
      },
    });

    // Don't send password back in response
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(400).json({
      error: "Failed to create user",
      details: error.message,
    });
  }
});

app.listen(process.env.BACKEND_PORT, () => {
  console.log(`Server is running on port ${process.env.BACKEND_PORT}`);
});
