import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import env from "dotenv";

import Stripe from "stripe";
// import { PrismaClient } from "@prisma/client";

env.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// const prisma = new PrismaClient();
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.listen(process.env.BACKEND_PORT, () => {
  console.log(`Server is running on port ${process.env.BACKEND_PORT}`);
});
