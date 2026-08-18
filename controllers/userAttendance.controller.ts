import { Request, Response } from "express";
import pool from "../database/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

const toMySQLDate = (dateStr: string | null): string | null => {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  } catch (error) {
    return null;
  }
};

const calculateWorkingHours = (
  clockIn: string,
  clockOut: string,
): string | null => {
  if (!clockIn || !clockOut) return null;
  try {
    const start = new Date(`1970-01-01T${clockIn}`);
    const end = new Date(`1970-01-01T${clockOut}`);
    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) return null;
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs / (1000 * 60)) % 60);
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`;
  } catch (error) {
    return null;
  }
};

const getAttendanceRule = async (): Promise<any | null> => {
  try {
    const [rows]: any = await pool.query(
      "SELECT * FROM attendance_rules WHERE status = 'Active' ORDER BY id DESC LIMIT 1",
    );
    return rows.length ? rows[0] : null;
  } catch (error) {
    console.error("❌ Error fetching attendance rule:", error);
    throw error;
  }
};

// ============================================================
// GET USERS
// ============================================================
export const getUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
        id, 
        name, 
        email, 
        contact, 
        cnic, 
        address, 
        date, 
        role, 
        status,
        loginStatus,
        image,
        position,
        salary,
        created_at,
        updated_at
      FROM tbl_users 
      WHERE status = 'Y'`
    );
    res.json({ users: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch users." });
  }
};
// ============================================================
// GET ALL ATTENDANCES - ✅ WITH REMOTE FIELDS
// ============================================================
export const getAllAttendances = async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.userId, u.name, u.email, u.role, DATE_FORMAT(a.date, '%Y-%m-%d') AS date, a.clockIn, a.clockOut,
              a.attendanceStatus, a.leaveStatus, a.leaveReason,
              a.workingHours, DAYNAME(DATE(a.date)) AS day, a.status,
              a.latitude, a.longitude, 
              a.clockInLatitude, a.clockInLongitude,
              a.clockOutLatitude, a.clockOutLongitude,
              -- ✅ Remote fields
              a.type,
              a.remoteStatus,
              a.remoteApprovedBy,
              a.remoteApprovedAt,
              a.remoteRejectedReason,
              a.remoteRequestDate,
              a.remoteFromDate,
              a.remoteToDate,
              a.remoteReason
       FROM attendance a
       JOIN tbl_users u ON a.userId = u.id
       WHERE a.status = 'Y'
       ORDER BY a.date ASC, a.id ASC`,
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch attendance records." });
  }
};

// ============================================================
// GET MY ATTENDANCES - ✅ WITH REMOTE FIELDS
// ============================================================
export const getMyAttendances = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
          a.id,
          a.userId,
          u.email,
        DATE_FORMAT(a.date, '%Y-%m-%d') AS date,
          a.clockIn,
          a.clockOut,
          a.attendanceStatus,
          a.leaveStatus,
          a.leaveReason,
          a.workingHours,
          DAYNAME(DATE(a.date)) AS day,
          a.status,
          -- ✅ Remote fields
          a.type,
          a.remoteStatus,
          a.remoteRequestDate,
          a.remoteFromDate,
          a.remoteToDate,
          a.remoteReason
       FROM attendance a
       JOIN tbl_users u ON a.userId = u.id
       WHERE a.userId = ? AND a.status = 'Y'
       ORDER BY a.date ASC, a.id ASC`,
      [userId],
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch my attendance." });
  }
};

