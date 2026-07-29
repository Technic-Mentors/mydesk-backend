import { Request, Response } from "express";
import pool from "../database/db";
import { AuthenticatedRequest } from "../middleware/middleware";
import { RowDataPacket } from "mysql2";
import { addCrmActivity } from "./crm/activity.controller";

interface CustomerBody {
  customerName: string;
  customerAddress: string;
  customerContact: string;
  email: string;
  companyName: string;
  companyAddress: string;
}

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
// GET ALL CUSTOMERS (Enhanced with lead info)
// ============================================
export const getAllCustomers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        c.*,
        l.company_name as lead_company,
        l.lead_status as lead_status,
        u.name as assigned_to_name
       FROM customers c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN tbl_users u ON u.id = c.assigned_to
       WHERE c.customerStatus = 'Y' 
       ORDER BY c.id DESC`
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch customers" });
  }
};

// ============================================
// GET SINGLE CUSTOMER (Enhanced with lead info)
// ============================================
export const getSingleCustomer = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const customerId = req.params.id;

    const [rows]: any = await pool.query(
      `SELECT 
        c.*,
        l.company_name as lead_company,
        l.lead_status as lead_status,
        u.name as assigned_to_name
       FROM customers c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN tbl_users u ON u.id = c.assigned_to
       WHERE c.id = ? AND c.customerStatus = 'Y'`,
      [customerId]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch customer" });
  }
};

// ============================================
// ADD CUSTOMER
// ============================================
export const addCustomer = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      customerName,
      customerAddress,
      customerContact,
      email,
      companyName,
      companyAddress,
      lead_id,
      assigned_to,
      project_status,
      purchased_product,
    } = req.body;

    if (!customerName || !customerAddress || !email || !customerContact) {
      res.status(400).json({
        message: "Name, email, address and contact are required",
      });
      return;
    }

    const [contactExists]: any = await pool.query(
      `SELECT id 
       FROM customers 
       WHERE customerContact = ?
       AND customerStatus = 'Y'`,
      [customerContact],
    );

    if (contactExists.length > 0) {
      res.status(409).json({
        message: "Customer contact number already exists",
      });
      return;
    }

    if (lead_id) {
      const [existing]: any = await pool.query(
        `SELECT id FROM customers WHERE lead_id = ? AND customerStatus = 'Y'`,
        [lead_id]
      );

      if (existing.length > 0) {
        res.status(400).json({ message: "This lead has already been converted" });
        return;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO customers 
        (customerName, customerAddress, customerContact, email, companyName, companyAddress,
         lead_id, assigned_to, project_status, purchased_product, converted_from_lead, conversion_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerName,
        customerAddress,
        customerContact,
        email,
        companyName,
        companyAddress || '',
        lead_id || null,
        assigned_to || null,
        project_status || 'Active',
        purchased_product || null,
        lead_id ? 1 : 0,
        lead_id ? new Date().toISOString().split('T')[0] : null,
      ],
    );

    const customerId = (result as any).insertId;

    if (lead_id) {
      await pool.query(
        `UPDATE leads SET lead_status = 'Won' WHERE id = ?`,
        [lead_id]
      );

      await pool.query(
        `INSERT INTO lead_history 
         (lead_id, action_type, old_value, new_value, changed_by, comments) 
         VALUES (?, 'converted', ?, 'Won', ?, ?)`,
        [
          lead_id,
          'New',
          (req as any).user?.id || 1,
          `Lead converted to customer: ${customerName}`,
        ]
      );
    }

    await logActivity(
      (req as any).user?.id || 1,
      "CREATE",
      "CUSTOMER",
      customerId,
      null,
      req.body,
      `New customer created: ${companyName || customerName}`
    );

    // ============================================
    // ✅ AUTO-LOGGING TO CRM ACTIVITIES
    // ============================================

    await addCrmActivity(
      'customer',
      customerId,
      'Note',
      `Customer created: ${companyName || customerName}`,
      `New customer added${lead_id ? ' (converted from lead)' : ''}`,
      new Date().toISOString().split('T')[0],
      new Date().toTimeString().slice(0, 5),
      (req as any).user?.id || 1
    );

    // If created from lead, also log lead activity
    if (lead_id) {
      await addCrmActivity(
        'lead',
        lead_id,
        'Note',
        `Lead converted to customer: ${companyName || customerName}`,
        `Lead manually converted to customer`,
        new Date().toISOString().split('T')[0],
        new Date().toTimeString().slice(0, 5),
        (req as any).user?.id || 1
      );
    }

    // ✅ END OF AUTO-LOGGING

    res.status(201).json({ 
      message: "Customer added successfully",
      id: customerId 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add customer" });
  }
};

// ============================================
// UPDATE CUSTOMER
// ============================================
export const updateCustomer = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const customerId = req.params.id;

    const {
      customerName,
      customerAddress,
      customerContact,
      email,
      companyName,
      companyAddress,
      project_status,
      purchased_product,
      assigned_to,
      last_communication_date,
      next_follow_up_date,
      renewal_reminder_date,
    } = req.body;

    if (!customerName || !customerAddress || !email || !customerContact) {
      res.status(400).json({
        message: "Name, email, address, and contact are required",
      });
      return;
    }

    const [contactExists]: any = await pool.query(
      `SELECT id 
       FROM customers 
       WHERE customerContact = ?
       AND id != ? 
       AND customerStatus = 'Y'`,
      [customerContact, customerId]
    );

    if (contactExists.length > 0) {
      res.status(409).json({
        message: "Customer contact number already exists",
      });
      return;
    }

    const updateFields: string[] = [];
    const updateValues: any[] = [];

    const addField = (field: string, value: any) => {
      if (value !== undefined && value !== null && value !== "") {
        updateFields.push(`${field} = ?`);
        updateValues.push(value);
      }
    };

    addField('customerName', customerName);
    addField('customerAddress', customerAddress);
    addField('customerContact', customerContact);
    addField('email', email);
    addField('companyName', companyName);
    addField('companyAddress', companyAddress);
    addField('project_status', project_status);
    addField('purchased_product', purchased_product);
    addField('assigned_to', assigned_to);
    addField('last_communication_date', last_communication_date);
    addField('next_follow_up_date', next_follow_up_date);
    addField('renewal_reminder_date', renewal_reminder_date);

    if (updateFields.length === 0) {
      res.json({ message: "No fields to update" });
      return;
    }

    updateValues.push(customerId);
    const query = `UPDATE customers SET ${updateFields.join(', ')} WHERE id = ?`;
    await pool.query(query, updateValues);

    await logActivity(
      (req as any).user?.id || 1,
      "UPDATE",
      "CUSTOMER",
      parseInt(customerId),
      null,
      req.body,
      `Customer updated: ${companyName || customerName}`
    );

    // ============================================
    // ✅ AUTO-LOGGING TO CRM ACTIVITIES
    // ============================================

    await addCrmActivity(
      'customer',
      parseInt(customerId),
      'Note',
      `Customer updated: ${companyName || customerName}`,
      `Customer details were updated`,
      new Date().toISOString().split('T')[0],
      new Date().toTimeString().slice(0, 5),
      (req as any).user?.id || 1
    );

    // ✅ END OF AUTO-LOGGING

    res.status(200).json({ message: "Customer updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update customer" });
  }
};

// ============================================
// DELETE CUSTOMER
// ============================================
export const deleteCustomer = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const customerId = req.params.id;

    const [customer]: any = await pool.query(
      `SELECT * FROM customers WHERE id = ? AND customerStatus = 'Y'`,
      [customerId]
    );

    if (customer.length === 0) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    await pool.query("UPDATE customers SET customerStatus = 'N' WHERE id = ?", [
      customerId,
    ]);

    await logActivity(
      (req as any).user?.id || 1,
      "DELETE",
      "CUSTOMER",
      parseInt(customerId),
      customer[0],
      null,
      `Customer deleted: ${customer[0].companyName || customer[0].customerName}`
    );

    res.status(200).json({ message: "Customer deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to delete customer" });
  }
};

// ============================================
// CONVERT LEAD TO CUSTOMER
// ============================================
export const convertLeadToCustomer = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { leadId } = req.params;
    const {
      customerName,
      email,
      customerContact,
      companyName,
      customerAddress,
      purchased_product,
      project_status,
      assigned_to,
    } = req.body;

    const [lead]: any = await pool.query(
      `SELECT * FROM leads WHERE id = ? AND status = 'Y'`,
      [leadId]
    );

    if (lead.length === 0) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    const leadData = lead[0];

    const [existing]: any = await pool.query(
      `SELECT id FROM customers WHERE lead_id = ? AND customerStatus = 'Y'`,
      [leadId]
    );

    if (existing.length > 0) {
      res.status(400).json({ message: "This lead has already been converted to a customer" });
      return;
    }

    const [result] = await pool.query(
      `INSERT INTO customers (
        customerName, email, customerContact, companyName, customerAddress,
        companyAddress, lead_id, assigned_to, project_status, purchased_product,
        converted_from_lead, conversion_date, customerStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y')`,
      [
        customerName || leadData.contact_person,
        email || leadData.email,
        customerContact || leadData.mobile_number,
        companyName || leadData.company_name,
        customerAddress || leadData.address || '',
        leadData.company_address || leadData.address || '',
        leadId,
        assigned_to || leadData.assigned_to || null,
        project_status || 'Active',
        purchased_product || leadData.product_interest || null,
        1,
        new Date().toISOString().split('T')[0],
      ]
    );

    const customerId = (result as any).insertId;

    await pool.query(
      `UPDATE leads SET lead_status = 'Won' WHERE id = ?`,
      [leadId]
    );

    await pool.query(
      `INSERT INTO lead_history 
       (lead_id, action_type, old_value, new_value, changed_by, comments) 
       VALUES (?, 'converted', ?, 'Won', ?, ?)`,
      [
        leadId,
        leadData.lead_status || 'New',
        req.user.id,
        `Lead converted to customer: ${customerName || leadData.contact_person}`,
      ]
    );

    await logActivity(
      req.user.id,
      "CONVERT",
      "CUSTOMER",
      customerId,
      null,
      { lead_id: leadId, company_name: companyName || leadData.company_name },
      `Lead converted to customer: ${companyName || leadData.company_name}`
    );

    // ============================================
    // ✅ AUTO-LOGGING TO CRM ACTIVITIES
    // ============================================

    // Log customer activity
    await addCrmActivity(
      'customer',
      customerId,
      'Note',
      `Lead converted to customer: ${companyName || leadData.company_name}`,
      `Converted from lead #${leadId}: ${leadData.company_name}`,
      new Date().toISOString().split('T')[0],
      new Date().toTimeString().slice(0, 5),
      req.user.id
    );

    // Log lead activity
    await addCrmActivity(
      'lead',
      parseInt(leadId),
      'Note',
      `Lead converted to customer: ${companyName || leadData.company_name}`,
      `Lead converted to customer`,
      new Date().toISOString().split('T')[0],
      new Date().toTimeString().slice(0, 5),
      req.user.id
    );

    // Log status change on lead
    await addCrmActivity(
      'lead',
      parseInt(leadId),
      'Status Change',
      `Lead status changed to Won (converted)`,
      `Lead converted to customer`,
      new Date().toISOString().split('T')[0],
      new Date().toTimeString().slice(0, 5),
      req.user.id
    );

    // ✅ END OF AUTO-LOGGING

    res.status(201).json({
      message: "Lead converted to customer successfully",
      id: customerId,
      customer_id: customerId,
    });
  } catch (error) {
    console.error("Error converting lead to customer:", error);
    res.status(500).json({ message: "Failed to convert lead to customer" });
  }
};

