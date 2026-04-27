// auth.signup — validates body, creates the user, opens a session.

import { rpc } from "../../_shared/db.ts";
import { appError } from "../../_shared/errors.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_TTL = 60 * 60 * 24 * 14;

export async function signup(body: any, ctx: { ua: string; ip: string }) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const full_name = String(body?.full_name ?? "").trim();

  if (!EMAIL_RE.test(email))     throw appError("auth.invalid_email");
  if (password.length < 8)       throw appError("auth.weak_password");
  if (full_name.length < 1)      throw appError("auth.invalid_name");

  const created = await rpc<any[]>("auth_signup", {
    p_email: email, p_password: password, p_full_name: full_name,
  });
  const user = created[0];

  const sess = (await rpc<any[]>("auth_create_session", {
    p_user_id: user.id, p_user_agent: ctx.ua, p_ip: ctx.ip, p_ttl_seconds: SESSION_TTL,
  }))[0];

  return { user, session: { token: sess.token, expires_at: sess.expires_at } };
}
