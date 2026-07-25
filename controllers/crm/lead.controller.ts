import { Response } from "express";
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

    res.json(rows[0]);
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
      deal_value,
      probability,
      expected_close_date,
      address,
      company_size,
      linkedin,
      budget,
      department,
      manager,
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
        file_attachment, assigned_to, created_by,
        deal_value, probability, expected_close_date,
        address, company_size, linkedin, budget, department, manager
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        deal_value || null,
        probability || null,
        expected_close_date || null,
        address || null,
        company_size || null,
        linkedin || null,
        budget || null,
        department || null,
        manager || null,
      ]
    );

    const leadId = (result as any).insertId;

    if (uploadId) {
      await pool.query(
        `UPDATE uploads SET reference_id = ? WHERE id = ?`,
        [leadId, uploadId]
      );
    }

    await addHistory(
      leadId,
      'created',
      req.user.id,
      null,
      null,
      JSON.stringify({ company_name, contact_person }),
      `Lead created: ${company_name}`
    );

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
// UPDATE LEAD (WITH AUTO-CONVERSION TO CUSTOMER)
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
      deal_value,
      probability,
      expected_close_date,
      address,
      company_size,
      linkedin,
      budget,
      department,
      manager,
    } = req.body;

    const [currentLead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentLead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const oldData = currentLead[0];

    const updateFields: string[] = [];
    const updateValues: any[] = [];

    const addField = (field: string, value: any) => {
      if (value !== undefined && value !== null && value !== "") {
        updateFields.push(`${field} = ?`);
        updateValues.push(value);
      }
    };

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
    addField('deal_value', deal_value);
    addField('probability', probability);
    addField('expected_close_date', expected_close_date);
    addField('address', address);
    addField('company_size', company_size);
    addField('linkedin', linkedin);
    addField('budget', budget);
    addField('department', department);
    addField('manager', manager);

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

    if (updateFields.length === 0) {
      res.json({ message: "No fields to update" });
      return;
    }

    updateValues.push(id);
    const query = `UPDATE leads SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, updateValues);

    // Track changes for history
    const changes = [];

    if (oldData.lead_status !== lead_status && lead_status) {
      changes.push({
        field: 'lead_status',
        old_value: oldData.lead_status,
        new_value: lead_status,
        action_type: 'status_changed',
        comment: `Status changed from ${oldData.lead_status} to ${lead_status}`
      });
    }

    if (oldData.lead_priority !== lead_priority && lead_priority) {
      changes.push({
        field: 'lead_priority',
        old_value: oldData.lead_priority,
        new_value: lead_priority,
        action_type: 'priority_changed',
        comment: `Priority changed from ${oldData.lead_priority} to ${lead_priority}`
      });
    }

    if (oldData.deal_value !== deal_value && deal_value !== undefined) {
      changes.push({
        field: 'deal_value',
        old_value: oldData.deal_value,
        new_value: deal_value,
        action_type: 'lead_updated',
        comment: `Deal value changed from ${oldData.deal_value || 'N/A'} to ${deal_value}`
      });
    }

    if (oldData.probability !== probability && probability !== undefined) {
      changes.push({
        field: 'probability',
        old_value: oldData.probability,
        new_value: probability,
        action_type: 'lead_updated',
        comment: `Probability changed from ${oldData.probability || 'N/A'}% to ${probability}%`
      });
    }

    if (comments && comments !== oldData.comments) {
      changes.push({
        field: 'comments',
        old_value: oldData.comments,
        new_value: comments,
        action_type: 'comment_added',
        comment: comments
      });
    }

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
      `Lead updated: ${company_name || oldData.company_name}`
    );

    // ✅ ============================================
    // ✅ AUTO-CONVERT TO CUSTOMER IF STATUS BECOMES "Won"
    // ✅ ============================================
    if (lead_status === "Won" && oldData.lead_status !== "Won") {
      // ✅ Check if already converted
      const [existing] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM customers WHERE lead_id = ? AND customerStatus = 'Y'`,
        [id]
      );

      if (existing.length === 0) {
        // ✅ Get the updated lead data
        const [updatedLead] = await pool.query<RowDataPacket[]>(
          "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
          [id]
        );

        const leadData = updatedLead[0];

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
            parseInt(id),
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
            oldData.lead_status || 'New',
            req.user.id,
            `Lead auto-converted to customer upon becoming Won`,
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

        res.json({
          message: "Lead updated and auto-converted to customer successfully!",
          auto_converted: true,
          customer_id: customerId,
        });
        return;
      }
    }

    res.json({ 
      message: "Lead updated successfully",
      auto_converted: false,
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ message: "Failed to update lead" });
  }
};

