import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import dotenv from "dotenv";

// Verification email
import nodemailer from "nodemailer";
import crypto from "crypto";

dotenv.config();

const router = express.Router();

const secretKey = process.env.SECRET_KEY;
const saltRounds = 10;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD,
  },
});

// Generate verification token for email
function generateVerificationCode() {
  return crypto.randomBytes(32).toString("hex");
}

function generateToken(user) {
  const payload = {
    id: user.user_id,
    username: user.username,
    role: user.role,
    email: user.email,
  };

  const options = { expiresIn: "2h" };
  return jwt.sign(payload, secretKey, options);
}

export function verifyToken(req, res, next) {
  const token = req.headers["access-token"];
  if (!token) {
    return res.status(403).send("No token provided");
  }

  jwt.verify(token, secretKey, (err, decoded) => {
    if (err) {
      return res.status(500).send("Failed to authenticate token");
    }
    req.user = decoded;
    next();
  });
}

function checkAdmin() {
  return (req, res, next) => {
    const isAdmin = req.user.role === "ADMIN";
    if (isAdmin) {
      next();
    } else {
      res
        .status(403)
        .json({ message: "You do not have the required permission level" });
    }
  };
}

async function comparePassword(plainPassword, hashedPassword) {
  const isMatch = await bcrypt.compare(plainPassword, hashedPassword);
  return isMatch;
}

async function hashPassword(password) {
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  return hashedPassword;
}

async function checkUserExists(username) {
  try {
    const user = await prisma.user.findUnique({
      where: {
        username: username,
      },
    });
    return user !== null;
  } catch (err) {
    console.error("Error checking user existence:", err);
    throw err;
  }
}

async function checkEmailExists(email) {
  try {
    const user = await prisma.user.findUnique({
      where: {
        email: email,
      },
    });
    return user !== null;
  } catch (err) {
    console.error("Error checking user existence:", err);
    throw err;
  }
}

// Send verification email
async function sendVerificationEmail(email, code) {
  const verificationLink = `${process.env.FRONTEND_URL}/verify-email?code=${code}`;

  const mailOptions = {
    from: `"TNKR" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: "Verify your email address",
    html: `
      <h1>TNKR Email Verification</h1>
      <p>Please click the link below to verify your email address:</p>
      <a href="${verificationLink}">Verify Email</a>
      <p>This link will expire in 24 hours.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
}

// Verification endpoint
router.get("/verify-email", async (req, res) => {
  const { code } = req.query;

  try {
    const verificationToken = await prisma.VerificationToken.findUnique({
      where: { code },
    });

    if (!verificationToken) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    if (verificationToken.expiresAt < new Date()) {
      return res.status(400).json({ message: "Verification code has expired" });
    }

    // Update user verification status
    await prisma.User.update({
      where: { email: verificationToken.email },
      data: { isVerified: true },
    });

    // Delete the used verification token
    await prisma.VerificationToken.delete({
      where: { code },
    });

    return res.status(200).json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("Error verifying email:", error);
    return res.status(500).json({ message: "Error verifying email" });
  }
});

router.post("/register", async (req, res) => {
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

    // Check username and email existence
    const userExists = await checkUserExists(username);
    if (userExists) {
      return res.status(409).json({ message: "Username already exists" });
    }

    const emailExists = await checkEmailExists(email);
    if (emailExists) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hashedPassword = await hashPassword(password);

    // Create user
    const newUser = await prisma.User.create({
      data: {
        firstName,
        lastName,
        phone,
        username,
        email,
        role: role || "COLLECTOR",
        photo,
        password: hashedPassword,
        isVerified: false,
      },
    });

    // Create verification token
    const verificationCode = generateVerificationCode();
    await prisma.VerificationToken.create({
      data: {
        code: verificationCode,
        email: email,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Send verification email
    await sendVerificationEmail(email, verificationCode);

    // Don't send password back in response
    const { password: _, ...userWithoutPassword } = newUser;
    return res.status(201).json({
      ...userWithoutPassword,
      message:
        "Registration successful. Please check your email to verify your account.",
    });
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(400).json({
      error: "Failed to create user",
      details: error.message,
    });
  }
});

// Email
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("Attempting login with email:", email);

  try {
    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    // Find user
    const user = await prisma.User.findUnique({
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
        password: true,
        role: true,
        isVerified: true,
      },
    });

    // Check if user exists
    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Check if user is verified
    if (!user.isVerified) {
      return res.status(403).json({
        message: "Please verify your email before logging in",
      });
    }

    // Verify password
    const valid = await comparePassword(password, user.password);
    if (!valid) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Generate token
    const token = generateToken(user);

    // Return success response
    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.user_id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Error during login:", err);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

export default router;
