import { Response } from "express";
import pool from "../../database/db";
import { AuthenticatedRequest } from "../../middleware/middleware";
import { RowDataPacket, ResultSetHeader } from "mysql2";


// ============================================
// CREATE FOLLOW-UP NOTIFICATION
// ============================================
export const checkAndCreateFollowUpNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const userId = req.user.id;

    // Get today's follow-ups that don't have outcome (pending)
    const [todayFollowUps] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.follow_up_date = CURDATE() 
        AND f.status = 'Y' 
        AND f.outcome IS NULL
        AND f.created_by = ?
      `,
      [userId]
    );

    // Get overdue follow-ups
    const [overdueFollowUps] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.follow_up_date < CURDATE() 
        AND f.status = 'Y' 
        AND f.outcome IS NULL
        AND f.created_by = ?
      `,
      [userId]
    );

    let notificationsCreated = 0;

    // Create notifications for today's follow-ups
    for (const followUp of todayFollowUps) {
      // Check if notification already exists for this follow-up
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM notifications 
         WHERE referenceId = ? AND type = 'followup' AND userId = ? AND isRead = false`,
        [followUp.id, userId]
      );

      if (existing.length === 0) {
        const message = `📅 Follow-up today: ${followUp.lead_name || 'Lead'} - ${followUp.follow_up_type} at ${followUp.follow_up_time}`;
        await pool.query(
          `INSERT INTO notifications 
           (userId, referenceId, type, message, isRead, createdAt) 
           VALUES (?, ?, 'followup', ?, false, NOW())`,
          [userId, followUp.id, message]
        );
        notificationsCreated++;
      }
    }

    // Create notifications for overdue follow-ups
    for (const followUp of overdueFollowUps) {
      // Check if notification already exists for this follow-up
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM notifications 
         WHERE referenceId = ? AND type = 'followup' AND userId = ? AND isRead = false`,
        [followUp.id, userId]
      );

      if (existing.length === 0) {
        const message = `⚠️ OVERDUE Follow-up: ${followUp.lead_name || 'Lead'} - Due on ${new Date(followUp.follow_up_date).toLocaleDateString()}`;
        await pool.query(
          `INSERT INTO notifications 
           (userId, referenceId, type, message, isRead, createdAt) 
           VALUES (?, ?, 'followup', ?, false, NOW())`,
          [userId, followUp.id, message]
        );
        notificationsCreated++;
      }
    }

    res.json({
      success: true,
      message: `Created ${notificationsCreated} notifications`,
      today: todayFollowUps.length,
      overdue: overdueFollowUps.length,
      notificationsCreated,
    });
  } catch (error) {
    console.error("Error creating follow-up notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ============================================
// GET PENDING FOLLOW-UPS (for notification display)
// ============================================
export const getPendingFollowUps = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const userId = req.user.id;

    // Get today's follow-ups
    const [today] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.follow_up_date = CURDATE() 
        AND f.status = 'Y' 
        AND f.outcome IS NULL
        AND f.created_by = ?
      ORDER BY f.follow_up_time ASC
      `,
      [userId]
    );

    // Get overdue follow-ups
    const [overdue] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.follow_up_date < CURDATE() 
        AND f.status = 'Y' 
        AND f.outcome IS NULL
        AND f.created_by = ?
      ORDER BY f.follow_up_date ASC, f.follow_up_time ASC
      `,
      [userId]
    );

    res.json({
      today,
      overdue,
      count: {
        today: today.length,
        overdue: overdue.length,
        total: today.length + overdue.length,
      },
    });
  } catch (error) {
    console.error("Error fetching pending follow-ups:", error);
    res.status(500).json({ message: "Failed to fetch pending follow-ups" });
  }
};
// ============================================
// CREATE FOLLOW-UP NOTIFICATIONS IN DATABASE
// ============================================
export const createFollowUpNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const userId = req.user.id;

    // Get today's follow-ups (pending)
    const [todayFollowUps] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.follow_up_date = CURDATE() 
        AND f.status = 'Y' 
        AND f.outcome IS NULL
        AND f.created_by = ?
      `,
      [userId]
    );

    // Get overdue follow-ups
    const [overdueFollowUps] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      WHERE f.follow_up_date < CURDATE() 
        AND f.status = 'Y' 
        AND f.outcome IS NULL
        AND f.created_by = ?
      `,
      [userId]
    );

    let notificationsCreated = 0;

    // Create notifications for today's follow-ups
    for (const followUp of todayFollowUps) {
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM notifications 
         WHERE referenceId = ? AND type = 'followup' AND userId = ? AND isRead = false`,
        [followUp.id, userId]
      );

      if (existing.length === 0) {
        const message = `📅 Follow-up today: ${followUp.lead_name || 'Lead'} - ${followUp.follow_up_type} at ${followUp.follow_up_time}`;
        await pool.query(
          `INSERT INTO notifications 
           (userId, referenceId, type, message, isRead, createdAt) 
           VALUES (?, ?, 'followup', ?, false, NOW())`,
          [userId, followUp.id, message]
        );
        notificationsCreated++;
      }
    }

    // Create notifications for overdue follow-ups
    for (const followUp of overdueFollowUps) {
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM notifications 
         WHERE referenceId = ? AND type = 'followup' AND userId = ? AND isRead = false`,
        [followUp.id, userId]
      );

      if (existing.length === 0) {
        const message = `⚠️ OVERDUE Follow-up: ${followUp.lead_name || 'Lead'} - Due on ${new Date(followUp.follow_up_date).toLocaleDateString()}`;
        await pool.query(
          `INSERT INTO notifications 
           (userId, referenceId, type, message, isRead, createdAt) 
           VALUES (?, ?, 'followup', ?, false, NOW())`,
          [userId, followUp.id, message]
        );
        notificationsCreated++;
      }
    }

    res.json({
      success: true,
      message: `Created ${notificationsCreated} notifications`,
      notificationsCreated,
    });
  } catch (error) {
    console.error("Error creating follow-up notifications:", error);
    res.status(500).json({ message: "Server error" });
  }
};
// ============================================
// GET ALL FOLLOW-UPS
// ============================================
export const getFollowUps = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { search, type, status } = req.query;

    let query = `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact,
        u.name as created_by_name
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      LEFT JOIN tbl_users u ON u.id = f.created_by
      WHERE f.status = 'Y'
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (l.company_name LIKE ? OR l.contact_person LIKE ? OR f.follow_up_type LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (type) {
      query += ` AND f.follow_up_type = ?`;
      params.push(type);
    }

    if (status === 'pending') {
      query += ` AND f.follow_up_date >= CURDATE()`;
    } else if (status === 'overdue') {
      query += ` AND f.follow_up_date < CURDATE()`;
    } else if (status === 'completed') {
      query += ` AND f.outcome IS NOT NULL`;
    }

    query += ` ORDER BY f.follow_up_date ASC, f.follow_up_time ASC`;

    const [rows] = await pool.query<RowDataPacket[]>(query, params);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching follow-ups:", error);
    res.status(500).json({ message: "Failed to fetch follow-ups" });
  }
};

// ============================================
// GET SINGLE FOLLOW-UP
// ============================================
export const getFollowUpById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        l.company_name as lead_name,
        l.contact_person as lead_contact,
        u.name as created_by_name
      FROM follow_ups f
      LEFT JOIN leads l ON l.id = f.lead_id
      LEFT JOIN tbl_users u ON u.id = f.created_by
      WHERE f.id = ? AND f.status = 'Y'
      `,
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Follow-up not found" });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching follow-up:", error);
    res.status(500).json({ message: "Failed to fetch follow-up" });
  }
};

