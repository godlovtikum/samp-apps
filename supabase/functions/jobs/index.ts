// SAMP Apps — Jobs Edge Function (controller).
// Single entry point. Validates session ONCE, then dispatches to handlers.

import { ok, fail, preflight } from "../_shared/response.ts";
import { appError } from "../_shared/errors.ts";
import { requireUser, type SessionUser } from "../_shared/session.ts";

import { create }        from "./handlers/create.ts";
import { list }          from "./handlers/list.ts";
import { get }           from "./handlers/get.ts";
import { listProjects }  from "./handlers/list_projects.ts";

type Handler = (body: any, user: SessionUser) => Promise<unknown>;

const ROUTES: Record<string, Handler> = {
  create, list, get, list_projects: listProjects,
};

Deno.serve(async (req: Request) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return fail(appError("validation.invalid_action"));

  let body: any;
  try { body = await req.json(); } catch { return fail(appError("validation.invalid_action")); }

  const handler = ROUTES[body?.action];
  if (!handler) return fail(appError("validation.invalid_action"));

  try {
    const user = await requireUser(body?.token);
    return ok(await handler(body, user));
  } catch (err) {
    return fail(err);
  }
});
