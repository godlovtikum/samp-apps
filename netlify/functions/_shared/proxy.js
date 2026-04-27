// SAMP Apps — Netlify is a routing layer ONLY.
// This module:
//   - reads/writes the session cookie
//   - forwards the JSON body to a Supabase Edge Function
//   - returns the response unchanged (always envelope shape)
//
// No validation, no business logic, no error catalog lives in Netlify.
// All decisions happen in Supabase.

const COOKIE_NAME = "samp_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 14;

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": process.env["ALLOWED_DOMAIN"] ?? "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json",
};

function setCookieHeader(token) {
    return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
}
function clearCookieHeader() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
function readCookie(event) {
    const rawCookieHeader = event.headers?.cookie || event.headers?.Cookie || "";
    const matchedSegment = rawCookieHeader
        .split(/;\s*/)
        .find((segment) => segment.startsWith(`${COOKIE_NAME}=`));
    return matchedSegment
        ? decodeURIComponent(matchedSegment.slice(COOKIE_NAME.length + 1))
        : null;
}

function envelopeFail(code, message, status = 500) {
    return {
        statusCode: status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, data: null, error: { code, message } }),
    };
}

function preflight(event) {
    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 204, headers: CORS_HEADERS, body: "" };
    }
    return null;
}

// Forward a request to a Supabase Edge Function and return the result wrapped
// for Netlify (with optional Set-Cookie headers).
async function forward(functionName, requestBody, { cookies = [] } = {}) {
    const supabaseUrl = process.env["SUPABASE_URL"];
    const supabaseServiceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!supabaseUrl || !supabaseServiceKey) {
        console.error("[netlify] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
        return envelopeFail("system.unknown_error", "Server misconfigured.");
    }

    let upstreamResponse;
    try {
        upstreamResponse = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${supabaseServiceKey}`,
                apikey: supabaseServiceKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody || {}),
        });
    } catch (fetchError) {
        console.error(`[netlify→${functionName}] fetch failed`, fetchError);
        return envelopeFail("system.unknown_error", "Service unreachable.", 502);
    }

    const responseText = await upstreamResponse.text();
    // Pass the body through unchanged — Supabase already returns the envelope.
    // Only attach cookies on success-with-cookie responses.
    const responseHeaders = { ...CORS_HEADERS };
    const result = {
        statusCode: upstreamResponse.status,
        headers: responseHeaders,
        body: responseText || JSON.stringify({
            success: false, data: null,
            error: { code: "system.unknown_error", message: "Empty response." },
        }),
    };
    if (cookies.length) result.multiValueHeaders = { "Set-Cookie": cookies };
    return result;
}

function parseBody(event) {
    try { return JSON.parse(event.body || "{}"); }
    catch { return null; }
}

module.exports = {
    CORS: CORS_HEADERS, COOKIE_NAME, COOKIE_MAX_AGE,
    setCookieHeader, clearCookieHeader, readCookie,
    envelopeFail, preflight, forward, parseBody,
};
