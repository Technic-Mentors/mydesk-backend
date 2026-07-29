import { Response } from "express";
import pool from "../../database/db";
import { AuthenticatedRequest } from "../../middleware/middleware";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// ============================================
// HELPER: Log Activity to activity_logs
// ============================================
const logSystemActivity = async (
  userId: number,
  action: string,
  module: string,
  referenceId: number,
  oldData: any,
  newData: any,
  description: string
) => {
  try {
    await pool.query(
      `INSERT INTO activity_logs 
       (user_id, action, module, reference_id, old_data, new_data, description) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        action,
        module,
        referenceId,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null,
        description,
      ]
    );
  } catch (error) {
    console.error("Error logging system activity:", error);
  }
};

// ============================================
// HELPER: Add CRM Activity (to crm_activities)
// ============================================
export const addCrmActivity = async (
  module: 'lead' | 'customer',
  referenceId: number,
  activityType: string,
  subject: string,
  description: string | null,
  activityDate: string | null,
  activityTime: string | null,
  createdBy: number
): Promise<number> => {
  try {
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO crm_activities 
       (module, reference_id, activity_type, subject, description, activity_date, activity_time, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        module,
        referenceId,
        activityType,
        subject || '',
        description || null,
        activityDate || null,
        activityTime || null,
        createdBy,
      ]
    );
    return (result as any).insertId;
  } catch (error) {
    console.error("Error adding CRM activity:", error);
    return 0;
  }
};

// ============================================
// GET ACTIVITIES BY MODULE AND REFERENCE ID
// ============================================
export const getActivities = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { module, referenceId } = req.query;

    if (!module || !referenceId) {
      res.status(400).json({ 
        message: "Module and referenceId are required" 
      });
      return;
    }

    if (module !== 'lead' && module !== 'customer') {
      res.status(400).json({ 
        message: "Module must be 'lead' or 'customer'" 
      });
      return;
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        a.*,
        u.name as created_by_name
      FROM crm_activities a
      LEFT JOIN tbl_users u ON u.id = a.created_by
      WHERE a.module = ? 
        AND a.reference_id = ? 
        AND a.status = 'Y'
      ORDER BY a.activity_date DESC, a.activity_time DESC, a.created_at DESC
      `,
      [module, parseInt(referenceId as string)]
    );

    res.json(rows);
  } catch (error) {
    console.error("Error fetching activities:", error);
    res.status(500).json({ message: "Failed to fetch activities" });
  }
};

// ============================================
// GET SINGLE ACTIVITY BY ID
// ============================================
export const getActivityById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        a.*,
        u.name as created_by_name
      FROM crm_activities a
      LEFT JOIN tbl_users u ON u.id = a.created_by
      WHERE a.id = ? AND a.status = 'Y'
      `,
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching activity:", error);
    res.status(500).json({ message: "Failed to fetch activity" });
  }
};

// ============================================
// CREATE MANUAL ACTIVITY
// ============================================
export const createActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const {
      module,
      reference_id,
      activity_type,
      subject,
      description,
      activity_date,
      activity_time,
    } = req.body;

    // Validation
    if (!module || !reference_id || !activity_type) {
      res.status(400).json({
        message: "Module, reference_id, and activity_type are required",
      });
      return;
    }

    if (module !== 'lead' && module !== 'customer') {
      res.status(400).json({
        message: "Module must be 'lead' or 'customer'",
      });
      return;
    }

    // Verify reference exists
    let tableName = module === 'lead' ? 'leads' : 'customers';
    let idField = module === 'lead' ? 'id' : 'id';
    let statusField = module === 'lead' ? 'status' : 'customerStatus';

    const [exists] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM ${tableName} WHERE ${idField} = ? AND ${statusField} = 'Y'`,
      [reference_id]
    );

    if (exists.length === 0) {
      res.status(404).json({
        message: `${module.charAt(0).toUpperCase() + module.slice(1)} not found`,
      });
      return;
    }

    // Insert activity
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO crm_activities 
       (module, reference_id, activity_type, subject, description, activity_date, activity_time, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        module,
        reference_id,
        activity_type,
        subject || null,
        description || null,
        activity_date || null,
        activity_time || null,
        req.user.id,
      ]
    );

    const activityId = (result as any).insertId;

    // If it's a lead, add to lead history
    if (module === 'lead') {
      await pool.query(
        `INSERT INTO lead_history 
         (lead_id, action_type, old_value, new_value, changed_by, comments) 
         VALUES (?, 'activity_added', ?, ?, ?, ?)`,
        [
          reference_id,
          activity_type,
          subject || description || 'Activity added',
          req.user.id,
          `Manual activity: ${activity_type} - ${subject || ''}`,
        ]
      );
    }

    // Log system activity
    await logSystemActivity(
      req.user.id,
      "ACTIVITY_CREATE",
      "ACTIVITY",
      activityId,
      null,
      { module, reference_id, activity_type, subject },
      `Manual activity added for ${module} ${reference_id}: ${activity_type}`
    );

    res.status(201).json({
      message: "Activity created successfully",
      id: activityId,
    });
  } catch (error) {
    console.error("Error creating activity:", error);
    res.status(500).json({ message: "Failed to create activity" });
  }
};

