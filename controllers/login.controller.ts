import { Request, Response } from "express";
import pool from "../database/db";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const CLOUDINARY_BASE_URL =
  "https://res.cloudinary.com/dnzo0rrk5/image/upload/v1773908483/oms_users/user_1775044832575_729.jpg";

const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/128/924/924874.png";

const saltRounds = 10;
const SECRET_KEY = "your_secret_key";

// ================= LOGIN =================
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        status: 400,
        message: "Email and password are required",
      });
      return;
    }

    const lowerEmail = email.toLowerCase().trim();

    // ✅ SINGLE TABLE LOGIN
    const [users]: any = await pool.query(
      "SELECT * FROM tbl_users WHERE LOWER(email) = ?",
      [lowerEmail],
    );

    if (users.length === 0) {
      res.status(400).json({
        status: 400,
        message: "Invalid email or password",
      });
      return;
    }

    const user = users[0];

    // PASSWORD CHECK
    let storedPassword = user.password;

    // Auto-hash old plain passwords
    if (!storedPassword.startsWith("$2b$")) {
      const hashedPassword = await bcrypt.hash(storedPassword, saltRounds);

      await pool.query("UPDATE tbl_users SET password = ? WHERE email = ?", [
        hashedPassword,
        lowerEmail,
      ]);

      storedPassword = hashedPassword;
    }

    const isMatch = await bcrypt.compare(password, storedPassword);

    if (!isMatch) {
      res.status(400).json({
        status: 400,
        message: "Invalid email or password",
      });
      return;
    }

    // CHECK STATUS
    if (user.loginStatus !== "Y" || user.status !== "Active") {
      res.status(403).json({
        status: 403,
        message: "Your account is inactive. Contact admin.",
      });
      return;
    }

    // ✅ ADD THIS - Update loginStatus to 'Y' on successful login
    await pool.query(
      "UPDATE tbl_users SET loginStatus = 'Y' WHERE id = ?",
      [user.id]
    );

    // FETCH PERMISSIONS
    let allowedModules: string[] = [];

    if (user.roleId) {
      const [permissions]: any = await pool.query(
        `SELECT m.moduleName 
         FROM access_control ac 
         JOIN modules m ON ac.moduleId = m.id 
         WHERE ac.roleId = ? AND ac.status = 1`,
        [user.roleId],
      );

      allowedModules = permissions.map((p: any) => p.moduleName);
    }

    // TOKEN
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      SECRET_KEY,
      { expiresIn: "1d" },
    );

    // IMAGE LOGIC
    let finalImage = DEFAULT_AVATAR;

    if (user.role?.toLowerCase() === "admin") {
      finalImage = CLOUDINARY_BASE_URL;
    } else {
      finalImage = user.image ? user.image : DEFAULT_AVATAR;
    }

    // RESPONSE
    res.status(200).json({
      status: 200,
      message: "Login successful",
      token,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      roleId: user.roleId,
      permissions: allowedModules,
      contact: user.contact,
      cnic: user.cnic,
      date: user.date || user.created_at,
      image: finalImage,
    });
  } catch (error) {
    console.error("Login Error:", error);

    res.status(500).json({
      status: 500,
      message: "Internal Server Error",
    });
  }
};

// ================= CHANGE PASSWORD =================
export const changePassword = async (
  req: Request<any>,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      res.status(400).json({
        message: "Both old and new passwords are required",
      });
      return;
    }

    if (oldPassword === newPassword) {
      res.status(400).json({
        message: "New password cannot be the same as old password",
      });
      return;
    }

    const [users]: any = await pool.query(
      "SELECT * FROM tbl_users WHERE id = ?",
      [id],
    );

    if (!users.length) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      res.status(400).json({
        message: "Old password is incorrect",
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await pool.query("UPDATE tbl_users SET password = ? WHERE id = ?", [
      hashedPassword,
      id,
    ]);

    res.status(200).json({
      message: "Password updated successfully!",
    });
  } catch (error) {
    console.error("Error changing password:", error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

// ================= CONFIRM PASSWORD =================
export const confirmPassword = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { password, confirmPassword } = req.body;

    if (!password || !confirmPassword) {
      res.status(400).json({
        message: "Password and Confirm Password are required",
      });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({
        message: "Password and Confirm Password do not match",
      });
      return;
    }

    const [users]: any = await pool.query(
      "SELECT id FROM tbl_users WHERE id = ?",
      [id],
    );

    if (!users.length) {
      res.status(404).json({
        message: "User not found",
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await pool.query("UPDATE tbl_users SET password = ? WHERE id = ?", [
      hashedPassword,
      id,
    ]);

    res.status(200).json({
      message: "Password updated successfully!",
    });
  } catch (error) {
    console.error("Change Password Error:", error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};
