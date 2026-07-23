import { Response } from "express";
import pool from "../../database/db";
import { AuthenticatedRequest } from "../../middleware/middleware";
import { RowDataPacket, ResultSetHeader } from "mysql2";

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
// GET ALL CLIENTS
// ============================================
export const getClients = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { search, status } = req.query;

    let query = `
      SELECT 
        c.*,
        u.name as assigned_to_name,
        u2.name as created_by_name,
        l.company_name as lead_company
      FROM clients c
      LEFT JOIN tbl_users u ON u.id = c.assigned_to
      LEFT JOIN tbl_users u2 ON u2.id = c.created_by
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.status = 'Y'
    `;

    const params: any[] = [];

    if (search) {
      query += ` AND (c.company_name LIKE ? OR c.contact_person LIKE ? OR c.email LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      query += ` AND c.project_status = ?`;
      params.push(status);
    }

    query += ` ORDER BY c.created_at DESC`;

    const [rows] = await pool.query<RowDataPacket[]>(query, params);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ message: "Failed to fetch clients" });
  }
};

// ============================================
// GET SINGLE CLIENT
// ============================================
export const getClientById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        c.*,
        u.name as assigned_to_name,
        u2.name as created_by_name,
        l.company_name as lead_company
      FROM clients c
      LEFT JOIN tbl_users u ON u.id = c.assigned_to
      LEFT JOIN tbl_users u2 ON u2.id = c.created_by
      LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = ? AND c.status = 'Y'
      `,
      [id]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Client not found" });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching client:", error);
    res.status(500).json({ message: "Failed to fetch client" });
  }
};

// ============================================
// CONVERT LEAD TO CLIENT
// ============================================
export const convertLeadToClient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { leadId } = req.params;
    const {
      company_name,
      contact_person,
      contact_numbers,
      email,
      country,
      purchased_product,
      project_status,
      last_communication_date,
      next_follow_up_date,
      renewal_reminder_date,
      comments,
      assigned_to,
    } = req.body;

    // Get lead data
    const [lead] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM leads WHERE id = ? AND status = 'Y'",
      [leadId]
    );

    if (lead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    // Check if lead already converted
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM clients WHERE lead_id = ? AND status = 'Y'",
      [leadId]
    );

    if (existing.length > 0) {
      res.status(400).json({ message: "This lead has already been converted to a client" });
      return;
    }

    // Insert client
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (
        company_name, contact_person, contact_numbers, email, country,
        purchased_product, project_status, last_communication_date,
        next_follow_up_date, renewal_reminder_date, comments,
        lead_id, assigned_to, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_name || lead[0].company_name,
        contact_person || lead[0].contact_person,
        contact_numbers || lead[0].mobile_number,
        email || lead[0].email,
        country || lead[0].country,
        purchased_product || lead[0].product_interest,
        project_status || "Active",
        last_communication_date || null,
        next_follow_up_date || null,
        renewal_reminder_date || null,
        comments || `Converted from lead: ${lead[0].company_name}`,
        leadId,
        assigned_to || lead[0].assigned_to || null,
        req.user.id,
      ]
    );

    const clientId = (result as any).insertId;

    // Update lead status to Won
    await pool.query(
      "UPDATE leads SET lead_status = 'Won' WHERE id = ?",
      [leadId]
    );

    // Log activity
    await logActivity(
      req.user.id,
      "CONVERT",
      "CLIENT",
      clientId,
      null,
      { lead_id: leadId, company_name: company_name || lead[0].company_name },
      `Lead converted to client: ${company_name || lead[0].company_name}`
    );

    res.status(201).json({
      message: "Lead converted to client successfully",
      id: clientId,
    });
  } catch (error) {
    console.error("Error converting lead to client:", error);
    res.status(500).json({ message: "Failed to convert lead to client" });
  }
};

