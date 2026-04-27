// SAMP Apps — Pre-Gradle health gate (strict-mode pipeline).
//
// The final pre-execution gate before Gradle. Verifies that everything
// Gradle needs to launch (JDK, gradlew, wrapper jar, wrapper properties)
// is present and well-formed. In strict mode there is NO automatic
// staging — if the wrapper is unhealthy here, the strict gate already
// missed something and the pipeline exits as a system error.
//
// Usage:
//     ts-node pipeline/preGradleHealth.ts <android-root> [--out <report.json>]
//
// Exit codes:
//     0   every must-pass check passed
//     1   at least one must-pass check failed

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

interface HealthCheck {
    name: string;
    ok: boolean;
    detail: string;
    must_pass: boolean;
}

interface HealthReport {
    android_root: string;
    ok: boolean;
    checks: HealthCheck[];
    java_home: string | null;
    java_version: string | null;
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

async function readHead(target: string, byteCount = 256): Promise<string> {
    const handle = await fs.open(target, "r");
    try {
        const buffer = Buffer.alloc(byteCount);
        const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
        return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
        await handle.close();
    }
}

async function jarContainsEntry(jarPath: string, entryName: string): Promise<boolean> {
    const buffer = await fs.readFile(jarPath);
    let endOfCentralDirectory = -1;
    for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index--) {
        if (buffer.readUInt32LE(index) === 0x06054b50) {
            endOfCentralDirectory = index;
            break;
        }
    }
    if (endOfCentralDirectory < 0) return false;
    const totalEntries = buffer.readUInt16LE(endOfCentralDirectory + 10);
    let pointer = buffer.readUInt32LE(endOfCentralDirectory + 16);
    for (let entry = 0; entry < totalEntries; entry++) {
        if (buffer.readUInt32LE(pointer) !== 0x02014b50) return false;
        const fileNameLength = buffer.readUInt16LE(pointer + 28);
        const extraLength = buffer.readUInt16LE(pointer + 30);
        const commentLength = buffer.readUInt16LE(pointer + 32);
        const name = buffer.slice(pointer + 46, pointer + 46 + fileNameLength).toString("utf8");
        if (name === entryName) return true;
        pointer += 46 + fileNameLength + extraLength + commentLength;
    }
    return false;
}

export async function checkGradleHealth(androidRoot: string): Promise<HealthReport> {
    const root = path.resolve(androidRoot);
    const checks: HealthCheck[] = [];

    // --- JDK -------------------------------------------------------------
    let javaHome = process.env.JAVA_HOME ?? null;
    let javaBinary: string | null = null;
    if (javaHome && (await pathExists(path.join(javaHome, "bin", "java")))) {
        javaBinary = path.join(javaHome, "bin", "java");
    } else {
        const which = spawnSync("sh", ["-c", "command -v java"], { encoding: "utf8" });
        if (which.status === 0 && which.stdout.trim()) javaBinary = which.stdout.trim();
    }
    let javaVersion: string | null = null;
    if (javaBinary) {
        const versionResult = spawnSync(javaBinary, ["-version"], { encoding: "utf8" });
        javaVersion = ((versionResult.stderr || versionResult.stdout) ?? "")
            .split("\n")[0]
            ?.trim() || null;
    }
    checks.push({
        name: "java_runtime",
        ok: !!javaBinary,
        must_pass: true,
        detail: javaBinary
            ? `${javaBinary} (${javaVersion ?? "version unknown"})`
            : "no JAVA_HOME and no 'java' on PATH",
    });

    // --- gradlew ---------------------------------------------------------
    const gradlewPath = path.join(root, "gradlew");
    const gradlewExists = await pathExists(gradlewPath);
    let gradlewSize = -1;
    let shebang: string | null = null;
    let containsCarriageReturn = false;
    if (gradlewExists) {
        gradlewSize = await fileSize(gradlewPath);
        const head = await readHead(gradlewPath);
        shebang = head.split(/\r?\n/)[0] ?? "";
        containsCarriageReturn = head.includes("\r");
    }
    checks.push({
        name: "gradlew_present",
        ok: gradlewExists && gradlewSize >= 256,
        must_pass: true,
        detail: gradlewExists ? `${gradlewSize} bytes` : "absent",
    });
    checks.push({
        name: "gradlew_shebang",
        ok: gradlewExists && !!shebang && shebang.startsWith("#!"),
        must_pass: true,
        detail: gradlewExists ? (shebang || "(empty)") : "(no gradlew)",
    });
    checks.push({
        name: "gradlew_line_endings",
        ok: gradlewExists && !containsCarriageReturn,
        must_pass: true,
        detail: gradlewExists
            ? (containsCarriageReturn ? "CR characters detected" : "LF")
            : "(no gradlew)",
    });

    // --- wrapper jar / properties ---------------------------------------
    const jarPath = path.join(root, "gradle", "wrapper", "gradle-wrapper.jar");
    const propertiesPath = path.join(root, "gradle", "wrapper", "gradle-wrapper.properties");
    const jarSize = await fileSize(jarPath);
    const propertiesSize = await fileSize(propertiesPath);
    checks.push({
        name: "gradle_wrapper_jar",
        ok: jarSize > 4096,
        must_pass: true,
        detail: jarSize > 0 ? `${jarSize} bytes` : "absent or empty",
    });
    let containsWrapperMainClass = false;
    let mainClassDetail = "(no jar)";
    if (jarSize > 0) {
        try {
            containsWrapperMainClass = await jarContainsEntry(
                jarPath,
                "org/gradle/wrapper/GradleWrapperMain.class",
            );
            mainClassDetail = containsWrapperMainClass
                ? "present"
                : "missing GradleWrapperMain.class";
        } catch (error: unknown) {
            mainClassDetail = `inspection failed: ${(error as Error)?.message ?? String(error)}`;
        }
    }
    checks.push({
        name: "gradle_wrapper_main_class",
        ok: containsWrapperMainClass,
        must_pass: true,
        detail: mainClassDetail,
    });
    checks.push({
        name: "gradle_wrapper_properties",
        ok: propertiesSize > 0,
        must_pass: true,
        detail: propertiesSize > 0 ? `${propertiesSize} bytes` : "absent or empty",
    });

    const ok = checks.every((check) => !check.must_pass || check.ok);
    return {
        android_root: root,
        ok,
        checks,
        java_home: javaHome,
        java_version: javaVersion,
    };
}

function printReport(report: HealthReport): void {
    console.log("[pre-gradle] ──────── pre-Gradle health ────────");
    console.log(`[pre-gradle] android_root : ${report.android_root}`);
    console.log(`[pre-gradle] JAVA_HOME    : ${report.java_home ?? "(unset)"}`);
    for (const check of report.checks) {
        const tag = check.ok ? "✓" : check.must_pass ? "✗" : "·";
        console.log(`[pre-gradle]   ${tag} ${check.name.padEnd(28)} ${check.detail}`);
    }
    console.log("[pre-gradle] ───────────────────────────────────");
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const root = argv.find((arg) => !arg.startsWith("--"));
    const outIndex = argv.indexOf("--out");
    const outPath = outIndex >= 0 ? argv[outIndex + 1] : null;
    if (!root) {
        console.error("usage: preGradleHealth <android-root> [--out <report.json>]");
        process.exit(64);
    }
    checkGradleHealth(root)
        .then(async (report) => {
            printReport(report);
            if (outPath) await fs.writeFile(outPath, JSON.stringify(report, null, 2));
            process.exit(report.ok ? 0 : 1);
        })
        .catch((error) => {
            console.error("[pre-gradle] crashed:", error);
            process.exit(1);
        });
}
