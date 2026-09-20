"use client";

// The browser half of a passkey ceremony, kept out of the components so they
// only render phases. Two flows: sign in (options, browser prompt, hand the
// assertion to Auth.js) and add-to-my-account (options, browser prompt, hand
// the attestation to our route). Both narrate themselves through `phase`.

import { useCallback, useState, useSyncExternalStore } from "react";
import { signIn } from "next-auth/react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiRequest } from "@/utils/api-client";
import { PASSKEY_PROVIDER_ID } from "@/constants/passkeys";
import type { PasskeyDTO } from "@/types/passkeys";

// idle: nothing happening. waiting: the browser's prompt is up and the person
// is on their phone or key. verifying: we have the response and the server is
// checking it. done: over, and the caller is about to move on.
export type PasskeyPhase = "idle" | "waiting" | "verifying" | "done";

// Whether this browser can do passkeys at all. Null on the server render and
// during hydration, because the answer needs `window`; a store read rather
// than an effect so the first client render already knows.
const noSubscribe = () => () => {};
export function usePasskeySupport(): boolean | null {
  return useSyncExternalStore(
    noSubscribe,
    () => browserSupportsWebAuthn(),
    () => null,
  );
}

// Closing the browser's prompt is a decision, not a failure, and gets no red
// text. The library reports it as an abort or wraps the DOM NotAllowedError.
function wasCancelled(err: unknown): boolean {
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_CEREMONY_ABORTED") return true;
    return err.cause instanceof Error && err.cause.name === "NotAllowedError";
  }
  return err instanceof Error && err.name === "NotAllowedError";
}

function describe(err: unknown, fallback: string): string {
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return "That passkey is already on your account.";
    }
    return fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

export function usePasskeySignIn() {
  const [phase, setPhase] = useState<PasskeyPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Resolves true once Auth.js has set the session cookie. The caller decides
  // where to go next.
  const signInWithPasskey = useCallback(async (): Promise<boolean> => {
    setError(null);
    // "waiting" from the first click, not from the options response: a second
    // click during that round trip would mint a second challenge and the
    // cookie would no longer match the ceremony already under way.
    setPhase("waiting");
    try {
      const options = await apiRequest<PublicKeyCredentialRequestOptionsJSON>(
        "/api/auth/passkey/options",
        { method: "POST" },
      );
      const assertion = await startAuthentication({ optionsJSON: options });
      setPhase("verifying");

      const result = await signIn(PASSKEY_PROVIDER_ID, {
        response: JSON.stringify(assertion),
        redirect: false,
      });
      if (result?.error) {
        setError("That passkey was not accepted. Try again.");
        setPhase("idle");
        return false;
      }
      setPhase("done");
      return true;
    } catch (err) {
      setPhase("idle");
      if (!wasCancelled(err)) {
        setError(describe(err, "Could not sign in with that passkey."));
      }
      return false;
    }
  }, []);

  return { phase, error, signInWithPasskey };
}

export function usePasskeyRegistration() {
  const [phase, setPhase] = useState<PasskeyPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Resolves with the stored passkey, or null when cancelled or refused.
  const register = useCallback(async (): Promise<PasskeyDTO | null> => {
    setError(null);
    setPhase("waiting");
    try {
      const options = await apiRequest<PublicKeyCredentialCreationOptionsJSON>(
        "/api/account/passkeys/options",
        { method: "POST" },
      );
      const response = await startRegistration({ optionsJSON: options });
      setPhase("verifying");

      const { passkey } = await apiRequest<{ passkey: PasskeyDTO }>(
        "/api/account/passkeys",
        { method: "POST", body: { response } },
      );
      // No "done" phase here: the new row appearing in the list is the
      // confirmation, so the button simply comes back.
      return passkey;
    } catch (err) {
      if (!wasCancelled(err)) {
        setError(describe(err, "Could not add that passkey."));
      }
      return null;
    } finally {
      setPhase("idle");
    }
  }, []);

  return { phase, error, register };
}