// ============================================
// CREATE CLIENT
// ============================================
export const createClient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const {
      company_name,
      contact_person,
      contact_numbers,
      email,
      country,
      purchased_product,
      project_status,
      last_communication_date,
      next_follow_up_date,
      renewal_reminder_date,
      comments,
      assigned_to,
    } = req.body;

    // Validation
    if (!company_name || !contact_person) {
      res.status(400).json({
        message: "Company Name and Contact Person are required",
      });
      return;
    }

    // Check if client already exists
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM clients WHERE company_name = ? AND status = 'Y'",
      [company_name]
    );

    if (existing.length > 0) {
      res.status(400).json({ message: "Client with this company name already exists" });
      return;
    }

    // Insert client
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO clients (
        company_name, contact_person, contact_numbers, email, country,
        purchased_product, project_status, last_communication_date,
        next_follow_up_date, renewal_reminder_date, comments,
        assigned_to, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_name,
        contact_person,
        contact_numbers || null,
        email || null,
        country || null,
        purchased_product || null,
        project_status || "Active",
        last_communication_date || null,
        next_follow_up_date || null,
        renewal_reminder_date || null,
        comments || null,
        assigned_to || null,
        req.user.id,
      ]
    );

    const clientId = (result as any).insertId;

    // Log activity
    await logActivity(
      req.user.id,
      "CREATE",
      "CLIENT",
      clientId,
      null,
      req.body,
      `New client created: ${company_name}`
    );

    res.status(201).json({
      message: "Client created successfully",
      id: clientId,
    });
  } catch (error) {
    console.error("Error creating client:", error);
    res.status(500).json({ message: "Failed to create client" });
  }
};

// ============================================
// UPDATE CLIENT
// ============================================
export const updateClient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const {
      company_name,
      contact_person,
      contact_numbers,
      email,
      country,
      purchased_product,
      project_status,
      last_communication_date,
      next_follow_up_date,
      renewal_reminder_date,
      comments,
      assigned_to,
    } = req.body;

    // Get current client data
    const [currentClient] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM clients WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (currentClient.length === 0) {
      res.status(404).json({ message: "Client not found" });
      return;
    }

    const oldData = currentClient[0];

    // Build update query dynamically
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
    addField('contact_numbers', contact_numbers);
    addField('email', email);
    addField('country', country);
    addField('purchased_product', purchased_product);
    addField('project_status', project_status);
    addField('last_communication_date', last_communication_date);
    addField('next_follow_up_date', next_follow_up_date);
    addField('renewal_reminder_date', renewal_reminder_date);
    addField('comments', comments);
    addField('assigned_to', assigned_to);

    if (updateFields.length === 0) {
      res.json({ message: "No fields to update" });
      return;
    }

    updateValues.push(id);
    const query = `UPDATE clients SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, updateValues);

    // Log activity
    await logActivity(
      req.user.id,
      "UPDATE",
      "CLIENT",
      parseInt(id),
      oldData,
      req.body,
      `Client updated: ${company_name || oldData.company_name}`
    );

    res.json({ message: "Client updated successfully" });
  } catch (error) {
    console.error("Error updating client:", error);
    res.status(500).json({ message: "Failed to update client" });
  }
};

// ============================================
// DELETE CLIENT
// ============================================
export const deleteClient = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { id } = req.params;

    const [client] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM clients WHERE id = ? AND status = 'Y'",
      [id]
    );

    if (client.length === 0) {
      res.status(404).json({ message: "Client not found" });
      return;
    }

    await pool.query("UPDATE clients SET status = 'N' WHERE id = ?", [id]);

    await logActivity(
      req.user.id,
      "DELETE",
      "CLIENT",
      parseInt(id),
      client[0],
      null,
      `Client deleted: ${client[0].company_name}`
    );

    res.json({ message: "Client deleted successfully" });
  } catch (error) {
    console.error("Error deleting client:", error);
    res.status(500).json({ message: "Failed to delete client" });
  }
};

// ============================================
// GET CLIENT STATS
// ============================================
export const getClientStats = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const [total] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as total FROM clients WHERE status = 'Y'"
    );

    const [statusCounts] = await pool.query<RowDataPacket[]>(
      `
      SELECT project_status, COUNT(*) as count 
      FROM clients 
      WHERE status = 'Y' 
      GROUP BY project_status
      `
    );

    res.json({
      total: total[0].total,
      byStatus: statusCounts,
    });
  } catch (error) {
    console.error("Error fetching client stats:", error);
    res.status(500).json({ message: "Failed to fetch client stats" });
  }
};