// jobs.get — single job with its full event timeline.
// Both queries are scoped to the signed-in user.

import { rpc } from "../../_shared/db.ts";
import { appError } from "../../_shared/errors.ts";
import type { SessionUser } from "../../_shared/session.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function get(body: any, user: SessionUser) {
  const job_id = String(body?.job_id ?? "");
  if (!UUID_RE.test(job_id)) throw appError("build.not_found");

  const [jobRows, events] = await Promise.all([
    rpc<any[]>("jobs_get_one",    { p_user_id: user.user_id, p_job_id: job_id }),
    rpc<any[]>("jobs_get_events", { p_user_id: user.user_id, p_job_id: job_id }),
  ]);

  if (!jobRows.length) throw appError("build.not_found");
  return { job: jobRows[0], events };
}
