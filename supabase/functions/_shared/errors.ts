// SAMP Apps — Error catalog + AppError (Supabase / Deno).
// Single source of truth for user-facing error codes.

export class AppError extends Error {
  code: string;
  publicMessage: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.publicMessage = message;
    this.status = status;
  }
}

export const ERRORS: Record<string, { status: number; message: string }> = {
  "auth.invalid_credentials": { status: 401, message: "Invalid email or password." },
  "auth.user_exists":         { status: 409, message: "An account with that email already exists." },
  "auth.unauthenticated":     { status: 401, message: "You must be signed in." },
  "auth.weak_password":       { status: 422, message: "Password must be at least 8 characters." },
  "auth.invalid_email":       { status: 422, message: "Invalid email address." },
  "auth.invalid_name":        { status: 422, message: "Full name is required." },
  "build.duplicate_request":  { status: 200, message: "A build for this project is already in progress." },
  "build.invalid_repo":       { status: 422, message: "Repository URL must be a valid http(s) URL." },
  "build.invalid_ref":        { status: 422, message: "Branch or ref is invalid." },
  "build.invalid_project_type": { status: 422, message: "Pick a project type: React Native (bare), Expo (managed), or Expo (prebuild committed)." },
  "build.dispatch_failed":    { status: 502, message: "Could not start the build. Please try again." },
  "build.not_found":          { status: 404, message: "Build job not found." },
  "validation.required":      { status: 422, message: "Required field missing." },
  "validation.invalid_action":{ status: 400, message: "Unknown action." },
  "system.unknown_error":     { status: 500, message: "Something went wrong. Please try again." },
};

export function appError(code: string, override?: string): AppError {
  const def = ERRORS[code] || ERRORS["system.unknown_error"];
  return new AppError(code, override || def.message, def.status);
}
