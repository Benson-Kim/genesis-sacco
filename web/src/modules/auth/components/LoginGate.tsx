"use client";

/**
 * OTP sign-in gate mirroring the prototype (`vLogin`): request a one-time
 * password, then verify the 6-digit code. Server enforces attempts/TTL/
 * rate limits (P3); this component only shapes the flow.
 */
import { useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ApiError, newIdempotencyKey } from "@genesis/api-client";
import { Button, Field } from "@genesis/design-system";
import { requestOtp, verifyOtp } from "../api";
import { OTP_LENGTH, otpCodeSchema, signInEmailSchema } from "../schemas";
import styles from "./LoginGate.module.css";

const EMAIL_BLUR_MESSAGE = "Enter your registered email address.";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.category) {
      case "rate_limited":
        return "Too many attempts — please wait a moment and try again.";
      case "unauthenticated":
        return "Incorrect or expired code. Request a new one if needed.";
      case "validation_error":
        return "Please check your details and try again.";
      default:
        return `Something went wrong (ref ${error.correlationId ?? "n/a"}).`;
    }
  }
  return "Something went wrong. Please try again.";
}

export function LoginGate({ notice }: Readonly<{ notice?: string }>) {
  const router = useRouter();
  const [stage, setStage] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array.from({ length: OTP_LENGTH }, () => ""));
  const [formError, setFormError] = useState<string | null>(null);
  //  item 1 — blur-time identifier validation (courtesy mirror of
  // the server rule; the server stays the truth at the wire). The
  // message shows on blur and clears the moment the value is corrected.
  const [emailBlurError, setEmailBlurError] = useState<string | null>(null);
  // DEV-ONLY (item 11, REMOVE BEFORE STAGING): the server sends
  // dev_otp only behind its fail-closed flag; null renders NOTHING.
  const [devOtp, setDevOtp] = useState<string | null>(null);

  function validateEmailBlur(value: string) {
    const ok = signInEmailSchema.safeParse(value.trim()).success;
    setEmailBlurError(ok ? null : EMAIL_BLUR_MESSAGE);
  }

  const request = useMutation({
    mutationFn: requestOtp,
    onSuccess: (result) => {
      setDigits(Array.from({ length: OTP_LENGTH }, () => ""));
      setStage("verify");
      setFormError(null);
      setDevOtp(result.devOtp);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const verify = useMutation({
    mutationFn: verifyOtp,
    onSuccess: () => router.replace("/dashboard"),
    onError: (error) => setFormError(errorMessage(error)),
  });

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.isPending) return;
    const parsed = signInEmailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setFormError(EMAIL_BLUR_MESSAGE);
      return;
    }
    setFormError(null);
    request.mutate(parsed.data);
  }

  function submitVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verify.isPending) return;
    const parsed = otpCodeSchema.safeParse(digits.join(""));
    if (!parsed.success) {
      setFormError("Enter all 6 digits.");
      return;
    }
    setFormError(null);
    // One Idempotency-Key per submission: a double-submit of the same code
    // replays the stored response instead of a second effect (concurrency safety).
    verify.mutate({
      email: email.trim(),
      code: parsed.data,
      idempotencyKey: newIdempotencyKey(),
    });
  }

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    setDigits((current) => current.map((d, i) => (i === index ? digit : d)));
    if (digit !== "" && index < OTP_LENGTH - 1) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  }

  function onDigitKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && digits[index] === "" && index > 0) {
      document.getElementById(`otp-${index - 1}`)?.focus();
    }
  }

  //  item 12 — sanitized full-code paste: digits are harvested from
  // the clipboard (non-digits stripped), fanned out from box 1, and
  // focus lands on the next empty box. A digit-free paste is inert —
  // hostile clipboard content never enters any box.
  function onDigitPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (pasted === "") return;
    setDigits(Array.from({ length: OTP_LENGTH }, (_, i) => pasted[i] ?? ""));
    const focusIndex = Math.min(pasted.length, OTP_LENGTH - 1);
    document.getElementById(`otp-${focusIndex}`)?.focus();
  }

  const brand = (
    <div className={styles.brand}>
      <div className={styles.mark}>G</div>
      <div>
        <div className={styles.brandName}>Genesis Prestige</div>
        <div className={styles.brandTag}>ZURI GENESIS · SACCO</div>
      </div>
    </div>
  );

  return (
    <div className={styles.gate}>
      {stage === "request" ? (
        <form className={styles.card} onSubmit={submitRequest}>
          {brand}
          <div className={styles.title}>Staff sign in</div>
          <div className={styles.subtitle}>
            We&apos;ll send a one-time password to your registered email.
          </div>
          {notice !== undefined && notice !== "" && (
            <div className={styles.notice}>{notice}</div>
          )}
          <Field label="Email" htmlFor="login-email">
            <input
              id="login-email"
              className={styles.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                // Clear the blur message the moment the value is corrected.
                if (emailBlurError !== null) validateEmailBlur(event.target.value);
              }}
              onBlur={(event) => validateEmailBlur(event.target.value)}
            />
          </Field>
          {emailBlurError !== null && (
            <div className={styles.error} role="alert">
              {emailBlurError}
            </div>
          )}
          {formError !== null && <div className={styles.error}>{formError}</div>}
          <Button variant="primary" type="submit" className={styles.wide} disabled={request.isPending}>
            {request.isPending ? "Sending…" : "Send OTP"}
          </Button>
          <div className={styles.foot}>Protected by OTP · Kenya DPA 2019 compliant</div>
        </form>
      ) : (
        <form className={styles.card} onSubmit={submitVerify}>
          {brand}
          <div className={styles.title}>Verify OTP</div>
          <div className={styles.subtitle}>
            Enter the 6-digit code sent to <b>{email}</b>
          </div>
          {/* DEV-ONLY (item 11): renders ONLY when the server's
              fail-closed dev flag returned a code. REMOVE BEFORE STAGING. */}
          {devOtp !== null && (
            <div className={styles.notice} data-testid="dev-otp-display">
              Dev mode — OTP for testers: <b>{devOtp}</b>
            </div>
          )}
          <div className={styles.otpRow}>
            {digits.map((digit, index) => (
              <input
                key={index}
                id={`otp-${index}`}
                className={styles.otpInput}
                inputMode="numeric"
                maxLength={1}
                aria-label={`Digit ${index + 1}`}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => onDigitKeyDown(index, event)}
                onPaste={onDigitPaste}
              />
            ))}
          </div>
          {formError !== null && <div className={styles.error}>{formError}</div>}
          <Button variant="primary" type="submit" className={styles.wide} disabled={verify.isPending}>
            {verify.isPending ? "Verifying…" : "Verify & sign in"}
          </Button>
          <div className={styles.foot}>
            Didn&apos;t get it?{" "}
            <button
              type="button"
              className={styles.linkStrong}
              onClick={() => {
                if (!request.isPending) {
                  request.mutate(email.trim());
                }
              }}
            >
              Resend
            </button>{" "}
            ·{" "}
            <button type="button" className={styles.link} onClick={() => setStage("request")}>
              Change email
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
