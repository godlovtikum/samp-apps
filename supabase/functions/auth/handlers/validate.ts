// auth.validate — verifies a session cookie token, returns the user.

import { requireUser } from "../../_shared/session.ts";

export async function validate(body: any) {
  const user = await requireUser(body?.token);
  return { user };
}
