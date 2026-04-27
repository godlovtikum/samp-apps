// SAMP Apps — multi-view single-page app with hash routing.
// Talks ONLY to /api/auth and /api/jobs (Netlify Functions).
//
// Style notes (kept for future maintainers):
//   • Descriptive variable names. No single-letter locals.
//   • One file by design — the whole UI is small enough that splitting
//     it would create ceremony without payoff.
//   • All server payloads use the {success, data, error} envelope;
//     `apiCall()` unwraps it and throws on failure.

const POLL_INTERVAL_MS = (window.SAMP_CONFIG && window.SAMP_CONFIG.pollIntervalMs) || 5000;

const topBarElement   = document.getElementById("topbar");
const viewElement     = document.getElementById("view");
const tabBarElement   = document.getElementById("tabbar");

const PROJECT_TYPES = [
    {
        value: "bare_rn",
        label: "React Native (bare)",
        hint: "Repo already has its own android/ directory.",
    },
    {
        value: "expo_managed",
        label: "Expo (managed)",
        hint: "We run expo prebuild for you. No android/ needed in the repo.",
    },
    {
        value: "expo_prebuild",
        label: "Expo (prebuild committed)",
        hint: "Expo project where you ran expo prebuild yourself and committed android/.",
    },
];

const state = {
    user: null,
    jobs: [],
    projects: [],
    jobDetails: {}, // job_id -> { job, events }
    loading: { jobs: false, projects: false },
    notice: null,
    error: null,
    submitting: false,
    authMode: "signin",
};

// ---------- API ----------------------------------------------------------
async function apiCall(path, requestBody) {
    const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
    });
    let envelope;
    try {
        envelope = await response.json();
    } catch {
        envelope = {
            success: false,
            data: null,
            error: { code: "system.unknown_error", message: "Invalid response." },
        };
    }
    if (!envelope.success) {
        const error = new Error(envelope.error?.message || "An unknown error occured");
        error.code = envelope.error?.code || "system.unknown_error";
        throw error;
    }
    return envelope.data;
}

