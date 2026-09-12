// How much audit history the Delete logs button in Settings keeps. Everything
// older than this goes. Deliberately not a scheduled job: audit entries are what
// answers "who changed this invoice", so removing them is a decision someone
// takes deliberately rather than something that happens overnight.
export const AUDIT_RETENTION_DAYS = 30;

// Audit action verbs recorded in audit_log.action (VarChar(20)). Kept short.
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "issue",
  "void",
  "payment",
  "stock",
  "send",
  "cancel",
  // Goods given back against an earlier sale. Distinct from "void", which
  // cancels a document, and from "update", which is someone editing a draft.
  "return",
  // The day's drawer counted and filed. Its own action rather than "create",
  // because re-closing a day replaces the count and both times are a close.
  "close",
  // An offer handed to a client. Its own verb rather than "create", because the
  // question being asked of the log later is "who gave this discount away", and
  // that reads badly as a row saying someone created something.
  "grant",
  // An offer spent against an invoice. Paired with "grant" so the log tells the
  // whole story: given on this date by this person, used on that invoice.
  "redeem",
  // Every device a person was signed in on, ended by an admin. Its own verb
  // rather than "update", because "who threw this person off the till" is a
  // question someone asks of the log later and it should read as an answer.
  "signout",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Entity names recorded in audit_log.entity (VarChar(50)). Mirror table names so
// entity + entityId can be traced straight back to a row.
export const AUDIT_ENTITIES = [
  "client",
  "patient",
  "clinical_record",
  "booking",
  "inventory_item",
  "inventory_transaction",
  "service",
  "invoice",
  "invoice_line_item",
  "payment",
  "notification",
  "notification_template",
  "reminder",
  "user",
  "running_cost",
  "partner",
  "partner_payout",
  "partner_day",
  "supplier",
  "supplier_payment",
  "purchase_order",
  "purchase_order_line",
  "contact_message",
  "setting",
  // A role's permission grants, changed from the matrix in Settings. entityId is
  // the role, and the payload names the permission that moved.
  "role",
  "register_closing",
  // The audit log recording its own pruning. The row survives the delete it
  // describes, because it is written afterwards.
  "audit_log",
  // The deal itself, in the catalogue.
  "offer",
  // One client holding one offer. entityId is the grant, and the payload names
  // the client and the offer, because a grant id means nothing on its own.
  "offer_grant",
  // A booking type's default reminder template, set from the Templates tab.
  // entityId is the type, and the payload names the template it now points at.
  "booking_type",
] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

// Human-readable labels for the audit viewer filters / table.
export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  client: "Client",
  patient: "Patient",
  clinical_record: "Clinical record",
  booking: "Booking",
  inventory_item: "Inventory item",
  inventory_transaction: "Stock movement",
  service: "Service",
  invoice: "Invoice",
  invoice_line_item: "Invoice line",
  payment: "Payment",
  notification: "Notification",
  notification_template: "Template",
  reminder: "Recall reminder",
  user: "User",
  running_cost: "Running cost",
  partner: "Partner",
  partner_payout: "Partner payout",
  partner_day: "Partner day",
  supplier: "Supplier",
  supplier_payment: "Supplier payment",
  purchase_order: "Purchase order",
  purchase_order_line: "Purchase order line",
  contact_message: "Website message",
  setting: "Clinic setting",
  role: "Role permissions",
  register_closing: "Register close",
  audit_log: "Audit log",
  offer: "Offer",
  offer_grant: "Offer given",
  booking_type: "Booking type",
};

// MUI Chip colors per action for the viewer.
export const AUDIT_ACTION_COLOR: Record<
  AuditAction,
  "default" | "info" | "warning" | "success" | "error"
> = {
  create: "success",
  update: "info",
  delete: "error",
  issue: "success",
  void: "error",
  payment: "success",
  stock: "info",
  send: "info",
  cancel: "warning",
  return: "warning",
  close: "info",
  grant: "success",
  redeem: "success",
  signout: "warning",
};
