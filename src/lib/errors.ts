import { NextResponse } from "next/server";
import { ValidationError } from "@/lib/validation";
import { AdapterError } from "@/lib/adapters/types";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code = "APP_ERROR",
  ) {
    super(message);
  }
}

export function errorStatus(error: unknown) {
  if (error instanceof ValidationError) return error.status;
  if (error instanceof AppError) return error.status;
  if (error instanceof AdapterError)
    return error.status >= 400 && error.status <= 599 ? error.status : 502;
  if (
    error instanceof Error &&
    /UNIQUE constraint failed: users\.email/i.test(error.message)
  )
    return 409;
  return 500;
}

export function errorDetail(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export function jsonError(error: unknown) {
  if (error instanceof ValidationError)
    return NextResponse.json(
      { error: error.message, code: "VALIDATION_ERROR" },
      { status: error.status },
    );
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  if (error instanceof AdapterError)
    return NextResponse.json(
      { error: error.message, code: "PROVIDER_ERROR" },
      {
        status: errorStatus(error),
      },
    );
  if (
    error instanceof Error &&
    /UNIQUE constraint failed: users\.email/i.test(error.message)
  ) {
    return NextResponse.json(
      {
        error: "A user with that email address already exists.",
        code: "EMAIL_EXISTS",
      },
      { status: 409 },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: "An unexpected server error occurred.", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
