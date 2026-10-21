import { Request, Response } from "express";
import pool from "../database/db";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { employeeNotice, welcomeEmployee } from "../services/employeeNotificationEvents";
import cloudinary, { uploadToCloudinary } from "../utils/cloudinary";
import { AuthenticatedRequest } from "../middleware/middleware";
const formattedDate = new Date().toLocaleDateString("sv-SE");
export const updateProfileImage = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ message: "Image is required" });
      return;
    }

    const file = req.file;

    if (!file.mimetype.startsWith("image/")) {
      res.status(400).json({ message: "File must be an image" });
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      res.status(400).json({ message: "Image size must be less than 5MB" });
      return;
    }

    const result = await uploadToCloudinary(file.buffer, "oms_users");
    const imageUrl = result.secure_url;

    await pool.query("UPDATE tbl_users SET image = ? WHERE id = ?", [
      imageUrl,
      userId,
    ]);

    res.status(200).json({
      message: "Profile image updated successfully",
      image: imageUrl,
    });
  } catch (error) {
    console.error("Error updating profile image:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
export const getAllUsers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rows]: any = await pool.query(
      `SELECT 
        u.id, u.email, u.role, u.name, u.contact, u.salary, u.cnic,
        u.address, u.date, u.department, u.reporting_manager, u.image, u.loginStatus, u.created_at,
        u.updated_at, u.roleId, u.status,
        (SELECT el.position 
         FROM employee_lifeline el 
         WHERE el.employee_id = u.id 
         ORDER BY el.date DESC, el.id DESC 
         LIMIT 1) AS position
       FROM tbl_users u
       WHERE LOWER(u.role) = 'user' AND COALESCE(u.status, '') <> 'Deleted'`,
    );
    res.json({ users: rows });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Database query failed" });
  }
};

