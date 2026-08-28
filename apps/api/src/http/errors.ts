import { ErrorCode, type ErrorCodeValue } from "@awg-control/contracts";

export class AppError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ErrorCodeValue | string,
    title: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(title);
    this.name = "AppError";
  }
}

export function notFound(title = "Resource not found"): AppError {
  return new AppError(404, ErrorCode.NotFound, title);
}

export function conflict(code: ErrorCodeValue | string, title: string, details?: Record<string, unknown>): AppError {
  return new AppError(409, code, title, details);
}

