import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwtSecret";
import pool from "../database/db";
import { hasPermission } from "../permissionModel";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    name: string;
    email: string;
    role: string;
    roleId?: number | null;
    permissions?: string[];
  };
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    res.status(401).json({ message: "Access Denied. No Token Provided." });
    return;
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : authHeader;

  let decoded: {
      id: number;
      name: string;
      email: string;
      role: string;
      authVersion?: number;
    };
  try {
    decoded = jwt.verify(token, getJwtSecret()) as typeof decoded;
  } catch {
    res.status(403).json({ message: "Invalid Token" });
    return;
  }

  try {
    const [users]: any = await pool.query(
      "SELECT auth_version, role, roleId, name, email, loginStatus, status, must_change_password FROM tbl_users WHERE id = ?",
      [decoded.id]
    );
    if (!users.length || Number(users[0].auth_version) !== Number(decoded.authVersion ?? 0) ||
        users[0].loginStatus !== "Y" || users[0].status !== "Active") {
      res.status(403).json({ message: "Session expired. Please sign in again." });
      return;
    }
    const account = users[0];
    if (account.must_change_password && req.path !== "/changePassword") {
      res.status(403).json({message:"Change your temporary password before accessing MyDesk",mustChangePassword:true});
      return;
    }
    const [rows]: any = account.roleId ? await pool.query(
      `SELECT m.moduleName FROM access_control ac
       JOIN modules m ON m.id = ac.moduleId
       WHERE ac.roleId = ? AND ac.status = 1`,
      [account.roleId],
    ) : [[]];
    req.user = {
      id: decoded.id,
      name: account.name,
      email: account.email,
      role: account.role,
      roleId: account.roleId,
      permissions: rows.map((row: { moduleName: string }) => row.moduleName),
    };
    next();
  } catch {
    res.status(500).json({ message: "Unable to verify session" });
  }
};

export const isAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || !hasPermission(req.user, (req as AuthenticatedRequest & { requiredPermission?: string }).requiredPermission || "__admin_only__")) {
    res
      .status(403)
      .json({ status: 403, message: "Access Denied. Admins Only." });
    return;
  }
  next();
};

export const requirePermission = (module: string) => (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  (req as AuthenticatedRequest & { requiredPermission: string }).requiredPermission = module;
  if (!hasPermission(req.user, module)) {
    res.status(403).json({ status: 403, message: "Forbidden" });
    return;
  }
  next();
};
