// SAMP Apps — Standard response envelope (Supabase / Deno).
import { AppError, ERRORS, appError } from "./errors.ts";

const CORS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status, headers: CORS,
  });
}

export function fail(err: unknown): Response {
  let appErr: AppError;
  if (err instanceof AppError) {
    appErr = err;
  } else if (err && typeof err === "object" && "code" in (err as any) && ERRORS[(err as any).code]) {
    appErr = appError((err as any).code);
  } else {
    // Internal — log it, never leak details.
    console.error("[supabase-fn] unhandled", err);
    appErr = appError("system.unknown_error");
  }
  return new Response(JSON.stringify({
    success: false, data: null,
    error: { code: appErr.code, message: appErr.publicMessage },
  }), { status: appErr.status, headers: CORS });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return null;
}
