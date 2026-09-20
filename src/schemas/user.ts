import { z } from "zod";
import { optionalString } from "./common";

// Minimum password strength, wherever one can still be set: someone changing
// their own, or an admin setting one at a clinic that keeps passwords on
// (CLINIC.passkeyOnly false). New accounts never get one here; they get an
// enrollment link and a passkey (see lib/enrollment.ts).
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72);

// An admin setting someone's password from the staff list.
export const passwordSetSchema = z.object({ password });

export const userCreateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  email: z.email("Invalid email").max(255),
  phone: optionalString(20),
  roleId: z.coerce.number().int().positive("Role is required"),
});

// All fields optional on update; password is handled by its own endpoint.
export const userUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.email("Invalid email").max(255),
    phone: optionalString(20),
    roleId: z.coerce.number().int().positive(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

// Someone changing their OWN password. The current one is proof of identity, so
// it is required but deliberately not held to the strength rules: it was set
// under whatever rules applied at the time, and rejecting it here would lock out
// exactly the person we are trying to let re-key.
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(72),
  newPassword: password,
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type PasswordSetInput = z.infer<typeof passwordSetSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
