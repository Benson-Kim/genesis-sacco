import { z } from "zod";

/**
 * Backend error envelope (gate 1.6): a sanitized category plus a
 * correlation ID — never internals or stack traces.
 */
export const errorEnvelopeSchema = z.object({
  category: z.string(),
  correlation_id: z.string(),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export class ApiError extends Error {
  readonly status: number;
  readonly category: string;
  readonly correlationId: string | null;

  constructor(status: number, category: string, correlationId: string | null) {
    super(`API error ${status}: ${category}`);
    this.name = "ApiError";
    this.status = status;
    this.category = category;
    this.correlationId = correlationId;
  }
}

/** Build an ApiError from an openapi-fetch error body + response. */
export function toApiError(error: unknown, response: Response): ApiError {
  const parsed = errorEnvelopeSchema.safeParse(error);
  if (parsed.success) {
    return new ApiError(
      response.status,
      parsed.data.category,
      parsed.data.correlation_id,
    );
  }
  return new ApiError(response.status, "internal_error", null);
}
