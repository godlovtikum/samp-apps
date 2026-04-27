// Validates a session token (passed in the request body by Netlify) and
// returns the matching user record, or throws auth.unauthenticated.

import { rpc } from "./db.ts";
import { appError } from "./errors.ts";

export interface SessionUser {
  user_id: string;
  email: string;
  full_name: string;
  expires_at: string;
}

export async function requireUser(token: unknown): Promise<SessionUser> {
  if (typeof token !== "string" || !token) throw appError("auth.unauthenticated");
  const rows = await rpc<SessionUser[]>("auth_validate_session", { p_token: token });
  if (!rows.length) throw appError("auth.unauthenticated");
  return rows[0];
}
