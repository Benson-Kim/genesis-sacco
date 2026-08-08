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
 * Sign-in identifier blur mirror (#35 item 1): staff sign in with an
 * EMAIL (OtpRequestBody, api/auth.py); the blur check is a courtesy
 * mirror — structural email format on top of the server's 3–254
 * length rule — so the operator corrects immediately. The server
 * stays the truth at the wire.
 */
export const signInEmailSchema = emailSchema.pipe(z.string().email());