// ============================================
// UPDATE ACTIVITY
// ============================================
export const updateActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const {
      activity_type,
      subject,
      description,
      activity_date,
      activity_time,
    } = req.body;

    // Get current activity
    const [currentActivity] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM crm_activities WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentActivity.length === 0) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }

    // Build update query
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    const addField = (field: string, value: any) => {
      if (value !== undefined && value !== null && value !== "") {
        updateFields.push(`${field} = ?`);
        updateValues.push(value);
      }
    };

    addField('activity_type', activity_type);
    addField('subject', subject);
    addField('description', description);
    addField('activity_date', activity_date);
    addField('activity_time', activity_time);

    if (updateFields.length === 0) {
      res.json({ message: "No fields to update" });
      return;
    }

    updateValues.push(id);
    const query = `UPDATE crm_activities SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, updateValues);

    // Log system activity
    await logSystemActivity(
      req.user.id,
      "ACTIVITY_UPDATE",
      "ACTIVITY",
      parseInt(id),
      currentActivity[0],
      req.body,
      `Activity updated for ${currentActivity[0].module} ${currentActivity[0].reference_id}`
    );

    res.json({ message: "Activity updated successfully" });
  } catch (error) {
    console.error("Error updating activity:", error);
    res.status(500).json({ message: "Failed to update activity" });
  }
};

// ============================================
// DELETE ACTIVITY (Soft Delete)
// ============================================
export const deleteActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const [activity] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM crm_activities WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (activity.length === 0) {
      res.status(404).json({ message: "Activity not found" });
      return;
    }

    await pool.query(
      "UPDATE crm_activities SET status = 'N' WHERE id = ?",
      [id]
    );

    await logSystemActivity(
      req.user.id,
      "ACTIVITY_DELETE",
      "ACTIVITY",
      parseInt(id),
      activity[0],
      null,
      `Activity deleted for ${activity[0].module} ${activity[0].reference_id}`
    );

    res.json({ message: "Activity deleted successfully" });
  } catch (error) {
    console.error("Error deleting activity:", error);
    res.status(500).json({ message: "Failed to delete activity" });
  }
};

// ============================================
// GET ACTIVITY STATS
// ============================================
export const getActivityStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { module, referenceId } = req.query;

    let query = `
      SELECT 
        COUNT(*) as total,
        activity_type,
        COUNT(*) as count
      FROM crm_activities
      WHERE status = 'Y'
    `;

    const params: any[] = [];

    if (module) {
      query += ` AND module = ?`;
      params.push(module);
    }

    if (referenceId) {
      query += ` AND reference_id = ?`;
      params.push(referenceId);
    }

    query += ` GROUP BY activity_type`;

    const [rows] = await pool.query<RowDataPacket[]>(query, params);

    // Get total by module
    const [totalByModule] = await pool.query<RowDataPacket[]>(
      `
      SELECT module, COUNT(*) as count
      FROM crm_activities
      WHERE status = 'Y'
      GROUP BY module
      `
    );

    res.json({
      byType: rows,
      byModule: totalByModule,
      total: rows.reduce((sum, row) => sum + row.count, 0),
    });
  } catch (error) {
    console.error("Error fetching activity stats:", error);
    res.status(500).json({ message: "Failed to fetch activity stats" });
  }
};