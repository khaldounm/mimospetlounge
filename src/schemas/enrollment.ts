import { z } from "zod";
import { registrationResponseSchema } from "./passkey";
import { ENROLLMENT_TOKEN_PATTERN } from "@/lib/enrollment";

// POST /api/users/[userId]/enroll: how the admin wants the link delivered.
export const enrollIssueSchema = z.object({
  channel: z.enum(["whatsapp", "link"]),
});

const token = z.string().regex(ENROLLMENT_TOKEN_PATTERN, "Invalid link");

// POST /api/enroll/options
export const enrollOptionsSchema = z.object({ token });

// POST /api/enroll
export const enrollVerifySchema = z.object({
  token,
  response: registrationResponseSchema,
});

export type EnrollIssueInput = z.infer<typeof enrollIssueSchema>;
