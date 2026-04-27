// SAMP Apps — Post-bundle validator.
//
// Re-runs the android-contents inspection AFTER Metro has written the
// JS bundle into android/app/src/main/assets, plus the bundle health
// checks the bundler stage already enforced. The strict gate has
// already accepted the project; this stage only catches the rare case
// where the bundle write itself disturbed the Android tree (permissions,
// partial writes, race conditions on slow disks).
//
// Every check is hard. Failure here is a system error, not a project
// error: the gate already approved the repository.
//
// Usage:
//     ts-node validator/index.ts <android-root> [--no-bundle]
//
// Exit codes:
//     0  every must-pass check passed
//     1  at least one must-pass check failed

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { inspectAndroidContents } from "../inspector/inspectAndroidContents";

interface ValidationCheck {
    name: string;
    ok: boolean;
    detail: string;
    must_pass: boolean;
}

interface ValidationReport {
    android_root: string;
    ok: boolean;
    checks: ValidationCheck[];
    blocking_issues: string[];
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function fileSize(target: string): Promise<number> {
    try {
        return (await fs.stat(target)).size;
    } catch {
        return -1;
    }
}

export async function validateAndroidRoot(
    androidRoot: string,
    options: { requireBundle: boolean } = { requireBundle: true },
): Promise<ValidationReport> {
    const absoluteRoot = path.resolve(androidRoot);
    const checks: ValidationCheck[] = [];

    if (!(await pathExists(absoluteRoot))) {
        checks.push({
            name: "android_root_present",
            ok: false,
            must_pass: true,
            detail: `${absoluteRoot} does not exist`,
        });
        return {
            android_root: absoluteRoot,
            ok: false,
            checks,
            blocking_issues: ["android root path does not exist"],
        };
    }
    checks.push({
        name: "android_root_present",
        ok: true,
        must_pass: true,
        detail: absoluteRoot,
    });

    const evidence = await inspectAndroidContents(absoluteRoot);
    const requiredFiles: Array<{ name: string; relativePath: string }> = [
        { name: "settings_gradle",   relativePath: evidence.settings.resolved_path ?? "settings.gradle" },
        { name: "root_build_gradle", relativePath: evidence.root_build.resolved_path ?? "build.gradle" },
        { name: "app_build_gradle",  relativePath: evidence.app_build.resolved_path ?? "app/build.gradle" },
        { name: "android_manifest",  relativePath: "app/src/main/AndroidManifest.xml" },
        { name: "gradle_properties", relativePath: "gradle.properties" },
        { name: "gradlew",           relativePath: "gradlew" },
        { name: "gradle_wrapper_jar",  relativePath: "gradle/wrapper/gradle-wrapper.jar" },
        { name: "gradle_wrapper_props", relativePath: "gradle/wrapper/gradle-wrapper.properties" },
    ];
    for (const required of requiredFiles) {
        const absolute = path.join(absoluteRoot, required.relativePath);
        const present = await pathExists(absolute);
        const size = present ? await fileSize(absolute) : -1;
        checks.push({
            name: required.name,
            ok: present && size > 0,
            must_pass: true,
            detail: present ? `${size} bytes (${required.relativePath})` : `missing: ${required.relativePath}`,
        });
    }

    if (options.requireBundle) {
        const bundlePath = path.join(absoluteRoot, "app", "src", "main", "assets", "index.android.bundle");
        const bundleSize = await fileSize(bundlePath);
        checks.push({
            name: "metro_bundle",
            ok: bundleSize > 0,
            must_pass: true,
            detail: bundleSize > 0
                ? `${bundleSize} bytes`
                : "missing or empty: app/src/main/assets/index.android.bundle",
        });
    }

    const ok = checks.every((check) => !check.must_pass || check.ok);
    return {
        android_root: absoluteRoot,
        ok,
        checks,
        blocking_issues: evidence.blocking_issues,
    };
}

function printReport(report: ValidationReport): void {
    console.log("[validate] ──────── strict validation ────────");
    console.log(`[validate] android_root : ${report.android_root}`);
    for (const check of report.checks) {
        const tag = check.ok ? "✓" : check.must_pass ? "✗" : "·";
        console.log(`[validate]   ${tag} ${check.name.padEnd(28)} ${check.detail}`);
    }
    console.log(`[validate] verdict      : ${report.ok ? "OK" : "FAILED"}`);
    console.log("[validate] ────────────────────────────────────");
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const positional = argv.filter((arg) => !arg.startsWith("--"));
    const androidRoot = positional[0];
    const requireBundle = !argv.includes("--no-bundle");
    if (!androidRoot) {
        console.error("usage: validator <android-root> [--no-bundle]");
        process.exit(64);
    }
    validateAndroidRoot(androidRoot, { requireBundle })
        .then((report) => {
            printReport(report);
            process.exit(report.ok ? 0 : 1);
        })
        .catch((error) => {
            console.error("[validate] crashed:", error);
            process.exit(1);
        });
}
