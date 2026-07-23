import { Request, Response } from "express";
import pool from "../../database/db";
import { AuthenticatedRequest } from "../../middleware/middleware";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import fs from "fs";
import path from "path";

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
// HELPER: Add History Entry
// ============================================
const addHistory = async (
  leadId: number,
  actionType: string,
  changedBy: number,
  fieldName: string | null,
  oldValue: string | null,
  newValue: string | null,
  comments: string | null
) => {
  try {
    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, changed_by, field_name, old_value, new_value, comments) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        leadId,
        actionType,
        changedBy,
        fieldName,
        oldValue,
        newValue,
        comments,
      ]
    );
  } catch (error) {
    console.error("Error adding history:", error);
  }
};

// ============================================
// GET ALL LEADS
// ============================================
export const getLeads = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { search, status, priority, source } = req.query;

    let query = `
      SELECT 
        l.*,
        u.name as assigned_to_name,
        u2.name as created_by_name
      FROM leads l
      LEFT JOIN tbl_users u ON u.id = l.assigned_to
      LEFT JOIN tbl_users u2 ON u2.id = l.created_by
      WHERE l.status = 'Y'
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (l.company_name LIKE ? OR l.contact_person LIKE ? OR l.email LIKE ? OR l.mobile_number LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      query += ` AND l.lead_status = ?`;
      params.push(status);
    }

    if (priority) {
      query += ` AND l.lead_priority = ?`;
      params.push(priority);
    }

    if (source) {
      query += ` AND l.lead_source = ?`;
      params.push(source);
    }

    query += ` ORDER BY l.created_at DESC`;

    const [rows] = await pool.query<RowDataPacket[]>(query, params);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ message: "Failed to fetch leads" });
  }
};

// ============================================
// GET SINGLE LEAD
// ============================================
export const getLeadById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        l.*,
        u.name as assigned_to_name,
        u2.name as created_by_name
      FROM leads l
      LEFT JOIN tbl_users u ON u.id = l.assigned_to
      LEFT JOIN tbl_users u2 ON u2.id = l.created_by
      WHERE l.id = ? AND l.status = 'Y'
      `,
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    // Get history
    const [history] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        h.*,
        u.name as changed_by_name
      FROM lead_history h
      LEFT JOIN tbl_users u ON u.id = h.changed_by
      WHERE h.lead_id = ?
      ORDER BY h.created_at DESC
      `,
      [id]
    );

    res.json({
      ...rows[0],
      history: history,
    });
  } catch (error) {
    console.error("Error fetching lead:", error);
    res.status(500).json({ message: "Failed to fetch lead" });
  }
};

// ============================================
// CREATE LEAD
// ============================================
export const createLead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const {
      company_name,
      contact_person,
      designation,
      mobile_number,
      whatsapp_number,
      email,
      website,
      country,
      city,
      industry,
      lead_source,
      product_interest,
      lead_priority,
      lead_status,
      follow_up_date,
      follow_up_time,
      comments,
      assigned_to,
    } = req.body;

    if (!company_name || !contact_person || !mobile_number) {
      res.status(400).json({
        message: "Company Name, Contact Person, and Mobile Number are required",
      });
      return;
    }

    let file_attachment = null;
    let uploadId = null;
    
    if (req.file) {
      const uploadDir = path.join(__dirname, "../../uploads/leads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const fileName = `${Date.now()}-${req.file.originalname}`;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, req.file.buffer);
      file_attachment = `/uploads/leads/${fileName}`;

      const [uploadResult] = await pool.query<ResultSetHeader>(
        `INSERT INTO uploads 
         (module, reference_id, file_name, original_name, file_path, file_size, file_type, uploaded_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'lead',
          0,
          fileName,
          req.file.originalname,
          file_attachment,
          req.file.size,
          req.file.mimetype,
          req.user.id,
        ]
      );
      uploadId = (uploadResult as any).insertId;
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO leads (
        company_name, contact_person, designation, mobile_number, whatsapp_number,
        email, website, country, city, industry, lead_source, product_interest,
        lead_priority, lead_status, follow_up_date, follow_up_time, comments,
        file_attachment, assigned_to, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_name,
        contact_person,
        designation || null,
        mobile_number,
        whatsapp_number || null,
        email || null,
        website || null,
        country || null,
        city || null,
        industry || null,
        lead_source || "Other",
        product_interest || null,
        lead_priority || "Warm",
        lead_status || "New",
        follow_up_date || null,
        follow_up_time || null,
        comments || null,
        file_attachment,
        assigned_to || null,
        req.user.id,
      ]
    );

    const leadId = (result as any).insertId;

    if (uploadId) {
      await pool.query(
        `UPDATE uploads SET reference_id = ? WHERE id = ?`,
        [leadId, uploadId]
      );
    }

    // ✅ HISTORY: Lead Created
    await addHistory(
      leadId,
      'created',
      req.user.id,
      null,
      null,
      JSON.stringify({ company_name, contact_person }),
      `Lead created: ${company_name}`
    );

    // ✅ If initial status is not "New", add status change
    if (lead_status && lead_status !== "New") {
      await addHistory(
        leadId,
        'status_changed',
        req.user.id,
        'lead_status',
        'New',
        lead_status,
        `Initial status set to ${lead_status}`
      );
    }

    // ✅ If initial priority is not "Warm", add priority change
    if (lead_priority && lead_priority !== "Warm") {
      await addHistory(
        leadId,
        'priority_changed',
        req.user.id,
        'lead_priority',
        'Warm',
        lead_priority,
        `Initial priority set to ${lead_priority}`
      );
    }

    // ✅ If comments provided, add comment history
    if (comments) {
      await addHistory(
        leadId,
        'comment_added',
        req.user.id,
        'comments',
        null,
        comments,
        comments
      );
    }

    // ✅ If follow-up date provided, add follow-up history
    if (follow_up_date) {
      await addHistory(
        leadId,
        'followup_updated',
        req.user.id,
        'follow_up_date',
        null,
        follow_up_date,
        `Follow-up scheduled for ${follow_up_date}`
      );
    }

    await logActivity(
      req.user.id,
      "CREATE",
      "LEAD",
      leadId,
      null,
      req.body,
      `New lead created: ${company_name}`
    );

    res.status(201).json({
      message: "Lead created successfully",
      id: leadId,
    });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({ message: "Failed to create lead" });
  }
};

