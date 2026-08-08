import { z } from "zod";

/** Zod-validated response boundary (the house doctrine). */
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
 * server's fail-closed dev_otp_display flag is on (item 11 — dev-mode tester affordance, REMOVE before staging).
 */
export const otpRequestResponseSchema = z.object({
  status: z.string(),
  dev_otp: z.string().optional(),
});

/**
 * Sign-in identifier blur mirror (item 1): staff sign in with an
 * EMAIL (OtpRequestBody, api/auth.py); the blur check is a courtesy
 * mirror — structural email format on top of the server's 3–254
 * length rule — so the operator corrects immediately. The server
 * stays the truth at the wire.
 */
export const signInEmailSchema = emailSchema.pipe(z.string().email());
