import { Application, Router, Request, Response, NextFunction } from "express";
import { authenticateToken, AuthenticatedRequest, requirePermission } from "./middleware";
import { hasPermission, isEmployee } from "../permissionModel";
import pool from "../database/db";

type EmployeeAccess = {
  path: RegExp;
  methods?: string[];
  ownerParam?: string;
  ownerBody?: string;
  ownerRecord?: { table: "resignation" | "rejoin" | "promotion"; column: "employee_id" };
  pendingOnly?: boolean;
};

// Check a router's actual route table before running the guard. Several routers share
// /api and /api/admin, so a guard for an unrelated router must not reject the request.
export function securedMount(
  app: Application,
  prefix: string,
  router: Router,
  module: string,
  employeeAccess: EmployeeAccess[] = [],
  additionalPermissions: { path: RegExp; module: string; methods?: string[] }[] = [],
) {
  app.use(prefix, (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toLowerCase();
    const matches = (router as any).stack.some((layer: any) =>
      layer.route?.methods[method] && layer.match(req.path),
    );
    if (!matches) return next();

    authenticateToken(req as AuthenticatedRequest, res, async () => {
      const user = (req as AuthenticatedRequest).user;
      const additional = additionalPermissions.find((entry) =>
        entry.path.test(req.path) && (!entry.methods || entry.methods.includes(req.method)));
      if (additional && hasPermission(user, additional.module)) {
        (req as AuthenticatedRequest & { requiredPermission: string }).requiredPermission = additional.module;
        next();
        return;
      }
      const employeeRule = employeeAccess.find((rule) =>
        rule.path.test(req.path) && (!rule.methods || rule.methods.includes(req.method)));
      if (employeeRule) {
        if (hasPermission(user, module)) {
          (req as AuthenticatedRequest & { requiredPermission: string }).requiredPermission = module;
          next();
          return;
        }
        if (!isEmployee(user)) {
          res.status(403).json({ status: 403, message: "Forbidden" });
          return;
        }
        if (employeeRule.ownerParam) {
          const match = req.path.match(employeeRule.path);
          const requestedId = match?.[1];
          if (!requestedId || Number(requestedId) !== user?.id) {
            res.status(403).json({ status: 403, message: "Forbidden" });
            return;
          }
        }
        if (employeeRule.ownerBody && Number(req.body?.[employeeRule.ownerBody]) !== user?.id) {
          res.status(403).json({ status: 403, message: "Forbidden" });
          return;
        }
        if (employeeRule.pendingOnly && req.body?.approval_status &&
            !["pending", "PENDING"].includes(req.body.approval_status)) {
          res.status(403).json({ status: 403, message: "Forbidden" });
          return;
        }
        if (employeeRule.ownerRecord) {
          const recordId = req.path.match(employeeRule.path)?.[1];
          try {
            const { table, column } = employeeRule.ownerRecord;
            const [rows]: any = await pool.query(
              `SELECT ${column} FROM ${table} WHERE id = ?`, [recordId],
            );
            if (!rows.length || Number(rows[0][column]) !== user?.id) {
              res.status(403).json({ status: 403, message: "Forbidden" });
              return;
            }
          } catch {
            res.status(500).json({ message: "Unable to verify record scope" });
            return;
          }
        }
        next();
        return;
      }
      requirePermission(module)(req as AuthenticatedRequest, res, next);
    });
  }, router);
}
