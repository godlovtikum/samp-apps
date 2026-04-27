// auth.signin — verifies password, opens a session.

import { rpc } from "../../_shared/db.ts";
import { appError } from "../../_shared/errors.ts";

const SESSION_TTL = 60 * 60 * 24 * 14;

export async function signin(body: any, ctx: { ua: string; ip: string }) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!email || !password) throw appError("auth.invalid_credentials");

  const verified = await rpc<any[]>("auth_verify_password", {
    p_email: email, p_password: password,
  });
  if (!verified.length) throw appError("auth.invalid_credentials");

  const user = verified[0];
  const sess = (await rpc<any[]>("auth_create_session", {
    p_user_id: user.id, p_user_agent: ctx.ua, p_ip: ctx.ip, p_ttl_seconds: SESSION_TTL,
  }))[0];

  return { user, session: { token: sess.token, expires_at: sess.expires_at } };
}
