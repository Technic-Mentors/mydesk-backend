import pool from "../database/db";
import { RowDataPacket } from "mysql2";

export interface AttendancePolicy {
  profileId: number | null;
  profileName: string | null;
  startTime: string;
  endTime: string;
  lateTime: string;
  halfLeave: string;
  offDay: string;
  officeLatitude?: string | number | null;
  officeLongitude?: string | number | null;
  allowedRadius?: string | number | null;
  shortLeaveThreshold?: number | null;
}

export const resolveClockInStatus = (
  clockIn: string,
  policy: Pick<AttendancePolicy, "lateTime">,
): "Present" | "Late" => {
  const time = clockIn.slice(0, 5);
  if (time >= String(policy.lateTime).slice(0, 5)) return "Late";
  return "Present";
};

export const isHalfLeaveAuthorized = (
  hasApprovedHalfDayLeave: boolean,
  hasPendingHalfDayLeaveBeingApproved: boolean,
): boolean => hasApprovedHalfDayLeave || hasPendingHalfDayLeaveBeingApproved;

let schemaReady: Promise<void> | null = null;

export const ensureAttendanceProfileSchema = (): Promise<void> => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS attendance_profiles (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        startTime TIME NOT NULL,
        endTime TIME NOT NULL,
        lateTime TIME NOT NULL,
        halfLeave TIME NOT NULL,
        offDays VARCHAR(100) NOT NULL,
        status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_attendance_profiles_name (name)
      ) ENGINE=InnoDB`);
      await pool.query(`CREATE TABLE IF NOT EXISTS employee_attendance_profiles (
        userId INT NOT NULL PRIMARY KEY,
        profileId INT NOT NULL,
        assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_employee_attendance_profiles_profile (profileId)
      ) ENGINE=InnoDB`);
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

export const getAttendancePolicy = async (userId: number): Promise<AttendancePolicy | null> => {
  await ensureAttendanceProfileSchema();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id AS profileId, p.name AS profileName, p.startTime, p.endTime,
            p.lateTime, p.halfLeave, p.offDays AS offDay,
            r.startTime AS defaultStartTime, r.endTime AS defaultEndTime,
            r.lateTime AS defaultLateTime, r.halfLeave AS defaultHalfLeave,
            r.offDay AS defaultOffDay, r.officeLatitude, r.officeLongitude,
            r.allowedRadius, r.shortLeaveThreshold
     FROM tbl_users u
     LEFT JOIN employee_attendance_profiles a ON a.userId = u.id
     LEFT JOIN attendance_profiles p ON p.id = a.profileId
     LEFT JOIN attendance_rules r ON r.status = 'Active'
     WHERE u.id = ?
     ORDER BY r.id DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const assigned = row.profileId != null;
  if (!assigned && row.defaultLateTime == null) return null;
  return {
    profileId: assigned ? Number(row.profileId) : null,
    profileName: assigned ? String(row.profileName) : null,
    startTime: String(assigned ? row.startTime : row.defaultStartTime || "00:00:00"),
    endTime: String(assigned ? row.endTime : row.defaultEndTime || "23:59:59"),
    lateTime: String(assigned ? row.lateTime : row.defaultLateTime),
    halfLeave: String(assigned ? row.halfLeave : row.defaultHalfLeave || "23:59:59"),
    offDay: String(assigned ? row.offDay : row.defaultOffDay || ""),
    officeLatitude: row.officeLatitude,
    officeLongitude: row.officeLongitude,
    allowedRadius: row.allowedRadius,
    shortLeaveThreshold: row.shortLeaveThreshold == null ? null : Number(row.shortLeaveThreshold),
  };
};