// ============================================
// GET CUSTOMER BY LEAD ID
// ============================================
export const getCustomerByLeadId = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { leadId } = req.params;

    const [rows]: any = await pool.query(
      `SELECT c.*, u.name as assigned_to_name
       FROM customers c
       LEFT JOIN tbl_users u ON u.id = c.assigned_to
       WHERE c.lead_id = ? AND c.customerStatus = 'Y'`,
      [leadId]
    );

    if (rows.length === 0) {
      res.status(404).json({ message: "No customer found for this lead" });
      return;
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching customer by lead:", error);
    res.status(500).json({ message: "Failed to fetch customer" });
  }
};

// ============================================
// CONVERT ALL WON LEADS TO CUSTOMERS
// ============================================
export const convertAllWonLeads = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const [wonLeads] = await pool.query<RowDataPacket[]>(
      `SELECT l.* 
       FROM leads l
       LEFT JOIN customers c ON c.lead_id = l.id AND c.customerStatus = 'Y'
       WHERE l.lead_status = 'Won' 
         AND l.status = 'Y' 
         AND c.id IS NULL`
    );

    if ((wonLeads as any[]).length === 0) {
      res.json({
        message: "No Won leads found to convert",
        converted: 0,
      });
      return;
    }

    let convertedCount = 0;

    for (const lead of wonLeads as any[]) {
      const [result] = await pool.query(
        `INSERT INTO customers (
          customerName, email, customerContact, companyName, customerAddress,
          companyAddress, lead_id, assigned_to, project_status, purchased_product,
          converted_from_lead, conversion_date, customerStatus
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Y')`,
        [
          lead.contact_person || '',
          lead.email || '',
          lead.mobile_number || '',
          lead.company_name || '',
          lead.address || '',
          '',
          lead.id,
          lead.assigned_to || null,
          'Active',
          lead.product_interest || null,
          1,
          new Date().toISOString().split('T')[0],
        ]
      );

      await pool.query(
        `INSERT INTO lead_history 
         (lead_id, action_type, old_value, new_value, changed_by, comments) 
         VALUES (?, 'auto_converted', ?, 'Won', ?, ?)`,
        [
          lead.id,
          lead.lead_status || 'New',
          req.user.id,
          `Lead auto-converted to customer via bulk conversion`,
        ]
      );

      convertedCount++;
    }

    await logActivity(
      req.user.id,
      "BULK_CONVERT",
      "CUSTOMER",
      0,
      null,
      { count: convertedCount },
      `Bulk converted ${convertedCount} Won leads to customers`
    );

    // ============================================
    // ✅ AUTO-LOGGING TO CRM ACTIVITIES
    // ============================================

    // Log each conversion to crm_activities
    for (const lead of wonLeads as any[]) {
      // Get the newly created customer for this lead
      const [customer] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM customers WHERE lead_id = ? AND customerStatus = 'Y'`,
        [lead.id]
      );

      if (customer.length > 0) {
        await addCrmActivity(
          'customer',
          customer[0].id,
          'Note',
          `Lead converted to customer: ${lead.company_name}`,
          `Bulk converted from lead #${lead.id}`,
          new Date().toISOString().split('T')[0],
          new Date().toTimeString().slice(0, 5),
          req.user.id
        );

        await addCrmActivity(
          'lead',
          lead.id,
          'Status Change',
          `Lead status changed to Won (bulk converted)`,
          `Lead bulk converted to customer`,
          new Date().toISOString().split('T')[0],
          new Date().toTimeString().slice(0, 5),
          req.user.id
        );
      }
    }

    // ✅ END OF AUTO-LOGGING

    res.json({
      message: `Successfully converted ${convertedCount} Won leads to customers`,
      converted: convertedCount,
    });
  } catch (error) {
    console.error("Error converting Won leads:", error);
    res.status(500).json({ message: "Failed to convert Won leads" });
  }
};

// ============================================
// GET CUSTOMER STATS
// ============================================
export const getCustomerStats = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const [totalRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM customers WHERE customerStatus = 'Y'`
    );

    const [convertedRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as converted FROM customers WHERE converted_from_lead = 1 AND customerStatus = 'Y'`
    );

    const [directRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as direct FROM customers WHERE converted_from_lead = 0 AND customerStatus = 'Y'`
    );

    const [statusCounts] = await pool.query<RowDataPacket[]>(
      `
      SELECT project_status, COUNT(*) as count 
      FROM customers 
      WHERE customerStatus = 'Y' 
      GROUP BY project_status
      `
    );

    res.json({
      total: Number(totalRows[0]?.total ?? 0),
      converted: Number(convertedRows[0]?.converted ?? 0),
      direct: Number(directRows[0]?.direct ?? 0),
      byStatus: statusCounts,
    });
  } catch (error) {
    console.error("Error fetching customer stats:", error);
    res.status(500).json({ message: "Failed to fetch customer stats" });
  }
};