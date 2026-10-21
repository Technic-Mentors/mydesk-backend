import { Request, Response } from "express";
import pool from "../database/db";

export const getRoles = async (req: Request, res: Response) => {
  try {
    const [roles] = await pool.query("SELECT id, roleName FROM roles");
    res.status(200).json({ roles });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getAccessControl = async (req: Request, res: Response) => {
  const { roleId } = req.params;
  try {
    const query = `
      SELECT m.id AS moduleId, m.moduleName,
        CASE WHEN EXISTS (
          SELECT 1 FROM access_control ac
          WHERE ac.roleId = ? AND ac.moduleId = m.id AND ac.status = 1
        ) THEN 1 ELSE 0 END AS status
      FROM modules m
      ORDER BY m.id`;

    const [permissions] = await pool.query(query, [roleId]);
    res.status(200).json({ permissions });
  } catch (error) {
    console.error("Error fetching permissions:", error);
    res.status(500).json({ message: "Error fetching permissions" });
  }
};

export const addAccessControl = async (req: Request, res: Response) => {
  const { roleId, permissions } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    await connection.query("DELETE FROM access_control WHERE roleId = ?", [
      roleId,
    ]);

    for (const [moduleName, status] of Object.entries(permissions)) {
      if (status) { 
        const [moduleRows]: any = await connection.query(
          "SELECT id FROM modules WHERE moduleName = ?",
          [moduleName],
        );

        if (moduleRows.length > 0) {
          await connection.query(
            "INSERT INTO access_control (roleId, moduleId, status) VALUES (?, ?, ?)",
            [roleId, moduleRows[0].id, status],
          );
        }
      }
    }

    await connection.commit();
    res.status(200).json({ message: "Permissions updated successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("Add Error:", error);
    res.status(500).json({ message: "Failed to update permissions" });
  } finally {
    connection.release();
  }
};

// Full replacement: permissions must include every module, and expectedModuleIds
// must match the grants read when the edit form opened.
export const updateAccessControl = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { roleId, permissions, expectedModuleIds } = req.body;

  if (!roleId || !permissions || typeof permissions !== "object" || Array.isArray(permissions) ||
      !Array.isArray(expectedModuleIds) || expectedModuleIds.some((id: unknown) =>
        !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    res.status(400).json({ message: "Missing or invalid role permissions" });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [moduleRows]: any = await connection.query(
      "SELECT id, moduleName FROM modules",
    );
    const moduleNames = new Set(moduleRows.map((module: any) => module.moduleName));
    const suppliedNames = Object.keys(permissions);
    if (!moduleRows.length || suppliedNames.length !== moduleRows.length ||
        suppliedNames.some((name) => !moduleNames.has(name)) ||
        Object.values(permissions).some((status) =>
          ![true, false, 1, 0, "1", "0"].includes(status as any))) {
      await connection.rollback();
      res.status(409).json({ message: "Permission list is incomplete or outdated. Reload and try again." });
      return;
    }

    const [currentRows]: any = await connection.query(
      "SELECT moduleId FROM access_control WHERE roleId = ? AND status = 1 FOR UPDATE",
      [roleId],
    );
    const expectedIds = new Set(expectedModuleIds.map((id: number | string) => String(Number(id))));
    const currentIds = new Set(currentRows.map((row: any) => String(Number(row.moduleId))));
    if (expectedIds.size !== expectedModuleIds.length ||
        expectedIds.size !== currentIds.size ||
        [...expectedIds].some((id) => !currentIds.has(id))) {
      await connection.rollback();
      res.status(409).json({ message: "Permissions changed since this form opened. Reload and try again." });
      return;
    }

    // This endpoint replaces the complete grant set for the role.
    await connection.query("DELETE FROM access_control WHERE roleId = ?", [roleId]);

    const values: any[] = [];
    for (const module of moduleRows) {
      const status = permissions[module.moduleName];
      if (status === true || status === 1 || status === "1") {
        values.push([roleId, module.id, 1]);
      }
    }

    if (values.length > 0) {
      await connection.query(
        "INSERT INTO access_control (roleId, moduleId, status) VALUES ?",
        [values],
      );
    }

    await connection.commit();
    res.status(200).json({ message: "Access control updated successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("Update Error:", error);
    res.status(500).json({ message: "Failed to update access control" });
  } finally {
    connection.release();
  }
};
