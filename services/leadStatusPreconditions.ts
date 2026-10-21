const leadStatuses = new Set([
  "New", "Contact Attempted", "Contacted", "Requirement Gathering",
  "Meeting Scheduled", "Proposal Sent", "Negotiation", "Won", "Lost", "On Hold",
]);

export function leadStatusPrecondition(lead: Record<string, unknown>, nextStatus: unknown): string | null {
  if (typeof nextStatus !== "string" || !leadStatuses.has(nextStatus))
    return "Select a valid lead status";
  if (!String(lead.company_name || "").trim()) return "Company Name is required before changing status";
  if (!String(lead.contact_person || "").trim()) return "Contact Person is required before changing status";
  if (String(lead.mobile_number || "").replace(/[^0-9]/g, "").length < 10)
    return "A valid Mobile Number is required before changing status";
  const email = String(lead.email || "").trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return "Lead email address is invalid";
  if (lead.probability !== null && lead.probability !== undefined && lead.probability !== "") {
    const probability = Number(lead.probability);
    if (!Number.isFinite(probability) || probability < 0 || probability > 100)
      return "Probability must be between 0 and 100";
  }
  return null;
}
