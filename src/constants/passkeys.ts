// Passkey (WebAuthn) settings shared by sign-in, the account page and, later,
// enrollment links.

// Id of the Auth.js Credentials provider that verifies a passkey assertion.
// The login page passes it to signIn(); lib/auth.ts registers it.
export const PASSKEY_PROVIDER_ID = "passkey";

// Sign-in result code for "that passkey is not on the account any more". The
// login page answers it by telling the browser to drop the credential.
export const PASSKEY_UNKNOWN_CODE = "unknown_passkey";

// The cookie that carries a signed challenge from the options call to the
// verification that follows it. httpOnly so nothing in the page can read it,
// and short because a challenge is good for exactly one ceremony.
export const PASSKEY_CHALLENGE_COOKIE = "passkey-challenge";
export const PASSKEY_CHALLENGE_TTL_SECONDS = 120;

// Enrollment links: how long one stays valid after an admin issues it. Long
// enough to find the phone and open WhatsApp, short enough that a link left
// in a chat is dead by the time anyone else reads it.
export const ENROLLMENT_LINK_TTL_MINUTES = 15;

// How long the browser waits for the person to finish with their phone or key
// before giving up on a ceremony.
export const PASSKEY_CEREMONY_TIMEOUT_MS = 60_000;

// Provider names by authenticator AAGUID, so a passkey is listed as "iCloud
// Keychain" rather than a hex id. Taken from the community list at
// github.com/passkeydeveloper/passkey-authenticator-aaguids. Unknown ids fall
// back to a generic label; see labelFor() in lib/passkeys.ts.
export const PASSKEY_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud Keychain",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud Keychain (managed)",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome on Mac",
  "771b48fd-d3d4-4f74-9232-fc157ab0507a": "Edge on Mac",
  "b5397666-4885-aa6b-cebf-e52262a439a2": "Chromium browser",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "f3809540-7f14-49c1-a8b3-8f813b225541": "Enpass",
  "fdb141b2-5d84-443e-8a35-4698c205a502": "KeePassXC",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "bfc748bb-3429-4faa-b9f9-7cfa9f3b76d0": "iPasswords",
  "39a5647e-1853-446c-a1f6-a79bae9f5bc7": "IDmelon",
};