// ============================================
// UPDATE LEAD STATUS (WITH AUTO-CONVERSION)
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

    // ✅ AUTO-CONVERT TO CUSTOMER IF STATUS BECOMES "Won"
    if (lead_status === "Won" && oldStatus !== "Won") {
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
            `Lead auto-converted to customer upon becoming Won`,
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

    // ✅ Add to history
    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, old_value, new_value, changed_by, comments) 
       VALUES (?, 'status_changed', ?, ?, ?, ?)`,
      [
        id,
        oldStatus,
        lead_status,
        req.user.id,
        comments || `Status changed from ${oldStatus} to ${lead_status}`,
      ]
    );

    // ✅ If there's a comment, add it
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
      `Lead status changed from ${oldStatus} to ${lead_status}`
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
// ADD COMMENT
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

    const [dealStats] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        COALESCE(SUM(deal_value), 0) as total_deal_value,
        COALESCE(AVG(deal_value), 0) as avg_deal_value,
        COALESCE(SUM(deal_value * probability / 100), 0) as expected_revenue
      FROM leads 
      WHERE status = 'Y'
      `
    );

    res.json({
      total: totalLeads[0].total,
      byStatus: statusCounts,
      byPriority: priorityCounts,
      dealStats: {
        totalDealValue: dealStats[0].total_deal_value || 0,
        avgDealValue: dealStats[0].avg_deal_value || 0,
        expectedRevenue: dealStats[0].expected_revenue || 0,
      }
    });
  } catch (error) {
    console.error("Error fetching lead stats:", error);
    res.status(500).json({ message: "Failed to fetch lead stats" });
  }
};

// ============================================
// BULK DELETE LEADS
// ============================================
export const bulkDeleteLeads = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ message: "No leads selected" });
      return;
    }

    // ✅ Soft delete all selected leads
    const placeholders = ids.map(() => '?').join(',');
    await pool.query(
      `UPDATE leads SET status = 'N' WHERE id IN (${placeholders})`,
      ids
    );

    // ✅ Log activity
    await logActivity(
      req.user.id,
      "BULK_DELETE",
      "LEAD",
      0,
      null,
      { count: ids.length },
      `Bulk deleted ${ids.length} leads`
    );

    res.json({
      message: `${ids.length} leads deleted successfully`,
      count: ids.length,
    });
  } catch (error) {
    console.error("Error bulk deleting leads:", error);
    res.status(500).json({ message: "Failed to delete leads" });
  }
};

// ============================================
// BULK UPDATE LEAD STATUS
// ============================================
export const bulkUpdateStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { ids, status, comments } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ message: "No leads selected" });
      return;
    }

    if (!status) {
      res.status(400).json({ message: "Status is required" });
      return;
    }

    // ✅ Update all selected leads
    const placeholders = ids.map(() => '?').join(',');
    await pool.query(
      `UPDATE leads SET lead_status = ? WHERE id IN (${placeholders})`,
      [status, ...ids]
    );

    // ✅ Add to history for each lead
    for (const id of ids) {
      await pool.query(
        `INSERT INTO lead_history 
         (lead_id, action_type, old_value, new_value, changed_by, comments) 
         VALUES (?, 'bulk_status_change', ?, ?, ?, ?)`,
        [
          id,
          'Previous',
          status,
          req.user.id,
          comments || `Bulk status update to ${status}`,
        ]
      );
    }

    // ✅ Log activity
    await logActivity(
      req.user.id,
      "BULK_STATUS",
      "LEAD",
      0,
      null,
      { count: ids.length, status },
      `Bulk updated ${ids.length} leads to status: ${status}`
    );

    res.json({
      message: `${ids.length} leads status updated to ${status}`,
      count: ids.length,
    });
  } catch (error) {
    console.error("Error bulk updating leads:", error);
    res.status(500).json({ message: "Failed to update leads" });
  }
};