// ============================================
// CREATE FOLLOW-UP
// ============================================
export const createFollowUp = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const {
      lead_id,
      follow_up_date,
      follow_up_time,
      follow_up_type,
      outcome,
      next_follow_up_date,
      comments,
    } = req.body;

    // Validation
    if (!lead_id || !follow_up_date || !follow_up_time) {
      res.status(400).json({
        message: "Lead ID, Follow-up Date, and Follow-up Time are required",
      });
      return;
    }

    // Check if lead exists
    const [lead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [lead_id]
    );

    if (lead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    // Insert follow-up
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO follow_ups (
        lead_id, follow_up_date, follow_up_time, follow_up_type,
        outcome, next_follow_up_date, comments, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        follow_up_date,
        follow_up_time,
        follow_up_type || "Call",
        outcome || null,
        next_follow_up_date || null,
        comments || null,
        req.user.id,
      ]
    );

    const followUpId = (result as any).insertId;

    // Add to lead history
    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, old_value, new_value, changed_by, comments) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        lead_id,
        'followup_updated',
        null,
        `Follow-up scheduled for ${follow_up_date} at ${follow_up_time}`,
        req.user.id,
        comments || `Follow-up scheduled: ${follow_up_type}`,
      ]
    );

    res.status(201).json({
      message: "Follow-up created successfully",
      id: followUpId,
    });
  } catch (error) {
    console.error("Error creating follow-up:", error);
    res.status(500).json({ message: "Failed to create follow-up" });
  }
};