// ---------- Routing ------------------------------------------------------
function currentRoute() {
    const hashWithoutPrefix = (location.hash || "#/").replace(/^#/, "");
    const [, root, ...rest] = hashWithoutPrefix.split("/");
    return { root: root || "", rest };
}
function goToHash(targetHash) {
    if (location.hash !== targetHash) location.hash = targetHash;
    else render();
}
window.addEventListener("hashchange", () => { render(); refreshForCurrentView(); });

// ---------- Bootstrap ----------------------------------------------------
async function boot() {
    try {
        const { user } = await apiCall("/api/auth", { action: "me" });
        state.user = user;
        if (!location.hash) location.hash = "#/";
        render();
        await refreshAll();
        setInterval(refreshForCurrentView, POLL_INTERVAL_MS);
    } catch {
        render();
    }
}

async function refreshAll() {
    if (!state.user) return;
    await Promise.all([refreshJobs(), refreshProjects()]);
    render();
}
async function refreshForCurrentView() {
    if (!state.user) return;
    await refreshJobs();
    const { root, rest } = currentRoute();
    if (root === "jobs" && rest[0]) await refreshJobDetail(rest[0]);
    if (root === "projects") await refreshProjects();
    render();
}
async function refreshJobs() {
    state.loading.jobs = true;
    try {
        const { jobs } = await apiCall("/api/jobs", { action: "list" });
        state.jobs = jobs || [];
    } catch (error) {
        if (error.code === "auth.unauthenticated") { state.user = null; render(); return; }
    } finally { state.loading.jobs = false; }
}
async function refreshProjects() {
    state.loading.projects = true;
    try {
        const { projects } = await apiCall("/api/jobs", { action: "list_projects" });
        state.projects = projects || [];
    } catch (error) {
        if (error.code === "auth.unauthenticated") { state.user = null; render(); return; }
    } finally { state.loading.projects = false; }
}
async function refreshJobDetail(jobId) {
    try {
        const detail = await apiCall("/api/jobs", { action: "get", job_id: jobId });
        state.jobDetails[jobId] = detail;
    } catch (error) {
        if (error.code === "auth.unauthenticated") { state.user = null; render(); }
    }
}

// ---------- Helpers ------------------------------------------------------
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatTime(isoString) { return isoString ? new Date(isoString).toLocaleString() : ""; }
function formatRelativeTime(isoString) {
    if (!isoString) return "";
    const secondsAgo = (Date.now() - new Date(isoString).getTime()) / 1000;
    if (secondsAgo < 60)    return `${Math.floor(secondsAgo)}s ago`;
    if (secondsAgo < 3600)  return `${Math.floor(secondsAgo / 60)}m ago`;
    if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}h ago`;
    return new Date(isoString).toLocaleDateString();
}

// Pretty stage labels.
const STAGE_LABEL = {
    running: "Started",
    pipeline_install: "Pipeline ready",
    clone: "Clone repo",
    preflight: "Security preflight",
    install: "Install deps",
    prebuild: "Expo prebuild",
    inspect: "Inspect project",
    bundle: "Bundle JS",
    validate: "Validate Android root",
    pre_gradle: "Pre-Gradle health",
    gradle: "Compile + package",
    sign: "Sign APK",
    release: "Publish APK",
    finalize: "Transparency report",
    done: "Done",
    system: "System failure",
};
function stageLabel(stage) { return STAGE_LABEL[stage] || stage; }

const PROJECT_TYPE_LABEL = Object.fromEntries(
    PROJECT_TYPES.map((entry) => [entry.value, entry.label]),
);
function projectTypeLabel(value) {
    return PROJECT_TYPE_LABEL[value] || "React Native (bare)";
}

// ---------- Top bar + tabs ----------------------------------------------
function renderShell() {
    if (!state.user) {
        topBarElement.innerHTML =
            `<div class="brand">SAMP APPS <small>Build Android apps from your phone</small></div>`;
        tabBarElement.style.display = "none";
        return;
    }
    tabBarElement.style.display = "";
    topBarElement.innerHTML = `
        <div class="brand">SAMP APPS</div>
        <div class="who">${escapeHtml(state.user.full_name || state.user.email)}
            &middot; <a href="#" data-action="logout">Sign out</a></div>`;

    const activeRoot = currentRoute().root;
    const tabLink = (id, label, icon) =>
        `<a href="#/${id}" class="${activeRoot === id ? "active" : ""}"><strong>${icon}</strong>${label}</a>`;
    tabBarElement.innerHTML =
        tabLink("",         "Home",     "◆") +
        tabLink("build",    "New",      "+") +
        tabLink("history",  "History",  "≡") +
        tabLink("projects", "Projects", "❒");
}

// ---------- Views --------------------------------------------------------
function viewAuth() {
    const mode = state.authMode;
    return `
        <div class="panel">
            <div class="tabs">
                <button class="${mode === "signin" ? "active" : ""}" data-action="set-mode" data-mode="signin">Sign in</button>
                <button class="${mode === "signup" ? "active" : ""}" data-action="set-mode" data-mode="signup">Create account</button>
            </div>
            <form data-action="${mode}">
                ${mode === "signup" ? `
                    <label>Full name</label>
                    <input name="full_name" required autocomplete="name" />` : ``}
                <label>Email</label>
                <input name="email" type="email" required autocomplete="email" />
                <label>Password</label>
                <input name="password" type="password" required minlength="${mode === "signup" ? 8 : 1}"
                    autocomplete="${mode === "signup" ? "new-password" : "current-password"}" />
                ${state.error ? `<div class="alert error">${escapeHtml(state.error)}</div>` : ``}
                <button class="btn" type="submit" ${state.submitting ? "disabled" : ""}>
                    ${mode === "signup" ? "Create account" : "Sign in"}${state.submitting ? '<span class="spinner"></span>' : ""}
                </button>
            </form>
            <p class="muted" style="margin-top:14px">
                SAMP Apps builds Android APKs from React Native and Expo repos with only the permissions your code actually uses.
            </p>
        </div>`;
}

function statusCounts() {
    const counts = { queued: 0, running: 0, succeeded: 0, failed: 0 };
    for (const job of state.jobs) counts[job.status] = (counts[job.status] || 0) + 1;
    return counts;
}

function viewHome() {
    const counts = statusCounts();
    const recentJobs = state.jobs.slice(0, 5);
    return `
        <div class="stat-row">
            <div class="stat"><div class="n">${counts.running + counts.queued}</div><div class="l">In progress</div></div>
            <div class="stat"><div class="n">${counts.succeeded}</div><div class="l">Succeeded</div></div>
            <div class="stat"><div class="n">${counts.failed}</div><div class="l">Failed</div></div>
        </div>

        <div class="panel">
            <h2>Quick build</h2>
            <a class="btn" href="#/build">Queue a new build</a>
            <p class="muted" style="margin-top:8px">Status updates every ${Math.round(POLL_INTERVAL_MS / 1000)}s.</p>
        </div>

        <div class="panel">
            <h2>Recent activity <span class="muted">· last 5</span></h2>
            ${recentJobs.length === 0
                ? `<p class="empty">No builds yet.</p>`
                : `<div class="list">${recentJobs.map(renderJob).join("")}</div>`}
            ${state.jobs.length > 5 ? `<p style="margin-top:12px"><a href="#/history">See all builds →</a></p>` : ``}
        </div>`;
}

function renderProjectTypeSelector(selectedValue) {
    return `
        <fieldset class="project-type-group">
            <legend>Project type</legend>
            ${PROJECT_TYPES.map((entry) => `
                <label class="project-type-option">
                    <input type="radio" name="project_type" value="${entry.value}"
                        ${entry.value === selectedValue ? "checked" : ""} required />
                    <div>
                        <strong>${escapeHtml(entry.label)}</strong>
                        <div class="muted">${escapeHtml(entry.hint)}</div>
                    </div>
                </label>
            `).join("")}
        </fieldset>`;
}

function viewBuild() {
    return `
        <div class="panel">
            <h2>New build</h2>
            <form data-action="create-build">
                <label>Git repository URL</label>
                <input name="project_repo" required placeholder="https://github.com/user/my-rn-app" />
                <div class="row">
                    <div>
                        <label>Branch / ref</label>
                        <input name="project_ref" value="main" />
                    </div>
                    <div>
                        <label>Project name <span class="muted">(optional)</span></label>
                        <input name="project_name" placeholder="My App" />
                    </div>
                </div>
                ${renderProjectTypeSelector("bare_rn")}
                ${state.error  ? `<div class="alert error">${escapeHtml(state.error)}</div>` : ``}
                ${state.notice ? `<div class="alert info">${escapeHtml(state.notice)}</div>` : ``}
                <button class="btn" type="submit" ${state.submitting ? "disabled" : ""}>
                    ${state.submitting ? "Queuing…" : "Queue build"}
                </button>
                <p class="muted" style="margin-top:8px">
                    Same repo + branch + project type can't be queued twice while a build is in progress.
                </p>
            </form>
        </div>`;
}

function viewHistory() {
    return `
        <div class="panel">
            <h2>Build history ${state.loading.jobs ? '<span class="spinner"></span>' : ""}</h2>
            ${state.jobs.length === 0
                ? `<p class="empty">No builds yet.</p>`
                : `<div class="list">${state.jobs.map(renderJob).join("")}</div>`}
        </div>`;
}

function viewProjects() {
    return `
        <div class="panel">
            <h2>Projects ${state.loading.projects ? '<span class="spinner"></span>' : ""}</h2>
            ${state.projects.length === 0
                ? `<p class="empty">No projects yet. Queue a build to create one.</p>`
                : `<div class="list">${state.projects.map(renderProject).join("")}</div>`}
        </div>`;
}

function viewProjectDetail(projectId) {
    const project = state.projects.find((entry) => entry.id === projectId);
    if (!project) return `<div class="panel"><p class="empty">Project not found.</p>
        <a class="btn ghost" href="#/projects">Back to projects</a></div>`;
    const projectBuilds = state.jobs.filter((job) => job.project_id === projectId);
    const prefillPayload = {
        project_repo: project.source_url,
        project_ref:  project.default_ref,
        project_name: project.name,
        project_type: project.project_type || "bare_rn",
    };
    return `
        <div class="panel">
            <h2>${escapeHtml(project.name)}</h2>
            <p class="muted" style="margin:0 0 6px">
                <a href="${escapeHtml(project.source_url)}">${escapeHtml(project.source_url)}</a>
            </p>
            <p class="muted">
                Default branch: <span class="kbd">${escapeHtml(project.default_ref || "main")}</span>
                · Project type: <span class="kbd">${escapeHtml(projectTypeLabel(project.project_type))}</span>
                · ${project.build_count} build${project.build_count == 1 ? "" : "s"}
            </p>
            <a class="btn" href="#/build"
               data-prefill='${encodeURIComponent(JSON.stringify(prefillPayload))}'>Build again</a>
        </div>
        <div class="panel">
            <h2>Builds for this project</h2>
            ${projectBuilds.length === 0
                ? `<p class="empty">No builds for this project.</p>`
                : `<div class="list">${projectBuilds.map(renderJob).join("")}</div>`}
        </div>`;
}

function viewJobDetail(jobId) {
    const detail = state.jobDetails[jobId];
    if (!detail) return `<div class="panel"><p class="empty">Loading job…</p></div>`;
    const { job, events } = detail;
    return `
        <div class="panel">
            <h2>
                <span class="pill s-${job.status}">${job.status}</span>
                ${escapeHtml(job.project_name)} <span class="muted">· ${escapeHtml(job.ref)}</span>
            </h2>
            <p class="muted">
                Type: <span class="kbd">${escapeHtml(projectTypeLabel(job.project_type))}</span>
                · Started ${formatTime(job.started_at || job.created_at)}
                ${job.finished_at ? `· finished ${formatTime(job.finished_at)}` : ``}
                ${job.current_stage ? `· now: <strong>${escapeHtml(stageLabel(job.current_stage))}</strong>` : ``}
            </p>
            <div style="margin-top:8px">
                ${job.apk_url ? `<a class="btn" href="${escapeHtml(job.apk_url)}">Download APK</a>` : ""}
                ${job.run_url ? `<p style="margin-top:8px"><a href="${escapeHtml(job.run_url)}">View CI logs →</a></p>` : ""}
            </div>
            ${renderJobError(job)}
        </div>

        <div class="panel">
            <h2>Pipeline timeline ${job.status === "running" ? '<span class="spinner"></span>' : ""}</h2>
            ${renderTimeline(events, job.status)}
        </div>

        ${job.project_spec ? `
            <div class="panel">
                <h2>Inspected facts</h2>
                ${renderInspectedFacts(job.project_spec)}
            </div>` : ``}
    `;
}

function renderJobError(job) {
    if (!job.error_message) return "";
    if (job.error_kind === "project") {
        return `<div class="alert error" style="margin-top:12px">
            <strong>Project requirement not met</strong><br/>
            ${escapeHtml(job.error_message)}
            ${Array.isArray(job.error_details) && job.error_details.length ? `
                <ul style="margin:8px 0 0; padding-left:18px">
                    ${job.error_details.filter((entry) => entry.severity === "error").map((entry) =>
                        `<li><code>${escapeHtml(entry.code)}</code> — ${escapeHtml(entry.message)}</li>`
                    ).join("")}
                </ul>` : ``}
        </div>`;
    }
    return `<div class="alert error" style="margin-top:12px">
        <strong>System error</strong><br/>${escapeHtml(job.error_message)}
    </div>`;
}

function renderTimeline(events, jobStatus) {
    if (!events || events.length === 0) {
        return `<p class="empty">Waiting for the build runner to pick up the job…</p>`;
    }
    // Group by stage; keep latest status per stage but render in chronological order.
    const seenStages = new Set();
    const timelineRows = [];
    for (const event of events) {
        const stageKey = event.stage;
        if (!seenStages.has(stageKey)) {
            seenStages.add(stageKey);
            timelineRows.push({ ...event, latest: event });
        } else {
            const existingRow = timelineRows.find((row) => row.stage === stageKey);
            existingRow.latest = event;
        }
    }
    return `<ol class="timeline">
        ${timelineRows.map((row) => {
            const statusValue = row.latest.status;
            const statusIcon =
                statusValue === "succeeded" ? "✓" :
                statusValue === "failed"    ? "✕" :
                statusValue === "warned"    ? "!" :
                statusValue === "started"   ? "•" : "·";
            const cssClass = statusValue === "started" && jobStatus === "running" ? "active" : statusValue;
            return `
                <li class="ev ev-${cssClass}">
                    <span class="ev-icon">${statusIcon}</span>
                    <div>
                        <div><strong>${escapeHtml(stageLabel(row.stage))}</strong>
                            <span class="muted">· ${formatRelativeTime(row.latest.created_at)}</span>
                        </div>
                        ${row.latest.message ? `<div class="muted" style="margin-top:2px">${escapeHtml(row.latest.message)}</div>` : ``}
                    </div>
                </li>`;
        }).join("")}
    </ol>`;
}

function renderInspectedFacts(spec) {
    const facts = spec.facts || {};
    const warnings = (spec.issues || []).filter((entry) => entry.severity === "warn");
    const renderFactRow = (label, value) =>
        value ? `<div><span class="muted">${escapeHtml(label)}</span> <span class="kbd">${escapeHtml(value)}</span></div>` : "";
    return `
        <div class="facts">
            ${renderFactRow("Entry file", facts.entry_file)}
            ${renderFactRow("Babel config", facts.babel_config)}
            ${renderFactRow("Metro config", facts.metro_config || "default")}
            ${renderFactRow("React Native", facts.react_native_version)}
            ${facts.is_expo ? renderFactRow("Expo", facts.expo_version) : ""}
            ${renderFactRow("JS engine", facts.js_engine)}
            ${renderFactRow("TS config", facts.tsconfig)}
            ${facts.rn_native_modules?.length ? `<div><span class="muted">Native modules</span>
                ${facts.rn_native_modules.slice(0, 12).map((moduleName) =>
                    `<span class="kbd">${escapeHtml(moduleName)}</span>`).join(" ")}
                ${facts.rn_native_modules.length > 12 ? `<span class="muted">+${facts.rn_native_modules.length - 12} more</span>` : ""}</div>` : ""}
        </div>
        ${warnings.length ? `<div class="alert info" style="margin-top:10px">
            <strong>Notes</strong><ul style="margin:6px 0 0; padding-left:18px">
            ${warnings.map((entry) => `<li>${escapeHtml(entry.message)}</li>`).join("")}</ul></div>` : ""}
    `;
}

function renderJob(job) {
    const stageSuffix = job.status === "running" && job.current_stage
        ? ` <span class="muted">· ${escapeHtml(stageLabel(job.current_stage))}</span>` : "";
    const errorBadge = job.status === "failed" && job.error_kind
        ? ` <span class="pill s-failed">${job.error_kind} error</span>` : "";
    const typeBadge = job.project_type
        ? ` <span class="pill s-type">${escapeHtml(projectTypeLabel(job.project_type))}</span>` : "";
    return `
        <div class="item">
            <a class="link" href="#/jobs/${job.id}">
                <div>
                    <span class="pill s-${job.status}">${job.status}</span>
                    <strong>${escapeHtml(job.project_name || "project")}</strong>
                    <span class="muted"> · ${escapeHtml(job.ref)}</span>
                    ${stageSuffix}${errorBadge}${typeBadge}
                </div>
                <div class="muted" style="margin-top:4px">
                    ${formatTime(job.created_at)} · <span class="kbd">${job.id.slice(0, 8)}</span>
                </div>
                ${job.error_message ? `<div class="muted" style="margin-top:4px">${escapeHtml(job.error_message)}</div>` : ""}
            </a>
        </div>`;
}

function renderProject(project) {
    const lastStatus = project.last_status || "none";
    return `
        <div class="item">
            <a class="link" href="#/projects/${project.id}">
                <span class="pill s-${lastStatus}">${lastStatus}</span>
                <strong>${escapeHtml(project.name)}</strong>
                <div class="muted" style="margin-top:4px">
                    ${escapeHtml(project.source_url)}<br/>
                    ${escapeHtml(projectTypeLabel(project.project_type))}
                    · ${project.build_count} build${project.build_count == 1 ? "" : "s"}
                    ${project.last_build_at ? ` · last ${formatTime(project.last_build_at)}` : ""}
                </div>
            </a>
        </div>`;
}

// ---------- Render -------------------------------------------------------
function render() {
    renderShell();
    // Reveal the value-prop hero only when the user is signed out (the
    // landing screen). Once authenticated, the hero is hidden so the app
    // chrome owns the viewport.
    const heroElement = document.getElementById("hero");
    if (heroElement) {
        if (state.user) { heroElement.hidden = true;  heroElement.setAttribute("aria-hidden", "true"); }
        else            { heroElement.hidden = false; heroElement.removeAttribute("aria-hidden"); }
    }
    if (!state.user) { viewElement.innerHTML = viewAuth(); return; }
    const route = currentRoute();
    if      (route.root === "")              viewElement.innerHTML = viewHome();
    else if (route.root === "build")         viewElement.innerHTML = viewBuild();
    else if (route.root === "history")       viewElement.innerHTML = viewHistory();
    else if (route.root === "jobs"     && route.rest[0]) viewElement.innerHTML = viewJobDetail(route.rest[0]);
    else if (route.root === "projects" && route.rest[0]) viewElement.innerHTML = viewProjectDetail(route.rest[0]);
    else if (route.root === "projects")      viewElement.innerHTML = viewProjects();
    else                                     viewElement.innerHTML = viewHome();

    // Apply prefill if user just arrived at the build view.
    if (currentRoute().root === "build") {
        const rawPrefill = sessionStorage.getItem("samp_prefill");
        if (rawPrefill) {
            try {
                const prefillData = JSON.parse(rawPrefill);
                for (const [fieldName, fieldValue] of Object.entries(prefillData)) {
                    if (!fieldValue) continue;
                    if (fieldName === "project_type") {
                        const radio = viewElement.querySelector(
                            `input[name="project_type"][value="${fieldValue}"]`,
                        );
                        if (radio) radio.checked = true;
                    } else {
                        const inputField = viewElement.querySelector(`[name="${fieldName}"]`);
                        if (inputField) inputField.value = fieldValue;
                    }
                }
            } catch { /* ignore malformed prefill */ }
            sessionStorage.removeItem("samp_prefill");
        }
    }
}

// ---------- Events -------------------------------------------------------
document.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const formElement = submitEvent.target;
    const formAction = formElement.getAttribute("data-action");
    const formData = Object.fromEntries(new FormData(formElement).entries());

    state.error = null; state.notice = null; state.submitting = true; render();
    try {
        if (formAction === "signin" || formAction === "signup") {
            const { user } = await apiCall("/api/auth", { action: formAction, ...formData });
            state.user = user; state.submitting = false;
            goToHash("#/"); refreshAll(); return;
        }
        if (formAction === "create-build") {
            if (!formData.project_type) formData.project_type = "bare_rn";
            const result = await apiCall("/api/jobs", { action: "create", ...formData });
            state.notice = result.deduplicated
                ? "A build for this project + branch + type is already in progress. Showing existing job."
                : "Build queued. Status updates automatically.";
            state.submitting = false;
            await refreshAll();
            goToHash(`#/jobs/${result.job_id}`);
            refreshJobDetail(result.job_id).then(render);
            return;
        }
    } catch (error) {
        state.error = error.message; state.submitting = false; render();
    }
});

document.addEventListener("click", async (clickEvent) => {
    const actionTarget = clickEvent.target.closest("[data-action]");
    if (actionTarget) {
        const actionName = actionTarget.getAttribute("data-action");
        if (actionName === "set-mode") {
            clickEvent.preventDefault();
            state.authMode = actionTarget.getAttribute("data-mode");
            state.error = null; render(); return;
        }
        if (actionName === "logout") {
            clickEvent.preventDefault();
            await apiCall("/api/auth", { action: "logout" }).catch(() => {});
            state.user = null; state.jobs = []; state.projects = [];
            location.hash = ""; render(); return;
        }
    }
    const prefillTarget = clickEvent.target.closest("[data-prefill]");
    if (prefillTarget) {
        try {
            sessionStorage.setItem(
                "samp_prefill",
                decodeURIComponent(prefillTarget.getAttribute("data-prefill")),
            );
        } catch { /* ignore */ }
    }
});

boot();
