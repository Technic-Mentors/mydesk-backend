import { Router } from "express";
import {
  getAllTodos,
  getUserTodos,
  addTodo,
  updateTodo,
  updateTodoStatus,
  deleteTodo,
} from "../controllers/todo.controller";

import { authenticateToken, isAdmin } from "../middleware/middleware";

const router = Router();

router.get("/admin/getTodos", authenticateToken, isAdmin, getAllTodos);
router.get("/user/getTodo/:id", authenticateToken, getUserTodos);

router.post("/admin/createTodo", authenticateToken, addTodo);

router.put("/admin/updateTodo/:id", authenticateToken, updateTodo);
router.patch("/admin/updateTodo/:id/status", authenticateToken, updateTodoStatus);
router.patch("/admin/deleteTodo/:id", authenticateToken, deleteTodo);

export default router;
