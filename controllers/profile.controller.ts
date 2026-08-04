import { Request, Response } from "express";
import pool from "../database/db";

// Get Employee Profile (for logged-in user)
export const getMyProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user || !user.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const userId = user.id;

    // Get all user details
    const [rows]: any = await pool.query(
      `SELECT id, email, name, contact, cnic, address, date, image, 
              loginStatus, role, roleId, status, created_at, updated_at
       FROM tbl_users 
       WHERE id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const userData = rows[0];

    res.json({
      success: true,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        contact: userData.contact || 'N/A',
        cnic: userData.cnic || 'N/A',
        address: userData.address || 'N/A',
        date: userData.date,
        image: userData.image || null,
        loginStatus: userData.loginStatus,
        role: userData.role,
        roleId: userData.roleId,
        status: userData.status || 'Active',
        createdAt: userData.created_at,
        updatedAt: userData.updated_at
      }
    });
  } catch (error: any) {
    console.error("Get My Profile Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get Employee Profile by ID (Admin only)
export const getEmployeeProfileById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ message: "User ID is required" });
      return;
    }

    // Get all user details
    const [rows]: any = await pool.query(
      `SELECT id, email, name, contact, cnic, address, date, image, 
              loginStatus, role, roleId, status, created_at, updated_at
       FROM tbl_users 
       WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const userData = rows[0];

    res.json({
      success: true,
      user: {
        id: userData.id,
        email: userData.email,
        name: userData.name,
        contact: userData.contact || 'N/A',
        cnic: userData.cnic || 'N/A',
        address: userData.address || 'N/A',
        date: userData.date,
        image: userData.image || null,
        loginStatus: userData.loginStatus,
        role: userData.role,
        roleId: userData.roleId,
        status: userData.status || 'Active',
        createdAt: userData.created_at,
        updatedAt: userData.updated_at
      }
    });
  } catch (error: any) {
    console.error("Get Employee Profile By ID Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
};

// Get All Employees (Admin only)
export const getAllEmployees = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rows]: any = await pool.query(
      `SELECT id, email, name, contact, cnic, address, date, image, 
              loginStatus, role, roleId, status, created_at, updated_at
       FROM tbl_users 
       WHERE role = 'employee'
       ORDER BY name ASC`
    );

    const employees = rows.map((user: any) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      contact: user.contact || 'N/A',
      cnic: user.cnic || 'N/A',
      address: user.address || 'N/A',
      date: user.date,
      image: user.image || null,
      loginStatus: user.loginStatus,
      role: user.role,
      roleId: user.roleId,
      status: user.status || 'Active',
      createdAt: user.created_at,
      updatedAt: user.updated_at
    }));

    res.json({
      success: true,
      count: employees.length,
      employees: employees
    });
  } catch (error: any) {
    console.error("Get All Employees Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update Employee Profile
export const updateMyProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user || !user.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const userId = user.id;
    const { name, contact, cnic, address, email } = req.body;

    // Check if email already exists for another user
    if (email) {
      const [existing]: any = await pool.query(
        `SELECT id FROM tbl_users WHERE email = ? AND id != ?`,
        [email, userId]
      );
      if (existing.length > 0) {
        res.status(400).json({ message: "Email already in use by another user" });
        return;
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];

    if (name) {
      updates.push("name = ?");
      values.push(name);
    }
    if (email) {
      updates.push("email = ?");
      values.push(email);
    }
    if (contact) {
      updates.push("contact = ?");
      values.push(contact);
    }
    if (cnic) {
      updates.push("cnic = ?");
      values.push(cnic);
    }
    if (address) {
      updates.push("address = ?");
      values.push(address);
    }

    if (updates.length === 0) {
      res.status(400).json({ message: "No fields to update" });
      return;
    }

    updates.push("updated_at = NOW()");
    values.push(userId);

    const query = `UPDATE tbl_users SET ${updates.join(", ")} WHERE id = ?`;
    
    await pool.query(query, values);

    // Get updated user data
    const [updatedRows]: any = await pool.query(
      `SELECT id, email, name, contact, cnic, address, date, image, 
              loginStatus, role, roleId, status, created_at, updated_at
       FROM tbl_users 
       WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedRows[0].id,
        email: updatedRows[0].email,
        name: updatedRows[0].name,
        contact: updatedRows[0].contact || 'N/A',
        cnic: updatedRows[0].cnic || 'N/A',
        address: updatedRows[0].address || 'N/A',
        date: updatedRows[0].date,
        image: updatedRows[0].image || null,
        loginStatus: updatedRows[0].loginStatus,
        role: updatedRows[0].role,
        roleId: updatedRows[0].roleId,
        status: updatedRows[0].status || 'Active',
        createdAt: updatedRows[0].created_at,
        updatedAt: updatedRows[0].updated_at
      }
    });
  } catch (error: any) {
    console.error("Update My Profile Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
};

// Update Employee Profile Image
export const updateProfileImage = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user || !user.id) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const userId = user.id;
    const { image } = req.body;

    if (!image) {
      res.status(400).json({ message: "Image URL is required" });
      return;
    }

    await pool.query(
      `UPDATE tbl_users SET image = ?, updated_at = NOW() WHERE id = ?`,
      [image, userId]
    );

    res.json({
      success: true,
      message: "Profile image updated successfully",
      image: image
    });
  } catch (error: any) {
    console.error("Update Profile Image Error:", error.message || error);
    res.status(500).json({ message: "Server error" });
  }
};