export const addUser = async (req: Request, res: Response): Promise<void> => {
  const connection = await pool.getConnection();
  let uploadedImagePublicId: string | null = null;
  try {
    let { name, email, contact, cnic, address, date, role, position, department, reportingManager } =
      req.body;

    // Validation...
    if (!name || !email || !cnic || !contact || !role || !position) {
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    if (!/^\d{11}$/.test(contact)) {
      res.status(400).json({ message: "Contact must be exactly 11 digits" });
      return;
    }

    // Validate the optional image before creating the employee.
    const profileImage = req.file;
    if (profileImage && !profileImage.mimetype.startsWith("image/")) {
      res.status(400).json({ message: "File must be an image" });
      return;
    }
    if (profileImage && profileImage.size > 4 * 1024 * 1024) {
      res.status(400).json({ message: "Image size must be less than 5MB" });
      return;
    }

    // 🔍 CHECK DUPLICATES BEFORE INSERT
    const [existing]: any = await pool.query(
      `SELECT id, email, contact, cnic FROM tbl_users
   WHERE LOWER(email) = LOWER(?) 
   OR contact = ? 
   OR cnic = ?`,
      [email, contact, cnic],
    );

    if (existing.length > 0) {
      const duplicates: string[] = [];

      const emails = existing.some(
        (u: any) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      const phones = existing.some((u: any) => u.contact === contact);
      const cnics = existing.some((u: any) => u.cnic === cnic);

      if (emails) duplicates.push("Email");
      if (phones) duplicates.push("Phone");
      if (cnics) duplicates.push("CNIC");

      res.status(400).json({
        message: `${duplicates.join(" and ")} already exists!`,
      });
      return;
    }

    const capitalizedName = name
      .split(" ")
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

    const finalDate = date || formattedDate;
    let imageUrl: string | null = null;

    if (profileImage) {
      try {
        const uploadedImage = await uploadToCloudinary(profileImage.buffer, "oms_users");
        imageUrl = uploadedImage.secure_url;
        uploadedImagePublicId = uploadedImage.public_id;
      } catch (imageError) {
        console.error("Employee profile image upload failed:", imageError);
        res.status(502).json({ message: "Profile image upload failed. Please try again." });
        return;
      }
    }

    try {
      await connection.beginTransaction();

      // ✅ STEP 1: Insert into tbl_users
      const temporaryPassword = randomBytes(18).toString("base64url");
      const [userResult]: any = await connection.query(
        `INSERT INTO tbl_users (name, email, password, contact, cnic, address, date, role, image, must_change_password, department, reporting_manager)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          capitalizedName,
          email.toLowerCase(),
          await bcrypt.hash(temporaryPassword, 10),
          contact,
          cnic,
          address || null,
          finalDate,
          role,
          imageUrl,
          department || null,
          reportingManager || null,
        ],
      );

      const newUserId = userResult.insertId;

      // ✅ STEP 2: Auto-create employee_lifeline entry with the position (only for non-admins)
      if (role !== "admin") {
        await connection.query(
          `INSERT INTO employee_lifeline (employee_id, employee_name, email, contact, position, date)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newUserId, capitalizedName, email.toLowerCase(), contact, position, finalDate],
        );
      }

      await connection.commit();

      // Email delivery can continue after Save; the profile image is already stored.
      res.once("finish", () => {
        void welcomeEmployee(newUserId, temporaryPassword, {
          designation: position,
          department,
          joiningDate: finalDate,
        }).catch((notificationError) => {
          console.error("Employee welcome notification failed:", notificationError);
        });
      });

      res.status(201).json({
        message: "User added successfully",
        image: imageUrl,
        userId: newUserId,
      });
    } catch (error) {
      await connection.rollback();
      if (uploadedImagePublicId) {
        try {
          await cloudinary.uploader.destroy(uploadedImagePublicId);
        } catch (cleanupError) {
          console.error("Failed to remove unused employee profile image:", cleanupError);
        }
      }
      throw error;
    }
  } catch (error) {
    console.error("Detailed Error adding user:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    connection.release();
  }
};

export const updateUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.params.id;
    let { name, email, contact, cnic, address, role, date, position, department, reportingManager, status } = req.body;

    if (!userId) {
      res.status(400).json({ message: "User ID is required" });
      return;
    }

    // ✅ Validate contact (if provided)
    if (contact && !/^\d{11}$/.test(contact)) {
      res.status(400).json({ message: "Contact must be exactly 11 digits" });
      return;
    }

    // ✅ Validate CNIC (13 digits ignoring dashes)
    if (cnic) {
      const digits = cnic.replace(/\D/g, "");
      if (digits.length !== 13) {
        res.status(400).json({ message: "CNIC must be exactly 13 digits" });
        return;
      }
    }

    const [userRows]: any = await pool.query(
      "SELECT id,name,email,contact,cnic,address,role,status,department,reporting_manager,DATE_FORMAT(date,'%Y-%m-%d') AS date FROM tbl_users WHERE id = ?",
      [userId],
    );
    if (userRows.length === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    if (name) {
      name = name
        .split(" ")
        .map(
          (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
        )
        .join(" ");
    }

    if (email) email = email.toLowerCase();

    // Check for duplicates (excluding current user)
    // 🔍 CHECK DUPLICATES (SAFE VERSION)
    const [existingUsers]: any = await pool.query(
      `SELECT id, email, contact, cnic FROM tbl_users
   WHERE id != ?`,
      [userId],
    );

    const duplicates: string[] = [];

    const emailTaken = existingUsers.some(
      (u: any) => email && u.email?.toLowerCase() === email.toLowerCase(),
    );

    const phoneTaken = existingUsers.some(
      (u: any) => contact && u.contact === contact,
    );

    const cnicTaken = existingUsers.some((u: any) => cnic && u.cnic === cnic);

    if (emailTaken) duplicates.push("Email");
    if (phoneTaken) duplicates.push("Phone");
    if (cnicTaken) duplicates.push("CNIC");

    if (duplicates.length > 0) {
      res.status(400).json({
        message: `${duplicates.join(" and ")} already exists!`,
      });
      return;
    }

    const updates: any = { name, email, contact, cnic, address, role, date, department, reporting_manager: reportingManager, status };

    // Handle Image Update
    if (req.file) {
      const file = req.file as any;
      const result = await uploadToCloudinary(file.buffer, "oms_users");
      updates.image = result.secure_url;
    }

    // Clean undefined fields so they aren't part of the SQL query
    Object.keys(updates).forEach(
      (key) => updates[key] === undefined && delete updates[key],
    );

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      res.status(400).json({ message: "No fields provided for update" });
      return;
    }

    // Build query dynamically without trailing comma issues
    const query = `UPDATE tbl_users SET ${keys.map((key) => `\`${key}\` = ?`).join(", ")} WHERE id = ?`;
    const values = [...Object.values(updates), userId];

    await pool.query(query, values);
    const changed: string[] = [];
    for (const [key,label] of [["status","Employment status"],["date","Joining date"],["department","Department"],["reporting_manager","Reporting manager"]] as const) {
      if (updates[key] !== undefined && String(updates[key]) !== String(userRows[0][key])) changed.push(`${label}: ${userRows[0][key]} to ${updates[key]}`);
    }
    if (position) {
      const [lifeline]: any = await pool.query("SELECT id,position FROM employee_lifeline WHERE employee_id=? ORDER BY id DESC LIMIT 1",[userId]);
      if (lifeline.length && lifeline[0].position !== position) {
        await pool.query("UPDATE employee_lifeline SET position=? WHERE id=?",[position,lifeline[0].id]);
        changed.push(`Designation: ${lifeline[0].position} to ${position}`);
      }
    }
    if (changed.length) {
      try { await employeeNotice(Number(userId),"Employee information updated",changed.join("; "),`employee:${userId}:information:${Date.now()}`); }
      catch (notificationError) { console.error("Employee update notification failed:",notificationError); }
    }

    res.status(200).json({
      message: "User updated successfully",
      userId,
      updatedFields: updates,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};


