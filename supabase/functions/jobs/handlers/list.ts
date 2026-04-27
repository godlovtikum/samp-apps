// jobs.list — recent jobs for the signed-in user (optionally filtered by project).

import { rpc } from "../../_shared/db.ts";
import type { SessionUser } from "../../_shared/session.ts";

export async function list(body: any, user: SessionUser) {
  const project_id = body?.project_id ? String(body.project_id) : null;
  const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 100);
  const rows = await rpc("jobs_get_by_user", {
    p_user_id: user.user_id, p_project_id: project_id, p_limit: limit,
  });
  return { jobs: rows };
}
