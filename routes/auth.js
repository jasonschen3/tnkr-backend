import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import dotenv from "dotenv";
// import nodemailer from nodemailer

dotenv.config();

const router = express.Router();

const secretKey = process.env.SECRET_KEY;
const saltRounds = 10;

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

router.get("/test", async (req, res) => {
  const fds = await checkUserExists("jchen");
  console.log(fds);
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

    // Check username existence first
    const userExists = await checkUserExists(username);
    if (userExists) {
      return res.status(409).json({ message: "Username already exists" });
    }

    // Check email existence
    const emailExists = await checkEmailExists(email);
    if (emailExists) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hashedPassword = await hashPassword(password);

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
      },
    });

    // Don't send password back in response
    const { password: _, ...userWithoutPassword } = newUser;
    return res.status(201).json(userWithoutPassword);
  } catch (error) {
    console.error("Error creating user:", error);
    return res.status(400).json({
      error: "Failed to create user",
      details: error.message,
    });
  }
});

// Login with email
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("Attempting login with email:", email);

  try {
    const user = await prisma.User.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).send("Invalid credentials");
    }

    const valid = await comparePassword(password, user.password);

    if (valid) {
      const token = generateToken(user);
      return res.status(200).json({ token });
    } else {
      return res.status(401).send("Invalid credentials");
    }
  } catch (err) {
    console.error("Error during login with email:", err);
    return res.status(500).send("Internal server error");
  }
});

export default router;
