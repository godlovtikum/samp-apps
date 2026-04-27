// jobs.list_projects — projects owned by the signed-in user, with build counts.

import { rpc } from "../../_shared/db.ts";
import type { SessionUser } from "../../_shared/session.ts";

export async function listProjects(_body: any, user: SessionUser) {
  const rows = await rpc("projects_get_by_user", { p_user_id: user.user_id });
  return { projects: rows };
}
