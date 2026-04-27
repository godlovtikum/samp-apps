// jobs.create — validate input, upsert project, dedup, create job, dispatch GH.
//
// The user picks one of three project types in the build form. Each
// type maps 1:1 to a GitHub Actions repository_dispatch event_type
// and to a corresponding workflow file. The selected value is stored
// on both the project (as the "default for next time") and on the
// individual build_jobs row (as the immutable record of what this
// build actually ran as).

import { rpc } from "../../_shared/db.ts";
import { appError } from "../../_shared/errors.ts";
import type { SessionUser } from "../../_shared/session.ts";

const REPO_RE = /^https?:\/\/[^\s]+\/[^\s]+$/i;
const REF_RE  = /^[A-Za-z0-9._\-\/]{1,255}$/;

type ProjectType = "bare_rn" | "expo_managed" | "expo_prebuild";

const VALID_PROJECT_TYPES = new Set<ProjectType>([
    "bare_rn",
    "expo_managed",
    "expo_prebuild",
]);

// Each project type triggers its own GitHub Actions workflow file
// (see github-actions/workflows/{react-native,expo-managed,expo-prebuild}.yml).
// The dispatch event_type below MUST match the `types:` block in the
// corresponding workflow's `on: repository_dispatch:` section.
const EVENT_TYPE_BY_PROJECT_TYPE: Record<ProjectType, string> = {
    bare_rn:       "build_react_native",
    expo_managed:  "build_expo_managed",
    expo_prebuild: "build_expo_prebuild",
};

async function sha256Hex(input: string): Promise<string> {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function dispatchGitHub(eventType: string, clientPayload: Record<string, unknown>) {
    const owner = Deno.env.get("GITHUB_OWNER");
    const repo  = Deno.env.get("GITHUB_REPO");
    const token = Deno.env.get("GITHUB_TOKEN");
    if (!owner || !repo || !token) {
        console.error("[jobs.create] GitHub env vars not set");
        throw appError("build.dispatch_failed", "GitHub not configured.");
    }
    const dispatchGitUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
    const response = await fetch(dispatchGitUrl,  {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
        },
    );
    if (!response.ok) {
        console.error("[jobs.create] dispatch failed", response.status, await response.text());
        throw appError("build.dispatch_failed");
    }
}

export async function create(body: any, user: SessionUser) {
    const project_repo = String(body?.project_repo ?? "").trim();
    const project_ref  = String(body?.project_ref  ?? "main").trim();
    const project_name = body?.project_name ? String(body.project_name).trim() : "";
    const project_type_raw = String(body?.project_type ?? "bare_rn").trim() as ProjectType;

    if (!REPO_RE.test(project_repo)) throw appError("build.invalid_repo");
    if (!REF_RE.test(project_ref))   throw appError("build.invalid_ref");
    if (!VALID_PROJECT_TYPES.has(project_type_raw)) {
        throw appError("build.invalid_project_type",
            "Choose one of: React Native (bare), Expo (managed), or Expo (prebuild committed).");
    }
    const project_type: ProjectType = project_type_raw;

    const projectRow = (await rpc<any[]>("projects_upsert", {
        p_user_id:      user.user_id,
        p_name:         project_name || project_repo.split("/").slice(-2).join("/"),
        p_source_url:   project_repo,
        p_default_ref:  project_ref,
        p_project_type: project_type,
    }))[0];

    // The dedup hash includes project_type so a user can intentionally
    // queue the same repo+ref twice under different types (e.g. once
    // as bare_rn to confirm rejection, once as expo_managed to build).
    const dedupHash = await sha256Hex(
        `${project_repo}|${project_ref}|${user.user_id}|${project_type}`,
    );

    const jobRow = (await rpc<any[]>("jobs_create", {
        p_user_id:      user.user_id,
        p_project_id:   projectRow.id,
        p_ref:          project_ref,
        p_dedup_hash:   dedupHash,
        p_project_type: project_type,
    }))[0];

    if (jobRow.was_existing) {
        return {
            job_id: jobRow.id,
            status: jobRow.status,
            deduplicated: true,
            project_id: projectRow.id,
            project_type,
            message: "A build for this project is already in progress.",
        };
    }

    await dispatchGitHub(EVENT_TYPE_BY_PROJECT_TYPE[project_type], {
        job_id:       jobRow.id,
        user_id:      user.user_id,
        project_repo,
        project_ref,
        project_type,
        supabase_url: Deno.env.get("SUPABASE_URL"),
        supabase_key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    });

    return {
        job_id: jobRow.id,
        status: "queued",
        deduplicated: false,
        project_id: projectRow.id,
        project_type,
    };
}
