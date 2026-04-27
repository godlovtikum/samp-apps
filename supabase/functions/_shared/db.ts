// SAMP Apps — Postgres RPC client.
// Uses the service-role key (Edge Functions run server-side only).
//
// Maps Postgres error codes → AppError where it makes sense, then surfaces
// everything else as `system.unknown_error` after logging.

import { appError } from "./errors.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!URL || !KEY) {
  console.error("[db] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
}

// Map known Postgres SQLSTATE / RAISE messages → user-facing codes.
const PG_TO_APP: Record<string, string> = {
  "auth.user_exists": "auth.user_exists",
  "auth.invalid_credentials": "auth.invalid_credentials",
  "auth.unauthenticated": "auth.unauthenticated",
};

export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(args),
  });

  if (r.ok) return (await r.json()) as T;

  const text = await r.text();
  console.error(`[rpc:${name}] ${r.status}`, text);

  // Postgres returns either { code, message, details } or { message } depending on error path.
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* keep parsed empty */ }
  const msg: string = parsed?.message || parsed?.hint || "";
  for (const key of Object.keys(PG_TO_APP)) {
    if (msg.includes(key)) throw appError(PG_TO_APP[key]);
  }
  throw appError("system.unknown_error");
}
