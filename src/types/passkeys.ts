// A passkey as the account page lists it. Nothing here can be used to sign in:
// the public key stays server-side and the private key never left the phone.
export interface PasskeyDTO {
  id: string;
  // Provider name derived from the authenticator ("iCloud Keychain").
  label: string;
  // Whether the authenticator reports the passkey as synced to a cloud
  // account, which is what makes it survive a lost phone.
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}
