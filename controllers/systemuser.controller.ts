import { Request, Response } from "express";
import pool from "../database/db";
import bcrypt from "bcryptjs";
import { uploadToCloudinary } from "../utils/cloudinary";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatName = (name: string) =>
  name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

// ================= GET USERS =================
export const getSytemUsers = async (req: Request, res: Response) => {
  try {
    const [users]: any = await pool.query(`
      SELECT 
        u.id,
        u.name,
        u.contact,
        u.cnic,
        u.email,
        u.roleId,
        r.roleName AS role,
        u.status,
        u.image,
        u.created_at,
        u.updated_at
      FROM tbl_users u
      LEFT JOIN roles r ON u.roleId = r.id 
      WHERE LOWER(r.roleName) != 'user'
      ORDER BY u.id ASC
    `);

    res.json({ users });
  } catch (error) {
    console.error("Fetch Users Error:", error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
};

// ================= GET ROLES =================
export const getRoles = async (req: Request, res: Response) => {
  try {
    const [roles]: any = await pool.query("SELECT id, roleName FROM roles");
    res.json({ roles });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch roles" });
  }
};

// ================= ADD USER =================
export const addSystemUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    let { name, cnic, contact, email, password, roleId, role, status } =
      req.body;

    if (!name || !email || !password || !roleId || !role) {
      res.status(400).json({
        message: "Required fields are missing",
      });
      return;
    }

    name = formatName(name.trim());
    email = email.toLowerCase().trim();

    if (!emailRegex.test(email)) {
      res.status(400).json({ message: "Invalid email format" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ message: "Password too short" });
      return;
    }

    // ✅ DUPLICATE CHECK
    const [existing]: any = await pool.query(
      `SELECT id FROM tbl_users WHERE LOWER(email)=LOWER(?)`,
      [email],
    );

    if (existing.length > 0) {
      res.status(400).json({ message: "Email already exists!" });
      return;
    }

    // ================= IMAGE UPLOAD =================
    let imageUrl: string | null = null;

    if (req.file) {
      const file: any = req.file;

      if (!file.mimetype.startsWith("image/")) {
        res.status(400).json({ message: "File must be an image" });
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        res.status(400).json({ message: "Image must be < 5MB" });
        return;
      }

      try {
        const result = await uploadToCloudinary(
          file.buffer,
          "oms_system_users",
        );
        imageUrl = result.secure_url;
      } catch (err) {
        console.error("Cloudinary Error:", err);
        res.status(500).json({ message: "Image upload failed" });
        return;
      }
    }

    // ================= INSERT =================
    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO tbl_users
      (name, cnic, contact, email, password, roleId, role, status, image)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        cnic || null,
        contact || null,
        email,
        hashedPassword,
        roleId,
        role,
        status || "Active",
        imageUrl,
      ],
    );

    res.status(201).json({
      message: "User added successfully",
      image: imageUrl,
    });
  } catch (error) {
    console.error("Add User Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// ================= UPDATE USER =================
export const updateSystemUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    let { name, cnic, contact, email, roleId, role, status } = req.body;

    const [userRows]: any = await pool.query(
      "SELECT * FROM tbl_users WHERE id=?",
      [id],
    );

    if (userRows.length === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    // ================= IMAGE UPDATE =================
    let imageUrl = userRows[0].image;

    if (req.file) {
      const file: any = req.file;

      if (!file.mimetype.startsWith("image/")) {
        res.status(400).json({ message: "Invalid image file" });
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        res.status(400).json({ message: "Image must be < 5MB" });
        return;
      }

      try {
        const result = await uploadToCloudinary(
          file.buffer,
          "oms_system_users",
        );
        imageUrl = result.secure_url;
      } catch (err) {
        res.status(500).json({ message: "Image upload failed" });
        return;
      }
    }

    // ================= UPDATE =================
    await pool.query(
      `UPDATE tbl_users SET 
        name=?,
        cnic=?,
        contact=?,
        email=?,
        roleId=?,
        role=?,
        status=?,
        image=?
      WHERE id=?`,
      [
        name,
        cnic || null,
        contact || null,
        email,
        roleId,
        role,
        status || "Active",
        imageUrl,
        id,
      ],
    );

    res.json({
      message: "User updated successfully",
      image: imageUrl,
    });
  } catch (error) {
    console.error("Update User Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const activateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [result]: any = await pool.query(
      "UPDATE tbl_users SET status = 'Active', loginStatus = 'Y' WHERE id = ? AND status = 'Inactive'",
      [id],
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "Inactive user not found" });
      return;
    }

    res.json({ message: "User reactivated successfully" });
  } catch (error) {
    console.error("Reactivate User Error:", error);
    res.status(500).json({ message: "Failed to reactivate user" });
  }
};
// ================= DELETE USER =================
// ================= SOFT DELETE USER =================
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [result]: any = await pool.query(
      `UPDATE tbl_users  SET status = 'Inactive', loginStatus = 'N'  WHERE id = ?`,
      [id],
    );

    if (result.affectedRows === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.json({ message: "User deactivated successfully" });
  } catch (error) {
    console.error("Soft Delete Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
