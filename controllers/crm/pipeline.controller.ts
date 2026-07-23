import { Response } from "express";
import pool from "../../database/db";
import { AuthenticatedRequest } from "../../middleware/middleware";
import { RowDataPacket } from "mysql2";

// ============================================
// GET PIPELINE DATA
// ============================================
export const getPipelineData = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const stages = [
      { id: "New", label: "New", color: "blue" },
      { id: "Contacted", label: "Contacted", color: "purple" },
      { id: "Meeting Scheduled", label: "Meeting Scheduled", color: "indigo" },
      { id: "Requirement Gathering", label: "Requirement Gathering", color: "cyan" },
      { id: "Proposal Sent", label: "Proposal Sent", color: "yellow" },
      { id: "Negotiation", label: "Negotiation", color: "orange" },
      { id: "Won", label: "Won", color: "green" },
      { id: "Lost", label: "Lost", color: "red" },
      { id: "On Hold", label: "On Hold", color: "gray" },
    ];

    const pipelineData = [];

    for (const stage of stages) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `
        SELECT 
          l.id,
          l.company_name,
          l.contact_person,
          l.designation,
          l.mobile_number,
          l.email,
          l.lead_priority,
          l.lead_status,
          l.follow_up_date,
          l.follow_up_time,
          l.created_at,
          u.name as assigned_to_name,
          u2.name as created_by_name
        FROM leads l
        LEFT JOIN tbl_users u ON u.id = l.assigned_to
        LEFT JOIN tbl_users u2 ON u2.id = l.created_by
        WHERE l.lead_status = ? AND l.status = 'Y'
        ORDER BY 
          CASE l.lead_priority 
            WHEN 'Hot' THEN 1 
            WHEN 'Warm' THEN 2 
            WHEN 'Cold' THEN 3 
          END,
          l.created_at DESC
        `,
        [stage.id]
      );

      pipelineData.push({
        stage: stage,
        count: rows.length,
        items: rows,
      });
    }

    // Get total leads count
    const [totalLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as total FROM leads WHERE status = 'Y'"
    );

    // Get won leads count
    const [wonLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as won FROM leads WHERE lead_status = 'Won' AND status = 'Y'"
    );

    // Get lost leads count
    const [lostLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as lost FROM leads WHERE lead_status = 'Lost' AND status = 'Y'"
    );

    // Calculate conversion rate
    const total = totalLeads[0].total || 0;
    const won = wonLeads[0].won || 0;
    const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;

    // Get leads by priority
    const [priorityCounts] = await pool.query<RowDataPacket[]>(
      `
      SELECT lead_priority, COUNT(*) as count 
      FROM leads 
      WHERE status = 'Y' 
      GROUP BY lead_priority
      `
    );

    res.json({
      stages: pipelineData,
      stats: {
        total: total,
        won: won,
        lost: lostLeads[0].lost || 0,
        conversionRate: conversionRate,
        byPriority: priorityCounts,
      },
    });
  } catch (error) {
    console.error("Error fetching pipeline data:", error);
    res.status(500).json({ message: "Failed to fetch pipeline data" });
  }
};

// ============================================
// UPDATE LEAD STATUS FROM PIPELINE
// ============================================
export const updateLeadStatusFromPipeline = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const { lead_status, comments } = req.body;

    const [currentLead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentLead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const oldStatus = currentLead[0].lead_status;

    // Update status
    await pool.query("UPDATE leads SET lead_status = ? WHERE id = ?", [
      lead_status,
      id,
    ]);

    // ✅ FIXED: Use correct column names for lead_history table
    // Columns: lead_id, action_type, old_value, new_value, changed_by, comments
    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, old_value, new_value, changed_by, comments) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        'status_changed',
        oldStatus,
        lead_status,
        req.user.id,
        comments || `Status changed from ${oldStatus} to ${lead_status} (via Pipeline)`,
      ]
    );

    res.json({
      message: "Lead status updated successfully",
      old_status: oldStatus,
      new_status: lead_status,
    });
  } catch (error) {
    console.error("Error updating lead status:", error);
    res.status(500).json({ message: "Failed to update lead status" });
  }
};