// ============================================================
// ADD ATTENDANCE - ✅ WITH REMOTE FIELDS
// ============================================================
export const addAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { userId } = req.params;
  const { 
    date, 
    clockIn, 
    clockOut, 
    attendanceStatus: manualStatus,
    type,
    remoteStatus,
    remoteRequestDate,
    remoteFromDate,
    remoteToDate,
    remoteReason,
    remoteApprovedBy
  } = req.body;

  console.log("🚀 ========== ADD ATTENDANCE START ==========");
  console.log("📝 Request params:", { userId });
  console.log("📝 Request body:", req.body);

  try {
    const userIdNum = parseInt(userId);
    if (!userIdNum || !date || !manualStatus) {
      console.log("❌ Validation failed: Missing required fields");
      res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
      return;
    }

    const formattedDate = toMySQLDate(date);
    if (!formattedDate) {
      console.log("❌ Validation failed: Invalid date format");
      res.status(400).json({ success: false, message: "Invalid date format" });
      return;
    }

    console.log(`✅ Validated: userId=${userIdNum}, date=${formattedDate}, status=${manualStatus}`);

    const rule = await getAttendanceRule();
    if (!rule) {
      console.log("❌ No active attendance rule found");
      res.status(400).json({
        success: false,
        message: "No active attendance rule found on server.",
      });
      return;
    }

    // Weekly Off Check
    if (rule.offDay) {
      const dateObj = new Date(formattedDate);
      const dayName = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
      }).format(dateObj);

      if (dayName.toLowerCase() === rule.offDay.toLowerCase()) {
        console.log(`❌ Cannot add attendance on ${rule.offDay} (Weekly Off)`);
        res.status(400).json({
          success: false,
          message: `Cannot add attendance on ${rule.offDay} (Weekly Off)`,
        });
        return;
      }
    }

    // Existing Attendance Check
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM attendance WHERE userId = ? AND date = ? AND status = 'Y'",
      [userIdNum, formattedDate],
    );

    if (existing.length > 0) {
      console.log(`❌ Attendance already exists for user ${userIdNum} on ${formattedDate}`);
      res.status(400).json({
        success: false,
        message: "Attendance already exists for this date of this Employee",
      });
      return;
    }

    let finalStatus = manualStatus.toLowerCase();
    let workingHours = null;

    console.log(`📊 Initial status: ${manualStatus}, Final status after toLowerCase: ${finalStatus}`);

    if (clockIn && clockOut) {
      workingHours = calculateWorkingHours(clockIn, clockOut);
      console.log(`📊 Working hours calculated: ${workingHours}`);
    }

    if (finalStatus === "present") {
      if (!clockIn ) {
        console.log("❌ Clock In required for 'Present'");
        res.status(400).json({
          success: false,
          message: "Clock In required for 'Present'",
        });
        return;
      }
      if (rule.halfLeave && clockIn >= rule.halfLeave) {
        finalStatus = "half leave";
        console.log(`📊 Status changed to: ${finalStatus} (Half Leave)`);
      } else if (rule.lateTime && clockIn >= rule.lateTime) {
        finalStatus = "late";
        console.log(`📊 Status changed to: ${finalStatus} (Late)`);
      }
    }

    console.log(`📊 Final status before INSERT: ${finalStatus}`);

    // ✅ Insert attendance
    console.log("📝 Inserting attendance record...");
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO attendance 
       (userId, date, clockIn, clockOut, attendanceStatus, workingHours, status,
        type, remoteStatus, remoteRequestDate, remoteFromDate, remoteToDate, remoteReason, remoteApprovedBy) 
       VALUES (?, ?, ?, ?, ?, ?, 'Y', ?, ?, ?, ?, ?, ?, ?)`,
      [
        userIdNum,
        formattedDate,
        clockIn || null,
        clockOut || null,
        finalStatus,
        workingHours,
        type || 'Onsite',
        remoteStatus || null,
        remoteRequestDate || null,
        remoteFromDate || null,
        remoteToDate || null,
        remoteReason || null,
        remoteApprovedBy || null
      ],
    );

    console.log(`✅ Attendance inserted successfully! ID: ${result.insertId}, Status: ${finalStatus}`);

    // ============================================================
    // ✅ AUTO-CREATE LEAVE IF ATTENDANCE STATUS IS 'LEAVE'
    // ============================================================
    console.log(`🔍 Checking if status is 'leave': ${finalStatus === 'leave'}`);
    
    if (finalStatus === 'leave') {
      console.log(`🔍🔍🔍 STATUS IS 'LEAVE' - Attempting to auto-create leave!`);
      console.log(`📝 User ID: ${userIdNum}, Date: ${formattedDate}`);
      
      try {
        // Check if leave already exists for this date
        console.log("🔍 Checking for existing leave...");
        const [existingLeave] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM leaves 
           WHERE userId = ? AND fromDate = ? AND status = 'Y'`,
          [userIdNum, formattedDate]
        );

        console.log(`📋 Existing leave check result: ${existingLeave.length > 0 ? 'FOUND' : 'NOT FOUND'}`);
        
        if (existingLeave.length > 0) {
          console.log(`ℹ️ Leave already exists for user ${userIdNum} on ${formattedDate}`);
          console.log(`📋 Existing leave ID: ${existingLeave[0].id}`);
        } else {
          // Get user name for logging
          console.log("🔍 Fetching user name...");
          const [userRows] = await pool.query<RowDataPacket[]>(
            "SELECT name FROM tbl_users WHERE id = ?",
            [userIdNum]
          );
          const userName = userRows.length > 0 ? userRows[0].name : 'User';
          console.log(`👤 User name: ${userName}`);

          // Determine leave type
          let leaveType = req.body.leaveType || 'FULL DAY';
          console.log(`📊 Raw leaveType from request: ${req.body.leaveType || 'NOT PROVIDED'}`);
          console.log(`📊 LeaveType before validation: ${leaveType}`);
          
          const validLeaveTypes = ['FULL DAY', 'HALF DAY', 'SHORT LEAVE', 'CASUAL LEAVE', 'SICK LEAVE', 'ANNUAL LEAVE', 'FAMILY RESPONSIBILITY'];
          if (!validLeaveTypes.includes(leaveType.toUpperCase())) {
            console.log(`⚠️ Invalid leaveType: ${leaveType}, defaulting to FULL DAY`);
            leaveType = 'FULL DAY';
          }
          console.log(`✅ Final leaveType: ${leaveType}`);

          const leaveSubject = req.body.leaveSubject || `Leave on ${formattedDate}`;
          const leaveReason = req.body.leaveReason || 'Auto-created from attendance marking';
          
          console.log(`📝 Leave Subject: ${leaveSubject}`);
          console.log(`📝 Leave Reason: ${leaveReason}`);

          console.log(`📝 Inserting leave with data:`, {
            userId: userIdNum,
            fromDate: formattedDate,
            toDate: formattedDate,
            leaveType: leaveType.toUpperCase(),
            leaveSubject: leaveSubject,
            leaveReason: leaveReason,
            leaveStatus: 'Approved',
            status: 'Y'
          });

          // Create leave request
          console.log("📝 Executing INSERT into leaves table...");
          const [leaveResult] = await pool.query<ResultSetHeader>(
            `INSERT INTO leaves 
             (userId, fromDate, toDate, leaveType, leaveSubject, leaveReason, leaveStatus, status)
             VALUES (?, ?, ?, ?, ?, ?, 'Approved', 'Y')`,
            [
              userIdNum,
              formattedDate,
              formattedDate,
              leaveType.toUpperCase(),
              leaveSubject,
              leaveReason,
            ]
          );
          
          console.log(`✅✅✅ SUCCESS! Auto-created leave request for ${userName} (ID: ${userIdNum}) on ${formattedDate}`);
          console.log(`📊 Leave ID: ${leaveResult.insertId}`);
          console.log(`📊 Leave Type: ${leaveType}`);
          console.log(`📊 Leave Subject: ${leaveSubject}`);
          
          // ✅ Verify the leave was created
          console.log("🔍 Verifying leave was created...");
          const [verifyLeave] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM leaves WHERE id = ?`,
            [leaveResult.insertId]
          );
          
          if (verifyLeave.length > 0) {
            console.log(`✅✅✅ VERIFIED: Leave exists in database!`);
            console.log(`📋 Verified leave data:`, {
              id: verifyLeave[0].id,
              userId: verifyLeave[0].userId,
              fromDate: verifyLeave[0].fromDate,
              toDate: verifyLeave[0].toDate,
              leaveType: verifyLeave[0].leaveType,
              leaveSubject: verifyLeave[0].leaveSubject,
              leaveStatus: verifyLeave[0].leaveStatus,
              status: verifyLeave[0].status
            });
          } else {
            console.log(`❌❌❌ VERIFICATION FAILED: Leave not found in database!`);
          }
        }
      } catch (leaveError) {
        console.error("❌❌❌ ERROR auto-creating leave:", leaveError);
        console.error("❌ Error details:", leaveError instanceof Error ? leaveError.message : leaveError);
        console.error("❌ Stack trace:", leaveError instanceof Error ? leaveError.stack : 'No stack trace');
        // Don't fail the attendance creation, just log the error
      }
    } else {
      console.log(`ℹ️ Status is NOT 'leave' (${finalStatus}), skipping auto-create`);
    }

    console.log("🚀 ========== ADD ATTENDANCE END ==========");
    console.log(`✅ Final response: Success, ID: ${result.insertId}, Status: ${finalStatus}`);

    res.status(201).json({
      success: true,
      message: "Attendance added successfully",
      data: { id: result.insertId, status: finalStatus },
    });
  } catch (error: any) {
    console.error("💥💥💥 SERVER ERROR:", error);
    console.error("💥 Error message:", error.message);
    console.error("💥 Stack trace:", error.stack);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.code === "ER_DUP_ENTRY" ? "Duplicate entry detected" : error.message,
    });
  }
};

// ============================================================
// GET ATTENDANCE BY USER AND DATE - ✅ WITH REMOTE FIELDS
// ============================================================
export const getAttendanceByUserAndDate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, date } = req.query;

    if (!userId || !date) {
      res.status(400).json({ 
        success: false, 
        message: "UserId and date are required" 
      });
      return;
    }

    const formattedDate = toMySQLDate(date as string);
    if (!formattedDate) {
      res.status(400).json({ 
        success: false, 
        message: "Invalid date format" 
      });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, userId, date, clockIn, clockOut, attendanceStatus, workingHours,
              type, remoteStatus, remoteFromDate, remoteToDate, remoteReason
       FROM attendance 
       WHERE userId = ? AND date = ? AND status = 'Y'`,
      [userId, formattedDate]
    );

    if (rows.length === 0) {
      res.status(404).json({ 
        success: false, 
        message: "No attendance found for this user on this date" 
      });
      return;
    }

    res.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (error) {
    console.error("Error fetching attendance:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch attendance" 
    });
  }
};

