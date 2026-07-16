import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  user?: { id: number;  email: string; role: string };
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.header("Authorization");

  if (!authHeader) {
    res.status(401).json({ message: "Access Denied. No Token Provided." });
    return;
  }

const token = authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : authHeader;

  try {
    const decoded = jwt.verify(token, "your_secret_key") as {
      id: number;
      email: string;
      role: "admin" | "user";
    };
   

    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ message: "Invalid Token" });
  }
};

export const isAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user || req.user.role.toLowerCase() !== "admin") {
    res
      .status(403)
      .json({ status: 403, message: "Access Denied. Admins Only." });
    return;
  }
  next();
};
