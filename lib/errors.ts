export type ErrorCode =
  | "BAD_TYPE"
  | "FILE_TOO_LARGE"
  | "UNREADABLE_FILE"
  | "RATE_LIMITED"
  | "EXTRACTION_TIMEOUT"
  | "EXTRACTION_FAILED"
  | "VALIDATION"
  | "LOCKED"
  | "LEAD_SAVE_FAILED"
  | "N8N_UNAVAILABLE"
  | "NO_API_KEY"
  | "SERVER";

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400,
    public retryable = true
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown) {
  const err =
    e instanceof AppError
      ? e
      : new AppError("SERVER", "Something went wrong on our side. Please try again in a moment.", 500, true);
  if (!(e instanceof AppError)) console.error("[unhandled]", e instanceof Error ? e.message : e);
  return Response.json(
    { error: { code: err.code, message: err.message, retryable: err.retryable } },
    { status: err.status }
  );
}
