import { prisma } from "../lib/prisma.js";

export const requireTechnicianVerification = async (req, res, next) => {
  // Only apply to technicians
  if (req.user.role !== "TECHNICIAN") {
    return next();
  }

  try {
    const technicianProfile = await prisma.TechnicianProfile.findUnique({
      where: { userId: req.user.id },
      select: { isVerifiedTechnician: true },
    });

    // If no profile exists, redirect to setup
    if (!technicianProfile) {
      return res.status(403).json({
        error: "Technician profile not found",
        needsSetup: true,
        message: "Please complete your technician profile setup first",
      });
    }

    // If not verified, block access
    if (!technicianProfile.isVerifiedTechnician) {
      return res.status(403).json({
        error: "Technician not verified",
        needsVerification: true,
        message:
          "Your technician profile is under review. Please wait for verification.",
      });
    }

    // If verified, allow access
    next();
  } catch (error) {
    console.error("Error checking technician verification:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

// Middleware to check verification status without blocking (for status endpoints)
export const checkTechnicianVerification = async (req, res, next) => {
  if (req.user.role !== "TECHNICIAN") {
    return next();
  }

  try {
    const technicianProfile = await prisma.TechnicianProfile.findUnique({
      where: { userId: req.user.id },
      select: { isVerifiedTechnician: true },
    });

    req.technicianVerificationStatus = {
      hasProfile: !!technicianProfile,
      isVerified: technicianProfile?.isVerifiedTechnician || false,
      needsSetup: !technicianProfile,
      needsVerification:
        technicianProfile && !technicianProfile.isVerifiedTechnician,
    };

    next();
  } catch (error) {
    console.error("Error checking technician verification status:", error);
    req.technicianVerificationStatus = {
      hasProfile: false,
      isVerified: false,
      needsSetup: true,
      needsVerification: false,
    };
    next();
  }
};
