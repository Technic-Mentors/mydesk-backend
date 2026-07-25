import { Response } from "express";
import pool from "../../database/db";
import { AuthenticatedRequest } from "../../middleware/middleware";
import { RowDataPacket } from "mysql2";

// ============================================
// PIPELINE STAGES - Only qualified leads
// ============================================
const PIPELINE_STAGES = [
  { id: "Meeting Scheduled", label: "Meeting Scheduled", color: "blue" },
  { id: "Proposal Sent", label: "Proposal Sent", color: "yellow" },
  { id: "Negotiation", label: "Negotiation", color: "orange" },
  { id: "Won", label: "Won", color: "green" },
  { id: "Lost", label: "Lost", color: "red" },
  { id: "On Hold", label: "On Hold", color: "gray" },
];

// ============================================
// HELPER: Log Activity
// ============================================
const logActivity = async (
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
    console.error("Error logging activity:", error);
  }
};

// ============================================
// GET PIPELINE DATA
// ============================================
export const getPipelineData = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const pipelineData = [];
    const stageIds = PIPELINE_STAGES.map((s) => s.id);

    for (const stage of PIPELINE_STAGES) {
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
          COALESCE(l.deal_value, 0) as deal_value,
          COALESCE(l.probability, 0) as probability,
          l.expected_close_date,
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

    const [totalLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as total FROM leads WHERE status = 'Y'"
    );

    const [newLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as new_count FROM leads WHERE lead_status = 'New' AND status = 'Y'"
    );

    const [contactedLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as contacted_count FROM leads WHERE lead_status IN ('Contact Attempted', 'Contacted', 'Requirement Gathering') AND status = 'Y'"
    );

    const [qualifiedLeads] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as qualified_count FROM leads 
       WHERE lead_status IN (?,?,?,?,?,?) AND status = 'Y'`,
      stageIds
    );

    const [wonLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as won FROM leads WHERE lead_status = 'Won' AND status = 'Y'"
    );

    const [lostLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as lost FROM leads WHERE lead_status = 'Lost' AND status = 'Y'"
    );

    const total = totalLeads[0].total || 0;
    const won = wonLeads[0].won || 0;
    const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;

    const [priorityCounts] = await pool.query<RowDataPacket[]>(
      `
      SELECT lead_priority, COUNT(*) as count 
      FROM leads 
      WHERE status = 'Y' 
      GROUP BY lead_priority
      `
    );

    const [pipelineValue] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(COALESCE(deal_value, 0)), 0) as total_value 
       FROM leads 
       WHERE lead_status IN (?,?,?,?,?,?) AND status = 'Y'`,
      stageIds
    );

    const [expectedRevenue] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(COALESCE(deal_value, 0) * COALESCE(probability, 0) / 100), 0) as expected_revenue 
       FROM leads 
       WHERE lead_status IN (?,?,?,?,?,?) AND status = 'Y'`,
      stageIds
    );

    res.json({
      stages: pipelineData,
      stats: {
        total: total,
        new: newLeads[0].new_count || 0,
        contacted: contactedLeads[0].contacted_count || 0,
        qualified: qualifiedLeads[0].qualified_count || 0,
        won: won,
        lost: lostLeads[0].lost || 0,
        conversionRate: conversionRate,
        pipelineValue: pipelineValue[0].total_value || 0,
        expectedRevenue: expectedRevenue[0].expected_revenue || 0,
        byPriority: priorityCounts,
      },
    });
  } catch (error) {
    console.error("Error fetching pipeline data:", error);
    res.status(500).json({ message: "Failed to fetch pipeline data" });
  }
};

// ============================================
// UPDATE LEAD STATUS FROM PIPELINE (WITH AUTO-CONVERSION)
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

    // ✅ Get current lead data
    const [currentLead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentLead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const oldStatus = currentLead[0].lead_status;
    const leadData = currentLead[0];

    // ✅ Update lead status
    await pool.query("UPDATE leads SET lead_status = ? WHERE id = ?", [
      lead_status,
      id,
    ]);

    // ✅ ============================================
    // ✅ AUTO-CONVERT TO CUSTOMER IF STATUS BECOMES "Won"
    // ✅ ============================================
    if (lead_status === "Won" && oldStatus !== "Won") {
      // ✅ Check if already converted
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM customers WHERE lead_id = ? AND customerStatus = 'Y'`,
        [id]
      );

      if (existing.length === 0) {
        // ✅ Auto-create customer from lead data
        const [result] = await pool.query(
          `INSERT INTO customers (
            customerName, email, customerContact, companyName, customerAddress,
            companyAddress, lead_id, assigned_to, project_status, purchased_product,
            converted_from_lead, conversion_date, customerStatus
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y')`,
          [
            leadData.contact_person || '',
            leadData.email || '',
            leadData.mobile_number || '',
            leadData.company_name || '',
            leadData.address || '',
            leadData.company_address || '',
            id,
            leadData.assigned_to || null,
            'Active',
            leadData.product_interest || null,
            1,
            new Date().toISOString().split('T')[0],
          ]
        );

        const customerId = (result as any).insertId;

        // ✅ Add auto-conversion to history
        await pool.query(
          `INSERT INTO lead_history 
           (lead_id, action_type, old_value, new_value, changed_by, comments) 
           VALUES (?, 'auto_converted', ?, 'Won', ?, ?)`,
          [
            id,
            oldStatus,
            req.user.id,
            `Lead auto-converted to customer upon becoming Won via Pipeline`,
          ]
        );

        // ✅ Log activity
        await logActivity(
          req.user.id,
          "AUTO_CONVERT",
          "CUSTOMER",
          customerId,
          null,
          { lead_id: id, company_name: leadData.company_name },
          `Lead auto-converted to customer: ${leadData.company_name}`
        );

        console.log(`✅ Lead ${id} auto-converted to customer ${customerId}`);
      }
    }

    // ✅ Add to history (status change)
    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, old_value, new_value, changed_by, comments) 
       VALUES (?, 'status_changed', ?, ?, ?, ?)`,
      [
        id,
        oldStatus,
        lead_status,
        req.user.id,
        comments || `Status changed from ${oldStatus} to ${lead_status} via Pipeline`,
      ]
    );

    // ✅ If there's a comment, add it to lead comments
    if (comments) {
      const existingComments = leadData.comments || "";
      const timestamp = new Date().toLocaleString();
      const userName = req.user.name || "User";
      const commentText = `[${timestamp}] ${userName}: ${comments}`;
      
      const newComments = existingComments 
        ? `${existingComments}\n\n${commentText}`
        : commentText;
      
      await pool.query(
        "UPDATE leads SET comments = ? WHERE id = ?",
        [newComments, id]
      );
    }

    await logActivity(
      req.user.id,
      "STATUS_CHANGE",
      "LEAD",
      parseInt(id),
      { status: oldStatus },
      { status: lead_status },
      `Lead status changed from ${oldStatus} to ${lead_status} (Pipeline)`
    );

    res.json({
      message: lead_status === "Won" && oldStatus !== "Won" 
        ? "Lead status updated and auto-converted to customer successfully!" 
        : "Lead status updated successfully",
      old_status: oldStatus,
      new_status: lead_status,
      auto_converted: lead_status === "Won" && oldStatus !== "Won",
    });
  } catch (error) {
    console.error("Error updating lead status:", error);
    res.status(500).json({ message: "Failed to update lead status" });
  }
};

// ============================================
// DRAG & DROP LEAD
// ============================================
export const dragDropLead = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const { source_stage, target_stage, comments } = req.body;

    // ✅ Get current lead data
    const [currentLead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentLead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const oldStatus = currentLead[0].lead_status;
    const leadData = currentLead[0];

    // ✅ Update lead status
    await pool.query("UPDATE leads SET lead_status = ? WHERE id = ?", [
      target_stage,
      id,
    ]);

    // ✅ AUTO-CONVERT IF TARGET IS "Won"
    if (target_stage === "Won" && oldStatus !== "Won") {
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM customers WHERE lead_id = ? AND customerStatus = 'Y'`,
        [id]
      );

      if (existing.length === 0) {
        const [result] = await pool.query(
          `INSERT INTO customers (
            customerName, email, customerContact, companyName, customerAddress,
            companyAddress, lead_id, assigned_to, project_status, purchased_product,
            converted_from_lead, conversion_date, customerStatus
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y')`,
          [
            leadData.contact_person || '',
            leadData.email || '',
            leadData.mobile_number || '',
            leadData.company_name || '',
            leadData.address || '',
            leadData.company_address || '',
            id,
            leadData.assigned_to || null,
            'Active',
            leadData.product_interest || null,
            1,
            new Date().toISOString().split('T')[0],
          ]
        );

        const customerId = (result as any).insertId;

        await pool.query(
          `INSERT INTO lead_history 
           (lead_id, action_type, old_value, new_value, changed_by, comments) 
           VALUES (?, 'auto_converted', ?, 'Won', ?, ?)`,
          [
            id,
            oldStatus,
            req.user.id,
            `Lead auto-converted to customer upon becoming Won via Drag & Drop`,
          ]
        );

        await logActivity(
          req.user.id,
          "AUTO_CONVERT",
          "CUSTOMER",
          customerId,
          null,
          { lead_id: id, company_name: leadData.company_name },
          `Lead auto-converted to customer: ${leadData.company_name}`
        );

        console.log(`✅ Lead ${id} auto-converted to customer ${customerId}`);
      }
    }

    // ✅ Log in lead history
    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, old_value, new_value, changed_by, comments) 
       VALUES (?, 'status_changed', ?, ?, ?, ?)`,
      [
        id,
        oldStatus,
        target_stage,
        req.user.id,
        comments || `Dragged from ${source_stage} to ${target_stage}`,
      ]
    );

    // ✅ Log activity
    await logActivity(
      req.user.id,
      "DRAG_DROP",
      "LEAD",
      parseInt(id),
      { source: source_stage, old_status: oldStatus },
      { target: target_stage, new_status: target_stage },
      `Lead moved from ${source_stage} to ${target_stage}`
    );

    res.json({
      message: target_stage === "Won" && oldStatus !== "Won"
        ? "Lead moved and auto-converted to customer successfully!"
        : "Lead moved successfully",
      old_status: oldStatus,
      new_status: target_stage,
      auto_converted: target_stage === "Won" && oldStatus !== "Won",
    });
  } catch (error) {
    console.error("Error moving lead:", error);
    res.status(500).json({ message: "Failed to move lead" });
  }
};

// ============================================
// UPDATE LEAD DEAL VALUE
// ============================================
export const updateLeadDealValue = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const { deal_value, probability, expected_close_date } = req.body;

    // ✅ Check if lead exists
    const [currentLead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentLead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    // ✅ Update deal value
    await pool.query(
      `UPDATE leads 
       SET deal_value = COALESCE(?, deal_value),
           probability = COALESCE(?, probability),
           expected_close_date = COALESCE(?, expected_close_date)
       WHERE id = ?`,
      [deal_value, probability, expected_close_date, id]
    );

    // ✅ Log activity
    await logActivity(
      req.user.id,
      "DEAL_UPDATE",
      "LEAD",
      parseInt(id),
      null,
      { deal_value, probability, expected_close_date },
      `Deal value updated for lead ${currentLead[0].company_name}`
    );

    res.json({
      message: "Deal value updated successfully",
    });
  } catch (error) {
    console.error("Error updating deal value:", error);
    res.status(500).json({ message: "Failed to update deal value" });
  }
};