// ============================================
// BULK UPDATE LEAD PRIORITY
// ============================================
export const bulkUpdatePriority = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { ids, priority } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ message: "No leads selected" });
      return;
    }

    if (!priority) {
      res.status(400).json({ message: "Priority is required" });
      return;
    }

    // ✅ Update all selected leads
    const placeholders = ids.map(() => '?').join(',');
    await pool.query(
      `UPDATE leads SET lead_priority = ? WHERE id IN (${placeholders})`,
      [priority, ...ids]
    );

    // ✅ Add to history for each lead
    for (const id of ids) {
      await pool.query(
        `INSERT INTO lead_history 
         (lead_id, action_type, old_value, new_value, changed_by, comments) 
         VALUES (?, 'bulk_priority_change', ?, ?, ?, ?)`,
        [
          id,
          'Previous',
          priority,
          req.user.id,
          `Bulk priority update to ${priority}`,
        ]
      );
    }

    // ✅ Log activity
    await logActivity(
      req.user.id,
      "BULK_PRIORITY",
      "LEAD",
      0,
      null,
      { count: ids.length, priority },
      `Bulk updated ${ids.length} leads to priority: ${priority}`
    );

    res.json({
      message: `${ids.length} leads priority updated to ${priority}`,
      count: ids.length,
    });
  } catch (error) {
    console.error("Error bulk updating leads:", error);
    res.status(500).json({ message: "Failed to update leads" });
  }
};
// ============================================
// EXPORT LEADS TO CSV/EXCEL
// ============================================
// ============================================
// EXPORT LEADS TO CSV
// ============================================
export const exportLeads = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { status, priority, source, search } = req.query;

    let query = `
      SELECT 
        id,
        company_name,
        contact_person,
        designation,
        mobile_number,
        email,
        website,
        country,
        city,
        industry,
        lead_source,
        product_interest,
        lead_priority,
        lead_status,
        DATE_FORMAT(created_at, '%Y-%m-%d') as created_date,
        follow_up_date,
        deal_value,
        probability,
        expected_close_date,
        address,
        company_size,
        linkedin,
        budget,
        department,
        manager
      FROM leads
      WHERE status = 'Y'
    `;

    const params: any[] = [];

    if (status) {
      query += ` AND lead_status = ?`;
      params.push(status);
    }

    if (priority) {
      query += ` AND lead_priority = ?`;
      params.push(priority);
    }

    if (source) {
      query += ` AND lead_source = ?`;
      params.push(source);
    }

    if (search) {
      query += ` AND (company_name LIKE ? OR contact_person LIKE ? OR email LIKE ? OR mobile_number LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY created_at DESC`;

    const [rows] = await pool.query<RowDataPacket[]>(query, params);

    if (rows.length === 0) {
      res.status(404).json({ message: "No leads found to export" });
      return;
    }

    // ✅ Convert to CSV
    const headers = [
      'ID', 'Company', 'Contact Person', 'Designation', 'Mobile',
      'Email', 'Website', 'Country', 'City', 'Industry',
      'Source', 'Product Interest', 'Priority', 'Status',
      'Created Date', 'Follow-up Date', 'Deal Value', 'Probability', 'Expected Close',
      'Address', 'Company Size', 'LinkedIn', 'Budget', 'Department', 'Manager'
    ];

    let csv = headers.join(',') + '\n';

    for (const row of rows as any[]) {
      const rowData = [
        row.id || '',
        `"${(row.company_name || '').replace(/"/g, '""')}"`,
        `"${(row.contact_person || '').replace(/"/g, '""')}"`,
        `"${(row.designation || '').replace(/"/g, '""')}"`,
        `"${(row.mobile_number || '').replace(/"/g, '""')}"`,
        `"${(row.email || '').replace(/"/g, '""')}"`,
        `"${(row.website || '').replace(/"/g, '""')}"`,
        `"${(row.country || '').replace(/"/g, '""')}"`,
        `"${(row.city || '').replace(/"/g, '""')}"`,
        `"${(row.industry || '').replace(/"/g, '""')}"`,
        `"${(row.lead_source || '').replace(/"/g, '""')}"`,
        `"${(row.product_interest || '').replace(/"/g, '""')}"`,
        `"${(row.lead_priority || '').replace(/"/g, '""')}"`,
        `"${(row.lead_status || '').replace(/"/g, '""')}"`,
        row.created_date || '',
        row.follow_up_date || '',
        row.deal_value || '',
        row.probability || '',
        row.expected_close_date || '',
        `"${(row.address || '').replace(/"/g, '""')}"`,
        `"${(row.company_size || '').replace(/"/g, '""')}"`,
        `"${(row.linkedin || '').replace(/"/g, '""')}"`,
        row.budget || '',
        `"${(row.department || '').replace(/"/g, '""')}"`,
        `"${(row.manager || '').replace(/"/g, '""')}"`,
      ];
      csv += rowData.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=leads_${new Date().toISOString().split('T')[0]}.csv`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csv);
  } catch (error) {
    console.error("Error exporting leads:", error);
    res.status(500).json({ message: "Failed to export leads" });
  }
};