// SAMP Apps — Inspector types.
//
// The Inspector turns "a directory we just cloned" into a *validated*
// project specification. Downstream stages (bundler, validator, gradle)
// MUST read facts from this spec instead of re-discovering them.
//
// Two error categories are first-class:
//   - ProjectError: the user's project does not meet a requirement.
//                   Surface to the user verbatim.
//   - SystemError:  something in the build pipeline itself broke.
//                   Show a generic message to the user; keep the
//                   technical detail in CI logs only.
//
// The pipeline never patches, generates, repairs, or substitutes any
// part of the user's project. The gate either accepts the repository
// as-is or rejects it with a list of plain-English reasons.

export type IssueSeverity = "error" | "warn";

export interface InspectionIssue {
    /** Stable code, e.g. "no_package_json", "missing_react_native". */
    code: string;
    severity: IssueSeverity;
    /** Human-readable, safe to show to the user. */
    message: string;
    /** Optional structured detail (paths, versions, etc.). */
    details?: Record<string, unknown>;
}

/**
 * Backwards-compatible alias. Older modules referenced `CheckIssue`; the
 * new descriptive name is `InspectionIssue`.
 */
export type CheckIssue = InspectionIssue;

export interface ProjectFacts {
    // package.json
    has_package_json: boolean;
    package_name?: string;
    package_version?: string;
    // React Native
    react_native_version?: string;
    is_expo: boolean;
    expo_version?: string;
    // Entry / config files (relative to project root)
    entry_file?: string;        // e.g. "index.js"
    babel_config?: string;
    metro_config?: string;
    tsconfig?: string;
    rn_config?: string;         // "react-native.config.js"
    // Engines / runtime
    js_engine: "hermes" | "jsc" | "unknown";
    // Dependencies snapshot (post-install)
    node_modules_present: boolean;
    rn_native_modules: string[];     // autolinked modules detected
    asset_dirs: string[];            // ["assets", "src/assets", ...]
    // Strict-mode hard requirements
    has_user_android_dir: boolean;   // MUST be true in strict mode
    has_user_ios_dir: boolean;       // informational only
}

/**
 * One reasoned finding from the threat scanner. Critical findings cause
 * an immediate reject; "warn" findings are surfaced in the transparency
 * report but do not block the build.
 */
export interface ThreatFinding {
    /** Stable code, e.g. "credential_harvest", "exfil_endpoint". */
    code: string;
    severity: "critical" | "warn";
    /** Plain-English description shown to the user. */
    message: string;
    /** Project-relative path of the file that triggered the finding. */
    file: string;
    /** 1-indexed line number, when known. */
    line?: number;
    /** Short snippet for context — never raw secret material. */
    excerpt?: string;
}

export interface ThreatReport {
    scanned_files: number;
    skipped_files: number;
    skipped_reasons: Record<string, number>;
    duration_ms: number;
    findings: ThreatFinding[];
    critical_count: number;
    warn_count: number;
}

/**
 * Strict gate decision. The workflow reads `gate.accepted`; if false it
 * marks the job failed (project-error kind) with `gate.reasons` as the
 * diagnostic and never advances to bundle / gradle.
 */
export interface StrictGateDecision {
    accepted: boolean;
    /** Absolute path to the user's android/ root when accepted. */
    android_root: string | null;
    /** First-class reasons for rejection, in display order. */
    reasons: InspectionIssue[];
    /** Aggregated stats for the transparency report. */
    summary: {
        project_issues: number;
        threat_critical: number;
        threat_warn: number;
        android_blocking_issues: number;
    };
}

export interface ProjectSpec {
    ok: boolean;                     // false if any "error" severity issue
    generated_at: string;            // ISO timestamp
    project_root: string;
    facts: ProjectFacts;
    issues: InspectionIssue[];       // both errors and warnings
    /** The first hard error, for one-line summaries. */
    primary_error?: InspectionIssue;
    /** Deep android-evidence report (only populated when has_user_android_dir). */
    android_evidence?: unknown;
    /** Threat scanner report. */
    threat_report?: ThreatReport;
    /** Strict-gate decision combining all of the above. */
    gate?: StrictGateDecision;
}
