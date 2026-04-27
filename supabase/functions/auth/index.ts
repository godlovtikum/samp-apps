// SAMP Apps — Auth Edge Function (controller).
// Single entry point. Reads `action` and routes to a handler module.
// Each handler owns its own validation + business logic.

import { ok, fail, preflight } from "../_shared/response.ts";
import { appError } from "../_shared/errors.ts";

import { signup }   from "./handlers/signup.ts";
import { signin }   from "./handlers/signin.ts";
import { validate } from "./handlers/validate.ts";
import { logout }   from "./handlers/logout.ts";

type Handler = (body: any, ctx: { ua: string; ip: string }) => Promise<unknown>;

const ROUTES: Record<string, Handler> = { signup, signin, validate, logout };

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return fail(appError("validation.invalid_action"));

  let body: any;
  try { body = await req.json(); } catch { return fail(appError("validation.invalid_action")); }

  const action: string = body?.action;
  const handler = ROUTES[action];
  if (!handler) return fail(appError("validation.invalid_action"));

  try {
    const ctx = {
      ua: req.headers.get("user-agent") ?? "",
      ip: req.headers.get("x-forwarded-for") ?? "",
    };
    return ok(await handler(body, ctx));
  } catch (err) {
    return fail(err);
  }
});
