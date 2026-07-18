import { Router, Request, Response, NextFunction } from "express";
import {
  getUsersLeaves,
  getMyLeaves,
  addLeave,
  updateLeave,
  getAllUsers,
  deleteLeave,
} from "../controllers/leave.controller";
import { authenticateToken, isAdmin } from "../middleware/middleware";

const router = Router();

// ✅ Wrapper for async error handling
const wrapAsync =
  (
    fn: (
      req: Request,
      res: Response,
      next?: NextFunction,
    ) => Promise<any>,
  ) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

// ==================== ADMIN ROUTES ====================
// Get all users' leaves
router.get(
  "/admin/getUsersLeaves",
  authenticateToken,
  isAdmin,
  wrapAsync(getUsersLeaves),
);

// Get all users
router.get(
  "/admin/getUsers",
  authenticateToken,
  isAdmin,
  wrapAsync(getAllUsers),
);

// Update any leave (admin only)
router.put(
  "/admin/updateLeave/:id",
  authenticateToken,
  isAdmin,
  wrapAsync(updateLeave),
);

// Delete any leave (admin only)
router.delete(
  "/admin/deleteLeave/:id",
  authenticateToken,
  isAdmin,
  wrapAsync(deleteLeave),
);

// ==================== USER ROUTES ====================
// Get my own leaves
router.get(
  "/user/getMyLeaves",
  authenticateToken,
  wrapAsync(getMyLeaves),
);

// Apply for leave
router.post(
  "/addLeave",
  authenticateToken,
  wrapAsync(addLeave),
);

// Delete my own leave (soft delete)
router.delete(
  "/user/deleteLeave/:id",
  authenticateToken,
  wrapAsync(deleteLeave),
);

export default router;