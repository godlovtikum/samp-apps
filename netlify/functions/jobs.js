// SAMP Apps — Jobs router (Netlify, thin).
// Reads the session cookie, forwards every action to the Supabase `jobs`
// Edge Function. No validation, no business logic.

const {
  preflight, parseBody, envelopeFail, readCookie, forward,
} = require("./_shared/proxy");

exports.handler = async (event) => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "POST")
    return envelopeFail("validation.invalid_action", "Method not allowed.", 405);

  const body = parseBody(event);
  if (!body || typeof body.action !== "string")
    return envelopeFail("validation.invalid_action", "Missing 'action'.", 400);

  const token = readCookie(event);
  if (!token)
    return envelopeFail("auth.unauthenticated", "You must be signed in.", 401);

  body.token = token;
  return forward("jobs", body);
};
