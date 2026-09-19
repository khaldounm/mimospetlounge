import { z } from "zod";
import { optionalString, optionalDate } from "./common";
import { PATIENT_SEXES } from "@/types/enums";

export const patientCreateSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required").max(100),
  species: optionalString(50),
  breed: optionalString(100),
  dateOfBirth: optionalDate,
  sex: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(PATIENT_SEXES).optional(),
  ),
  isNeutered: z.coerce.boolean().default(false),
  microchipId: optionalString(50),
  notes: optionalString(5000),
});

// clientId can't be reassigned on update; everything else is optional.
export const patientUpdateSchema = patientCreateSchema
  .omit({ clientId: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update",
  });

// Ticking a pet off the upcoming-birthdays list, or undoing that. A strict
// boolean: coercion would read "false" as true.
export const birthdaySeenSchema = z.object({
  seen: z.boolean(),
});

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;