// ============================================
// UPDATE LEAD
// ============================================
// ============================================
// UPDATE LEAD - With Partial Update Support
// ============================================
export const updateLead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const {
      company_name,
      contact_person,
      designation,
      mobile_number,
      whatsapp_number,
      email,
      website,
      country,
      city,
      industry,
      lead_source,
      product_interest,
      lead_priority,
      lead_status,
      follow_up_date,
      follow_up_time,
      comments,
      assigned_to,
    } = req.body;

    // Get current lead data
    const [currentLead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentLead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const oldData = currentLead[0];

    // ✅ Build update query dynamically - only update fields that are provided
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    // Helper to add field to update if provided
    const addField = (field: string, value: any, defaultValue: any = null) => {
      if (value !== undefined && value !== null && value !== "") {
        updateFields.push(`${field} = ?`);
        updateValues.push(value);
      }
    };

    // Add all fields (only if provided)
    addField('company_name', company_name);
    addField('contact_person', contact_person);
    addField('designation', designation);
    addField('mobile_number', mobile_number);
    addField('whatsapp_number', whatsapp_number);
    addField('email', email);
    addField('website', website);
    addField('country', country);
    addField('city', city);
    addField('industry', industry);
    addField('lead_source', lead_source);
    addField('product_interest', product_interest);
    addField('lead_priority', lead_priority);
    addField('lead_status', lead_status);
    addField('follow_up_date', follow_up_date);
    addField('follow_up_time', follow_up_time);
    addField('comments', comments);
    addField('assigned_to', assigned_to);

    // Handle file upload separately
    let file_attachment = oldData.file_attachment;
    
    if (req.file) {
      if (oldData.file_attachment) {
        const oldPath = path.join(__dirname, "../../", oldData.file_attachment);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
        await pool.query(
          `UPDATE uploads SET status = 'N' WHERE reference_id = ? AND module = 'lead'`,
          [id]
        );
      }

      const uploadDir = path.join(__dirname, "../../uploads/leads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const fileName = `${Date.now()}-${req.file.originalname}`;
      const filePath = path.join(uploadDir, fileName);
      fs.writeFileSync(filePath, req.file.buffer);
      file_attachment = `/uploads/leads/${fileName}`;

      await pool.query(
        `INSERT INTO uploads 
         (module, reference_id, file_name, original_name, file_path, file_size, file_type, uploaded_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'lead',
          parseInt(id),
          fileName,
          req.file.originalname,
          file_attachment,
          req.file.size,
          req.file.mimetype,
          req.user.id,
        ]
      );
      
      updateFields.push('file_attachment = ?');
      updateValues.push(file_attachment);
    }

    // ✅ Only proceed if there are fields to update
    if (updateFields.length === 0) {
      res.json({ message: "No fields to update" });
      return;
    }

    // ✅ Execute update
    updateValues.push(id);
    const query = `UPDATE leads SET ${updateFields.join(', ')} WHERE id = ?`;
    
    await pool.query(query, updateValues);

    // ✅ Track changes for history (only if fields actually changed)
    const changes = [];

    // Check status change
    if (lead_status && oldData.lead_status !== lead_status) {
      changes.push({
        field: 'lead_status',
        old_value: oldData.lead_status,
        new_value: lead_status,
        action_type: 'status_changed',
        comment: `Status changed from ${oldData.lead_status} to ${lead_status}`
      });
    }

    // Check priority change
    if (lead_priority && oldData.lead_priority !== lead_priority) {
      changes.push({
        field: 'lead_priority',
        old_value: oldData.lead_priority,
        new_value: lead_priority,
        action_type: 'priority_changed',
        comment: `Priority changed from ${oldData.lead_priority} to ${lead_priority}`
      });
    }

    // Check follow-up date change
    if (follow_up_date && oldData.follow_up_date !== follow_up_date) {
      changes.push({
        field: 'follow_up_date',
        old_value: oldData.follow_up_date,
        new_value: follow_up_date,
        action_type: 'followup_updated',
        comment: `Follow-up date changed from ${oldData.follow_up_date || 'N/A'} to ${follow_up_date || 'N/A'}`
      });
    }

    // Check follow-up time change
    if (follow_up_time && oldData.follow_up_time !== follow_up_time) {
      changes.push({
        field: 'follow_up_time',
        old_value: oldData.follow_up_time,
        new_value: follow_up_time,
        action_type: 'followup_updated',
        comment: `Follow-up time changed from ${oldData.follow_up_time || 'N/A'} to ${follow_up_time || 'N/A'}`
      });
    }

    // Check assigned_to change
    if (assigned_to && oldData.assigned_to !== parseInt(assigned_to)) {
      const [oldUser] = await pool.query<RowDataPacket[]>(
        "SELECT name FROM tbl_users WHERE id = ?",
        [oldData.assigned_to]
      );
      const [newUser] = await pool.query<RowDataPacket[]>(
        "SELECT name FROM tbl_users WHERE id = ?",
        [assigned_to]
      );
      changes.push({
        field: 'assigned_to',
        old_value: oldData.assigned_to,
        new_value: assigned_to,
        action_type: 'assigned_changed',
        comment: `Assigned from ${oldUser[0]?.name || 'Unassigned'} to ${newUser[0]?.name || 'Unassigned'}`
      });
    }

    // Check if new comments added (different from old)
  // Inside updateLead function - Remove the duplicate comment entry

// ✅ Check if new comments added (different from old)
if (comments && comments !== oldData.comments) {
  // ✅ Only add comment history if it's NOT a status change with comment
  // Check if status also changed - if yes, comment is already included in status_changed
  const statusChanged = lead_status && oldData.lead_status !== lead_status;
  
  if (!statusChanged) {
    // ✅ Only add as comment_added if status didn't change
    changes.push({
      field: 'comments',
      old_value: oldData.comments,
      new_value: comments,
      action_type: 'comment_added',
      comment: comments
    });
  }
}
    // ✅ Save all changes to history
    for (const change of changes) {
      await addHistory(
        parseInt(id),
        change.action_type,
        req.user.id,
        change.field,
        change.old_value ? String(change.old_value) : null,
        change.new_value ? String(change.new_value) : null,
        change.comment
      );
    }

    await logActivity(
      req.user.id,
      "UPDATE",
      "LEAD",
      parseInt(id),
      oldData,
      req.body,
      `Lead updated: ${oldData.company_name}`
    );

    res.json({ message: "Lead updated successfully" });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ message: "Failed to update lead" });
  }
};
// ============================================
// UPDATE LEAD STATUS
// ============================================
// ============================================
// UPDATE LEAD STATUS
// ============================================
// ============================================
// UPDATE LEAD STATUS
// ============================================
export const updateLeadStatus = async (
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
    const existingComments = currentLead[0].comments || "";

    // ✅ Update status
    await pool.query("UPDATE leads SET lead_status = ? WHERE id = ?", [
      lead_status,
      id,
    ]);

    // ✅ If there's a comment, append to main comments field
    let commentText = "";
    if (comments) {
      const timestamp = new Date().toLocaleString();
      const userName = req.user.name || "User";
      commentText = `[${timestamp}] ${userName}: ${comments}`;
      
      const newComments = existingComments 
        ? `${existingComments}\n\n${commentText}`
        : commentText;
      
      await pool.query(
        "UPDATE leads SET comments = ? WHERE id = ?",
        [newComments, id]
      );
    }

    // ✅ Add ONLY ONE history entry for status change with comment included
    const historyComment = comments 
      ? `Status changed from ${oldStatus} to ${lead_status}. Comment: ${comments}`
      : `Status changed from ${oldStatus} to ${lead_status}`;

    await addHistory(
      parseInt(id),
      'status_changed',
      req.user.id,
      'lead_status',
      oldStatus,
      lead_status,
      historyComment
    );

    await logActivity(
      req.user.id,
      "STATUS_CHANGE",
      "LEAD",
      parseInt(id),
      { status: oldStatus },
      { status: lead_status },
      `Lead status changed from ${oldStatus} to ${lead_status}`
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
// ============================================
// ADD COMMENT ONLY
// ============================================


// ============================================
// DELETE LEAD
// ============================================
export const deleteLead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const [lead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (lead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    await pool.query("UPDATE leads SET status = 'N' WHERE id = ?", [id]);

    // ✅ Add to history
    await addHistory(
      parseInt(id),
      'deleted',
      req.user.id,
      null,
      null,
      null,
      `Lead deleted by ${req.user.name}`
    );

    await logActivity(
      req.user.id,
      "DELETE",
      "LEAD",
      parseInt(id),
      lead[0],
      null,
      `Lead deleted: ${lead[0].company_name}`
    );

    res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({ message: "Failed to delete lead" });
  }
};

// ============================================
// GET LEAD HISTORY
// ============================================
export const getLeadHistory = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        h.*,
        u.name as changed_by_name
      FROM lead_history h
      LEFT JOIN tbl_users u ON u.id = h.changed_by
      WHERE h.lead_id = ?
      ORDER BY h.created_at DESC
      `,
      [id]
    );

    res.json(rows);
  } catch (error) {
    console.error("Error fetching lead history:", error);
    res.status(500).json({ message: "Failed to fetch lead history" });
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
    const stages = [
      "New",
      "Contacted",
      "Meeting Scheduled",
      "Requirement Gathering",
      "Proposal Sent",
      "Negotiation",
      "Won",
      "Lost",
      "On Hold",
    ];

    const pipelineData = [];

    for (const stage of stages) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `
        SELECT 
          l.id,
          l.company_name,
          l.contact_person,
          l.lead_priority,
          u.name as assigned_to_name,
          l.follow_up_date
        FROM leads l
        LEFT JOIN tbl_users u ON u.id = l.assigned_to
        WHERE l.lead_status = ? AND l.status = 'Y'
        ORDER BY l.lead_priority = 'Hot' DESC, l.created_at DESC
        LIMIT 10
        `,
        [stage]
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

    res.json({
      stages: pipelineData,
      total: totalLeads[0].total,
    });
  } catch (error) {
    console.error("Error fetching pipeline data:", error);
    res.status(500).json({ message: "Failed to fetch pipeline data" });
  }
};

// ============================================
// GET LEAD STATS
// ============================================
export const getLeadStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const [totalLeads] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as total FROM leads WHERE status = 'Y'"
    );

    const [statusCounts] = await pool.query<RowDataPacket[]>(
      `
      SELECT lead_status, COUNT(*) as count 
      FROM leads 
      WHERE status = 'Y' 
      GROUP BY lead_status
      `
    );

    const [priorityCounts] = await pool.query<RowDataPacket[]>(
      `
      SELECT lead_priority, COUNT(*) as count 
      FROM leads 
      WHERE status = 'Y' 
      GROUP BY lead_priority
      `
    );

    res.json({
      total: totalLeads[0].total,
      byStatus: statusCounts,
      byPriority: priorityCounts,
    });
  } catch (error) {
    console.error("Error fetching lead stats:", error);
    res.status(500).json({ message: "Failed to fetch lead stats" });
  }
};
// Add this to lead.controller.ts

