import express from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "./auth.js";
import { verifyRole } from "./auth.js";
import { requireTechnicianVerification } from "../middleware/technicianVerification.js";
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD,
  },
});

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
          verificationStatus: "PENDING", // Reset to pending when updated
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
          verificationStatus: "PENDING",
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

      // Fetch user info for email
      const user = await prisma.User.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true },
      });

      // Send notification email to admins
      const mailOptions = {
        from: `"TNKR" <${process.env.GMAIL_USER}>`,
        to: ["will@tnkrsneakers.com", "jasonschen3@gmail.com"],
        subject: "Technician Profile Submitted for Verification",
        html: `
          <h2>Technician Profile Submitted: Verify on Admin Dashboard</h2>
          <p><strong>Name:</strong> ${user?.firstName || ""} ${
          user?.lastName || ""
        }</p>
          <p><strong>Email:</strong> ${user?.email || ""}</p>
          <p><strong>Business Name:</strong> ${businessName}</p>
          <p><strong>Website:</strong> ${websiteLink}</p>
          <p><strong>Bio:</strong> ${bio}</p>
          <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
        `,
      };
      transporter.sendMail(mailOptions).catch((err) => {
        console.error("Failed to send technician verification email:", err);
      });

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

      if (technicianProfile.verificationStatus === "PENDING") {
        return res.status(200).json({
          hasProfile: true,
          isVerified: false,
          needsVerification: true,
          message:
            "Your profile is under review. You'll be notified once verified.",
        });
      }

      if (technicianProfile.verificationStatus === "REJECTED") {
        return res.status(200).json({
          hasProfile: true,
          isVerified: false,
          needsVerification: false,
          needsReapplication: true,
          message:
            "Your profile was not approved. Please update your information and resubmit.",
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
    const { status, rejectionReason } = req.body;

    try {
      // Fetch technician and user info for email
      const technicianProfile = await prisma.TechnicianProfile.findUnique({
        where: { userId: technicianId },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      if (!technicianProfile) {
        return res.status(404).json({ error: "Technician profile not found" });
      }

      if (status === "APPROVED") {
        await prisma.TechnicianProfile.update({
          where: { userId: technicianId },
          data: {
            isVerifiedTechnician: true,
            verificationStatus: "APPROVED",
          },
        });

        // Send approval email to technician
        const approvalMailOptions = {
          from: `"TNKR" <${process.env.GMAIL_USER}>`,
          to: technicianProfile.user.email,
          subject:
            "Congratulations! Your TNKR Technician Application Has Been Approved",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
                <h1 style="margin: 0; font-size: 28px;">🎉 Welcome to TNKR!</h1>
                <p style="margin: 10px 0 0 0; font-size: 18px;">Your technician application has been approved</p>
              </div>
              
              <div style="padding: 30px; background: #f9f9f9;">
                <h2 style="color: #333; margin-top: 0;">Hello ${
                  technicianProfile.user.firstName
                }!</h2>
                
                <p style="color: #555; line-height: 1.6;">
                  Great news! Your technician application for <strong>${
                    technicianProfile.businessName
                  }</strong> has been reviewed and approved by our team.
                </p>
                
                <div style="background: #e8f5e8; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 4px;">
                  <h3 style="color: #2e7d32; margin-top: 0;">✅ What's Next?</h3>
                  <ul style="color: #555; margin: 10px 0;">
                    <li>You can now access all technician features in your dashboard</li>
                    <li>Browse available cleaning requests from customers</li>
                    <li>Submit offers and start earning</li>
                    <li>Build your portfolio and reputation</li>
                  </ul>
                </div>
                
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 4px;">
                  <h3 style="color: #856404; margin-top: 0;">💡 Tips for Success</h3>
                  <ul style="color: #555; margin: 10px 0;">
                    <li>Complete your portfolio with high-quality before/after photos</li>
                    <li>Respond quickly to customer requests</li>
                    <li>Maintain excellent communication throughout the process</li>
                    <li>Deliver exceptional results to build positive reviews</li>
                  </ul>
                </div>
                
                <p style="color: #555; line-height: 1.6;">
                  If you have any questions or need assistance getting started, please don't hesitate to reach out to our support team at <a href="mailto:support@tnkr.com" style="color: #667eea;">support@tnkr.com</a>.
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${
                    process.env.FRONTEND_URL || "https://tnkr.com"
                  }/dashboard/technician" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                    Access Your Dashboard
                  </a>
                </div>
                
                <p style="color: #777; font-size: 14px; text-align: center; margin-top: 30px;">
                  Welcome to the TNKR family! We're excited to see the amazing work you'll do.
                </p>
              </div>
              
              <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
                <p style="margin: 0;">© 2024 TNKR. All rights reserved.</p>
                <p style="margin: 5px 0 0 0;">Questions? Contact us at <a href="mailto:support@tnkr.com" style="color: #667eea;">support@tnkr.com</a></p>
              </div>
            </div>
          `,
        };

        transporter.sendMail(approvalMailOptions).catch((err) => {
          console.error("Failed to send approval email:", err);
        });
      } else if (status === "REJECTED") {
        await prisma.TechnicianProfile.update({
          where: { userId: technicianId },
          data: {
            isVerifiedTechnician: false,
            verificationStatus: "REJECTED",
          },
        });

        // Send rejection email to technician
        const rejectionMailOptions = {
          from: `"TNKR" <${process.env.GMAIL_USER}>`,
          to: technicianProfile.user.email,
          subject: "Update on Your TNKR Technician Application",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); padding: 30px; text-align: center; color: white;">
                <h1 style="margin: 0; font-size: 28px;">Application Update</h1>
                <p style="margin: 10px 0 0 0; font-size: 18px;">Your technician application requires attention</p>
              </div>
              
              <div style="padding: 30px; background: #f9f9f9;">
                <h2 style="color: #333; margin-top: 0;">Hello ${
                  technicianProfile.user.firstName
                },</h2>
                
                <p style="color: #555; line-height: 1.6;">
                  Thank you for your interest in becoming a TNKR technician. After careful review of your application for <strong>${
                    technicianProfile.businessName
                  }</strong>, we regret to inform you that we are unable to approve your application at this time.
                </p>
                
                ${
                  rejectionReason
                    ? `
                <div style="background: #ffe6e6; border-left: 4px solid #dc3545; padding: 20px; margin: 20px 0; border-radius: 4px;">
                  <h3 style="color: #721c24; margin-top: 0;">📝 Feedback</h3>
                  <p style="color: #555; margin: 0;">${rejectionReason}</p>
                </div>
                `
                    : ""
                }
                
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 4px;">
                  <h3 style="color: #856404; margin-top: 0;">🔄 Next Steps</h3>
                  <ul style="color: #555; margin: 10px 0;">
                    <li>Review the feedback provided above</li>
                    <li>Update your profile with the requested information</li>
                    <li>Ensure all required fields are complete and accurate</li>
                    <li>Resubmit your application when ready</li>
                  </ul>
                </div>
                
                <div style="background: #e8f5e8; border-left: 4px solid #4caf50; padding: 20px; margin: 20px 0; border-radius: 4px;">
                  <h3 style="color: #2e7d32; margin-top: 0;">💡 Tips for Reapplication</h3>
                  <ul style="color: #555; margin: 10px 0;">
                    <li>Provide detailed information about your experience</li>
                    <li>Include a professional business website</li>
                    <li>Ensure your contact information is current</li>
                    <li>Add high-quality portfolio images</li>
                    <li>Write a compelling bio that highlights your expertise</li>
                  </ul>
                </div>
                
                <p style="color: #555; line-height: 1.6;">
                  We encourage you to address the feedback and reapply. Our team is here to help you succeed. If you have any questions or need clarification, please contact us at <a href="mailto:support@tnkr.com" style="color: #667eea;">support@tnkr.com</a>.
                </p>
                
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${
                    process.env.FRONTEND_URL || "https://tnkrshoes.com"
                  }/dashboard/technician/setup" style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                    Update Your Profile
                  </a>
                </div>
                
                <p style="color: #777; font-size: 14px; text-align: center; margin-top: 30px;">
                  Thank you for your interest in TNKR. We look forward to reviewing your updated application.
                </p>
              </div>
              
              <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
                <p style="margin: 0;">© 2024 TNKR. All rights reserved.</p>
                <p style="margin: 5px 0 0 0;">Questions? Contact us at <a href="mailto:support@tnkr.com" style="color: #667eea;">support@tnkr.com</a></p>
              </div>
            </div>
          `,
        };

        transporter.sendMail(rejectionMailOptions).catch((err) => {
          console.error("Failed to send rejection email:", err);
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
          verificationStatus: "PENDING",
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
