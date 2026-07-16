import { Router } from "express";
import {
  getAllUsers,
  addUser,
  updateUser,
  deleteUser,
  updateProfileImage,
} from "../controllers/user.controller";
import upload from "../middleware/multer";
import {authenticateToken} from "../middleware/middleware";

const router = Router();

router.get("/getUsers", getAllUsers);
router.post("/addUser", upload.single("image"), addUser);
router.put("/updateUser/:id", upload.single("image"), updateUser);
router.patch("/deleteUser/:id", deleteUser);
router.patch(
  "/updateProfileImage",
  authenticateToken,
  upload.single("image"),
  updateProfileImage,
);
export default router;