// ============================================
// UPDATE FOLLOW-UP
// ============================================
export const updateFollowUp = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const {
      follow_up_date,
      follow_up_time,
      follow_up_type,
      outcome,
      next_follow_up_date,
      comments,
    } = req.body;

    // Get current follow-up data
    const [currentFollowUp] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM follow_ups WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentFollowUp.length === 0) {
      res.status(404).json({ message: "Follow-up not found" });
      return;
    }

    const oldData = currentFollowUp[0];

    // Build update query dynamically
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    const addField = (field: string, value: any) => {
      if (value !== undefined && value !== null && value !== "") {
        updateFields.push(`${field} = ?`);
        updateValues.push(value);
      }
    };

    addField('follow_up_date', follow_up_date);
    addField('follow_up_time', follow_up_time);
    addField('follow_up_type', follow_up_type);
    addField('outcome', outcome);
    addField('next_follow_up_date', next_follow_up_date);
    addField('comments', comments);

    if (updateFields.length === 0) {
      res.json({ message: "No fields to update" });
      return;
    }

    updateValues.push(id);
    const query = `UPDATE follow_ups SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, updateValues);

    // Add to lead history
    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, old_value, new_value, changed_by, comments) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        oldData.lead_id,
        'followup_updated',
        `${oldData.follow_up_date} ${oldData.follow_up_time}`,
        `${follow_up_date || oldData.follow_up_date} ${follow_up_time || oldData.follow_up_time}`,
        req.user.id,
        comments || `Follow-up updated`,
      ]
    );

    res.json({ message: "Follow-up updated successfully" });
  } catch (error) {
    console.error("Error updating follow-up:", error);
    res.status(500).json({ message: "Failed to update follow-up" });
  }
};

// ============================================
// DELETE FOLLOW-UP
// ============================================
export const deleteFollowUp = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const [followUp] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM follow_ups WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (followUp.length === 0) {
      res.status(404).json({ message: "Follow-up not found" });
      return;
    }

    await pool.query("UPDATE follow_ups SET status = 'N' WHERE id = ?", [id]);

    res.json({ message: "Follow-up deleted successfully" });
  } catch (error) {
    console.error("Error deleting follow-up:", error);
    res.status(500).json({ message: "Failed to delete follow-up" });
  }
};

// ============================================
// GET FOLLOW-UPS FOR A SPECIFIC LEAD
// ============================================
export const getFollowUpsByLead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { leadId } = req.params;

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        f.*,
        u.name as created_by_name
      FROM follow_ups f
      LEFT JOIN tbl_users u ON u.id = f.created_by
      WHERE f.lead_id = ? AND f.status = 'Y'
      ORDER BY f.follow_up_date DESC, f.follow_up_time DESC
      `,
      [leadId]
    );

    res.json(rows);
  } catch (error) {
    console.error("Error fetching follow-ups:", error);
    res.status(500).json({ message: "Failed to fetch follow-ups" });
  }
};

// ============================================
// GET FOLLOW-UP STATS
// ============================================
export const getFollowUpStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Get today's follow-ups
    const [today] = await pool.query<RowDataPacket[]>(
      `
      SELECT COUNT(*) as count 
      FROM follow_ups 
      WHERE follow_up_date = CURDATE() AND status = 'Y'
      `
    );

    // Get overdue follow-ups
    const [overdue] = await pool.query<RowDataPacket[]>(
      `
      SELECT COUNT(*) as count 
      FROM follow_ups 
      WHERE follow_up_date < CURDATE() AND status = 'Y' AND outcome IS NULL
      `
    );

    // Get upcoming follow-ups (next 7 days)
    const [upcoming] = await pool.query<RowDataPacket[]>(
      `
      SELECT COUNT(*) as count 
      FROM follow_ups 
      WHERE follow_up_date > CURDATE() 
        AND follow_up_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        AND status = 'Y'
      `
    );

    // Get completed follow-ups
    const [completed] = await pool.query<RowDataPacket[]>(
      `
      SELECT COUNT(*) as count 
      FROM follow_ups 
      WHERE outcome IS NOT NULL AND status = 'Y'
      `
    );

    res.json({
      today: today[0].count,
      overdue: overdue[0].count,
      upcoming: upcoming[0].count,
      completed: completed[0].count,
    });
  } catch (error) {
    console.error("Error fetching follow-up stats:", error);
    res.status(500).json({ message: "Failed to fetch follow-up stats" });
  }
};