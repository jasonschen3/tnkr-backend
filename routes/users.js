import express from "express";
import { prisma } from "../lib/prisma.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

export default router;
