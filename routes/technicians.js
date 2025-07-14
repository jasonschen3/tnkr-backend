import express from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "./auth.js";
import { verifyRole } from "./auth.js";
import { requireTechnicianVerification } from "../middleware/technicianVerification.js";

const router = express.Router();

// Get technician profile
router.get(
  "/profile",
  verifyToken,
  verifyRole("TECHNICIAN"),
  requireTechnicianVerification,
  async (req, res) => {
    const userId = req.user.id;

    try {
      const technicianProfile = await prisma.TechnicianProfile.findUnique({
        where: { userId },
        include: {
          technicianAddress: true,
          portfolio: true,
        },
      });

      if (!technicianProfile) {
        return res.status(404).json({
          error: "Technician profile not found",
          needsSetup: true,
        });
      }

      return res.status(200).json(technicianProfile);
    } catch (error) {
      console.error("Error fetching technician profile:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Create or update technician profile
router.post(
  "/profile",
  verifyToken,
  verifyRole("TECHNICIAN"),
  async (req, res) => {
    const userId = req.user.id;
    const {
      servicesProvided,
      businessName,
      businessRegistered,
      incorpNumber,
      websiteLink,
      socialMediaLink,
      bio,
      address,
    } = req.body;

    try {
      // Validate required fields
      if (
        !servicesProvided ||
        !businessName ||
        !websiteLink ||
        !bio ||
        !address
      ) {
        return res.status(400).json({
          error: "Missing required fields",
          required: [
            "servicesProvided",
            "businessName",
            "websiteLink",
            "bio",
            "address",
          ],
        });
      }

      // Create or update technician profile
      const technicianProfile = await prisma.TechnicianProfile.upsert({
        where: { userId },
        update: {
          servicesProvided,
          businessName,
          businessRegistered: businessRegistered || false,
          incorpNumber,
          websiteLink,
          socialMediaLink: socialMediaLink || [],
          bio,
          isVerifiedTechnician: false, // Will be verified by admin
        },
        create: {
          userId,
          servicesProvided,
          businessName,
          businessRegistered: businessRegistered || false,
          incorpNumber,
          websiteLink,
          socialMediaLink: socialMediaLink || [],
          bio,
          isVerifiedTechnician: false,
        },
      });

      // Create or update address
      if (address) {
        await prisma.TechnicianAddress.upsert({
          where: { technicianProfileId: userId },
          update: {
            street: address.street,
            city: address.city,
            stateCode: address.stateCode,
            zipCode: address.zipCode,
          },
          create: {
            technicianProfileId: userId,
            street: address.street,
            city: address.city,
            stateCode: address.stateCode,
            zipCode: address.zipCode,
          },
        });
      }

      return res.status(200).json({
        message: "Technician profile created successfully",
        profile: technicianProfile,
        needsVerification: true,
      });
    } catch (error) {
      console.error("Error creating technician profile:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Check if technician profile is complete and verified
router.get(
  "/verification-status",
  verifyToken,
  verifyRole("TECHNICIAN"),
  async (req, res) => {
    const userId = req.user.id;

    try {
      const technicianProfile = await prisma.TechnicianProfile.findUnique({
        where: { userId },
        include: {
          technicianAddress: true,
        },
      });

      if (!technicianProfile) {
        return res.status(200).json({
          hasProfile: false,
          isVerified: false,
          needsSetup: true,
          message:
            "Please complete your technician profile to access the dashboard",
        });
      }

      if (!technicianProfile.isVerifiedTechnician) {
        return res.status(200).json({
          hasProfile: true,
          isVerified: false,
          needsVerification: true,
          message:
            "Your profile is under review. You'll be notified once verified.",
        });
      }

      return res.status(200).json({
        hasProfile: true,
        isVerified: true,
        canAccessDashboard: true,
        profile: technicianProfile,
      });
    } catch (error) {
      console.error("Error checking verification status:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Admin endpoint to verify technician (protected by ADMIN role)
router.put(
  "/verify/:technicianId",
  verifyToken,
  verifyRole("ADMIN"),
  async (req, res) => {
    const { technicianId } = req.params;
    const { status } = req.body;

    try {
      if (status === "APPROVED") {
        await prisma.TechnicianProfile.update({
          where: { userId: technicianId },
          data: {
            isVerifiedTechnician: true,
          },
        });
      } else if (status === "REJECTED") {
        await prisma.TechnicianProfile.update({
          where: { userId: technicianId },
          data: {
            isVerifiedTechnician: false,
          },
        });
      }

      return res.status(200).json({
        message: `Technician ${status.toLowerCase()} successfully`,
        status,
      });
    } catch (error) {
      console.error("Error verifying technician:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Get all pending technician verifications (admin only)
router.get(
  "/pending-verifications",
  verifyToken,
  verifyRole("ADMIN"),
  async (req, res) => {
    try {
      const pendingTechnicians = await prisma.TechnicianProfile.findMany({
        where: {
          isVerifiedTechnician: false,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              createdAt: true,
            },
          },
          technicianAddress: true,
        },
      });

      return res.status(200).json(pendingTechnicians);
    } catch (error) {
      console.error("Error fetching pending verifications:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
