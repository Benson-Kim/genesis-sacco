import { z } from "zod";

/** Zod-validated response boundary (MASTER_PROMPT §2.3). */
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const OTP_LENGTH = 6;

export const otpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, "Enter all 6 digits");

export const emailSchema = z.string().min(3).max(254);

/**
 * /auth/otp/request response boundary. `dev_otp` appears ONLY when the
 * server's fail-closed dev_otp_display flag is on (#35 item 11 —
 * dev-mode tester affordance, REMOVE before staging).
 */
export const otpRequestResponseSchema = z.object({
  status: z.string(),
  dev_otp: z.string().optional(),
});

/**
 * Sign-in identifier blur mirror (#35 item 1): staff sign in with an
 * EMAIL (OtpRequestBody, api/auth.py); the blur check is a courtesy
 * mirror — structural email format on top of the server's 3–254
 * length rule — so the operator corrects immediately. The server
 * stays the truth at the wire.
 */
export const signInEmailSchema = emailSchema.pipe(z.string().email());

/**
 * Kenya msisdn mirror (#35 sign-in identifier round): the four
 * maintainer-declared accepted input formats, byte-identical to the
 * backend rule (domain/members.py — 07XXXXXXXX / 01XXXXXXXX and their
 * E.164 twins +2547XXXXXXXX / +2541XXXXXXXX; oracles mirrored from
 * the backend suite). This is a courtesy MIRROR — the server's single
 * normalizer stays the truth at the wire.
 */
export const KENYA_MSISDN_LOCAL = /^0([17])(\d{8})$/;
export const KENYA_MSISDN_E164 = /^\+254([17])\d{8}$/;

export type SignInIdentifierKind = "email" | "phone";

/**
 * Live as-you-type classification: a value consisting only of digits
 * (with an optional leading +) is being typed as a PHONE; anything
 * else (an '@', letters, punctuation) is being typed as an EMAIL.
 * Empty input classifies as email so the neutral affordances hold.
 */
export function classifyIdentifier(value: string): SignInIdentifierKind {
  const v = value.trim();
  if (v === "") return "email";
  return /^\+?\d+$/.test(v) ? "phone" : "email";
}

/** Mirror of the backend normalizer: E.164 string, or null when invalid. */
export function normalizeKenyaMsisdn(raw: string): string | null {
  const value = raw.trim();
  if (KENYA_MSISDN_E164.test(value)) return value;
  const match = KENYA_MSISDN_LOCAL.exec(value);
  if (match) return `+254${match[1]}${match[2]}`;
  return null;
}
