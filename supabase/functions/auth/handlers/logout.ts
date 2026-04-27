// auth.logout — best-effort session deletion (no-op if token missing).

import { rpc } from "../../_shared/db.ts";

export async function logout(body: any) {
  const token = body?.token;
  if (typeof token === "string" && token) {
    await rpc("auth_logout", { p_token: token });
  }
  return { logged_out: true };
}