// ============================================
// ADD COMMENT ONLY
// ============================================
// ============================================
// ADD COMMENT ONLY
// ============================================
// ============================================
// ADD COMMENT ONLY
// ============================================
export const addComment = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const { comment } = req.body;

    if (!comment) {
      res.status(400).json({ message: "Comment is required" });
      return;
    }

    const [currentLead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentLead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    // ✅ Append comment to existing comments
    const existingComments = currentLead[0].comments || "";
    const timestamp = new Date().toLocaleString();
    const userName = req.user.name || "User";
    const commentText = `[${timestamp}] ${userName}: ${comment}`;
    
    const newComments = existingComments 
      ? `${existingComments}\n\n${commentText}`
      : commentText;

    await pool.query(
      "UPDATE leads SET comments = ? WHERE id = ?",
      [newComments, id]
    );

    // ✅ Add ONLY ONE history entry for comment
    await addHistory(
      parseInt(id),
      'comment_added',
      req.user.id,
      'comments',
      null,
      comment,
      comment
    );

    await logActivity(
      req.user.id,
      "COMMENT_ADDED",
      "LEAD",
      parseInt(id),
      null,
      { comment },
      `Comment added to lead: ${comment}`
    );

    res.json({ 
      message: "Comment added successfully",
      comment: comment
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ message: "Failed to add comment" });
  }
};