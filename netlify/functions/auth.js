// SAMP Apps — Auth router (Netlify, thin).
// Receives requests from the SPA, attaches/strips the session cookie,
// forwards the action to the Supabase `auth` Edge Function.
// All validation and business rules live in Supabase.

const {
  preflight, parseBody, envelopeFail,
  readCookie, setCookieHeader, clearCookieHeader, forward,
} = require("./_shared/proxy");

exports.handler = async (event) => {
  const pf = preflight(event); if (pf) return pf;
  if (event.httpMethod !== "POST")
    return envelopeFail("validation.invalid_action", "Method not allowed.", 405);

  const body = parseBody(event);
  if (!body || typeof body.action !== "string")
    return envelopeFail("validation.invalid_action", "Missing 'action'.", 400);

  // The SPA uses `me` as a friendlier name for the cookie-validation action.
  // Internally the Supabase Edge Function exposes it as `validate`.
  if (body.action === "me") body.action = "validate";
  const action = body.action;

  // Inject the cookie token for cookie-only actions.
  if (action === "validate" || action === "logout") {
    body.token = readCookie(event);
  }

  const res = await forward("auth", body);

  // Pull session token out of successful signup/signin responses to set a
  // cookie. The Edge Function still returns the original envelope verbatim.
  if (res.statusCode === 200 && (action === "signup" || action === "signin")) {
    try {
      const json = JSON.parse(res.body);
      const token = json?.data?.session?.token;
      if (token) {
        res.multiValueHeaders = { "Set-Cookie": [setCookieHeader(token)] };
        // Strip the session token from the response body — the browser only
        // needs the cookie, not the raw token.
        if (json?.data?.session) delete json.data.session;
        res.body = JSON.stringify(json);
      }
    } catch { /* leave body unchanged */ }
  }

  if (res.statusCode === 200 && action === "logout") {
    res.multiValueHeaders = { "Set-Cookie": [clearCookieHeader()] };
  }

  return res;
};
