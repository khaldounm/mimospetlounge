import { z } from "zod";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

// The credential the browser hands back from navigator.credentials.create() /
// get(), as @simplewebauthn/browser serialises it. Only the outer shape is
// checked here: the library verifies the bytes inside (signature, challenge,
// origin, flags), and a body that fails that check is a 400 either way. What
// this rules out is a body that is not a WebAuthn response at all.
const base64url = z.string().min(1).max(4096);

const credentialResponse = z.looseObject({
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  response: z.looseObject({
    clientDataJSON: base64url,
  }),
  clientExtensionResults: z.looseObject({}).default({}),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
});

export const registrationResponseSchema = credentialResponse.extend({
  response: z.looseObject({
    clientDataJSON: base64url,
    attestationObject: base64url,
  }),
}) as unknown as z.ZodType<RegistrationResponseJSON>;

export const authenticationResponseSchema = credentialResponse.extend({
  response: z.looseObject({
    clientDataJSON: base64url,
    authenticatorData: base64url,
    signature: base64url,
  }),
}) as unknown as z.ZodType<AuthenticationResponseJSON>;

// POST /api/account/passkeys
export const passkeyRegistrationBody = z.object({
  response: registrationResponseSchema,
});