// ============================================================
// UPDATE ATTENDANCE - ✅ WITH REMOTE FIELDS
// ============================================================
// ============================================================
// ============================================================
// UPDATE ATTENDANCE - ✅ WITH PROPER OPTIONAL CLOCKOUT
// ============================================================
export const updateAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  const {
    userId,
    date,
    clockIn,
    clockOut,
    attendanceStatus: reqStatus,
    // ✅ Remote fields (if any)
    type,
    remoteStatus,
    remoteApprovedBy,
    remoteApprovedAt,
    remoteRejectedReason,
    remoteRequestDate,
    remoteFromDate,
    remoteToDate,
    remoteReason
  } = req.body;

  try {
    // ✅ Validate required fields
    if (!userId || !date || !reqStatus) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: userId, date, or attendanceStatus"
      });
      return;
    }

    const formattedDate = toMySQLDate(date);
    if (!formattedDate) {
      res.status(400).json({
        success: false,
        message: "Invalid date format"
      });
      return;
    }

    // ✅ Check if attendance exists
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id, userId FROM attendance WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        message: "Attendance record not found"
      });
      return;
    }

    const rule = await getAttendanceRule();

    let finalStatus = reqStatus?.toLowerCase();
    let workingHours = null;

    // ✅ Determine if this status requires time
    const requiresTime = ["present", "late", "half leave"].includes(finalStatus);

    // ✅ CLOCK IN validation (REQUIRED for present/late/half leave)
    if (requiresTime && !clockIn) {
      res.status(400).json({
        success: false,
        message: "Clock In is required for this attendance status"
      });
      return;
    }

    // ✅ CLOCK OUT validation (OPTIONAL - only validate if BOTH are provided)
    if (requiresTime && clockIn && clockOut) {
      // Both are provided, validate the time order
      if (clockIn >= clockOut) {
        res.status(400).json({
          success: false,
          message: "Clock Out time must be after Clock In time"
        });
        return;
      }
      // Calculate working hours only when both are provided
      workingHours = calculateWorkingHours(clockIn, clockOut);
    } else if (requiresTime && clockIn && !clockOut) {
      // ✅ Only clockIn provided, clockOut is optional - this is allowed!
      // No working hours calculated
      workingHours = null;
    }

    // ✅ Auto-adjust status based on rules (only for 'present')
    if (finalStatus === "present" && rule) {
      if (rule.halfLeave && clockIn && clockIn >= rule.halfLeave) {
        finalStatus = "half leave";
      } else if (rule.lateTime && clockIn && clockIn >= rule.lateTime) {
        finalStatus = "late";
      }
    }

    // ✅ Update with remote fields - clockOut can be null
    await pool.query<ResultSetHeader>(
      `UPDATE attendance
       SET userId = ?,
           date = ?, 
           clockIn = ?, 
           clockOut = ?,
           attendanceStatus = ?, 
           workingHours = ?,
           type = ?,
           remoteStatus = ?,
           remoteApprovedBy = ?,
           remoteApprovedAt = ?,
           remoteRejectedReason = ?,
           remoteRequestDate = ?,
           remoteFromDate = ?,
           remoteToDate = ?,
           remoteReason = ?
       WHERE id = ?`,
      [
        userId,
        formattedDate,
        clockIn || null,
        clockOut || null, // ✅ Allow null
        finalStatus,
        workingHours,
        type || 'Onsite',
        remoteStatus || null,
        remoteApprovedBy || null,
        remoteApprovedAt || null,
        remoteRejectedReason || null,
        remoteRequestDate || null,
        remoteFromDate || null,
        remoteToDate || null,
        remoteReason || null,
        id,
      ],
    );

    res.json({ 
      success: true,
      message: "Attendance updated successfully",
      data: {
        id,
        status: finalStatus,
        workingHours,
        clockIn: clockIn || null,
        clockOut: clockOut || null
      }
    });
  } catch (error) {
    console.error("❌ Error updating attendance:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to update attendance.",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
// ============================================================
// DELETE ATTENDANCE
// ============================================================
export const deleteAttendance = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const { id } = req.params;

  try {
    const [rows]: any = await pool.query(
      "SELECT userId, date FROM attendance WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Attendance record not found" });
      return;
    }

    const { userId, date } = rows[0];

    await pool.query<ResultSetHeader>(
      "UPDATE attendance SET status = 'N' WHERE id = ?",
      [id],
    );

    res.json({ 
      message: "Attendance deleted successfully",
      userId: userId,
      date: date
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete attendance." });
  }
};