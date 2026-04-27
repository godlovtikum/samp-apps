// SAMP Apps — Inspector orchestrator (strict-mode pipeline).
//
// Composes the focused checks from checks.ts, runs the threat scanner,
// computes the strict gate decision, and writes a single ProjectSpec
// JSON report. The CLI exit code carries the verdict so the GitHub
// Actions workflow can route on it without parsing the JSON:
//
//     0  →  ACCEPTED                   (proceed to bundle / gradle)
//     2  →  PROJECT REJECTED           (user-facing diagnostic; final)
//     1  →  SYSTEM CRASH               (CI-side incident)
//
// Usage:
//     ts-node inspector/index.ts <project-root> <out-spec.json>

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { inspectStrict } from "./checks";
import { scanProjectForThreats } from "./threatScan";
import { decideStrictGate } from "./strictGate";
import { ProjectSpec } from "./types";

async function inspectProject(projectRoot: string): Promise<ProjectSpec> {
    const absoluteRoot = path.resolve(projectRoot);
    const generatedAt = new Date().toISOString();

    const { facts, issues } = await inspectStrict(absoluteRoot);
    const threatReport = await scanProjectForThreats(absoluteRoot);
    const { decision, androidEvidence } = await decideStrictGate({
        projectRoot: absoluteRoot,
        facts,
        inspectionIssues: issues,
        threatReport,
    });

    const allIssues = [...issues, ...decision.reasons.filter(
        (reason) => !issues.some((issue) => issue.message === reason.message),
    )];

    const primaryError = allIssues.find((issue) => issue.severity === "error");
    const ok = decision.accepted && !primaryError;

    return {
        ok,
        generated_at: generatedAt,
        project_root: absoluteRoot,
        facts,
        issues: allIssues,
        primary_error: primaryError,
        android_evidence: androidEvidence ?? undefined,
        threat_report: threatReport,
        gate: decision,
    };
}

async function writeSpec(spec: ProjectSpec, outPath: string): Promise<void> {
    await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(spec, null, 2));
}

function printSummary(spec: ProjectSpec): void {
    console.log("[inspect] ──────── strict inspection ────────");
    console.log(`[inspect] project_root : ${spec.project_root}`);
    console.log(`[inspect] react_native : ${spec.facts.react_native_version ?? "(undeclared)"}`);
    console.log(`[inspect] entry_file   : ${spec.facts.entry_file ?? "(none)"}`);
    console.log(`[inspect] android dir  : ${spec.facts.has_user_android_dir ? "present" : "MISSING"}`);
    console.log(`[inspect] threat scan  : ${spec.threat_report?.critical_count ?? 0} critical, ${spec.threat_report?.warn_count ?? 0} warn`);
    console.log(`[inspect] verdict      : ${spec.gate?.accepted ? "ACCEPTED" : "REJECTED"}`);
    if (!spec.gate?.accepted) {
        for (const reason of spec.gate?.reasons ?? []) {
            console.log(`[inspect]   ✗ ${reason.code}: ${reason.message}`);
        }
    }
    console.log("[inspect] ────────────────────────────────────");
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const projectRoot = argv[0];
    const outPath = argv[1];
    if (!projectRoot || !outPath) {
        console.error("usage: inspector <project-root> <out-spec.json>");
        process.exit(64);
    }
    inspectProject(projectRoot)
        .then(async (spec) => {
            await writeSpec(spec, outPath);
            printSummary(spec);
            if (!spec.gate?.accepted) process.exit(2);
            process.exit(0);
        })
        .catch((error) => {
            console.error("[inspect] crashed:", error);
            process.exit(1);
        });
}

export { inspectProject };
