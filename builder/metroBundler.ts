// SAMP Apps — Metro bundler wrapper (strict-mode pipeline).
//
// Drives Metro to produce the JavaScript bundle and resource assets the
// APK will ship. The entry file is taken from project-spec.json; the
// android root is taken from the strict gate (project-spec.json's
// `gate.android_root`). The output is written directly into the user's
// android/app/src/main/{assets,res} so Gradle picks it up without any
// intermediate copy.
//
// Verification: after Metro returns, the bundle file is stat'd; an
// absent or zero-byte bundle aborts the pipeline with an explicit system
// error rather than letting Gradle assemble a JS-less APK.

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface BundleOptions {
    projectRoot: string;
    androidRoot: string;
    entryFile: string;
    platform?: "android" | "ios";
    dev?: boolean;
}

export interface BundleResult {
    bundlePath: string;
    assetsPath: string;
    sourcemapPath: string;
    sizeBytes: number;
    durationMs: number;
}

function runChildProcess(command: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
        child.on("error", reject);
        child.on("close", (code) =>
            code === 0
                ? resolve()
                : reject(new Error(`${command} exited with code ${code}`)),
        );
    });
}

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

export async function metroBundle(options: BundleOptions): Promise<BundleResult> {
    const platform = options.platform ?? "android";
    const dev = options.dev ?? false;
    if (!options.entryFile) {
        throw new Error("metroBundle: entryFile is required (read it from project-spec.json)");
    }
    if (!options.androidRoot) {
        throw new Error("metroBundle: androidRoot is required (read it from project-spec.json gate)");
    }

    const bundleDir = path.join(options.androidRoot, "app", "src", "main", "assets");
    const resourcesDir = path.join(options.androidRoot, "app", "src", "main", "res");

    await fs.mkdir(bundleDir, { recursive: true });
    await fs.mkdir(resourcesDir, { recursive: true });

    const bundlePath = path.join(bundleDir, "index.android.bundle");
    const sourcemapPath = path.join(bundleDir, "index.android.bundle.map");

    const args = [
        "react-native", "bundle",
        "--platform", platform,
        "--dev", String(dev),
        "--entry-file", options.entryFile,
        "--bundle-output", bundlePath,
        "--assets-dest", resourcesDir,
        "--sourcemap-output", sourcemapPath,
        "--minify", String(!dev),
    ];

    console.log("[metro] ──────── bundle plan ────────");
    console.log(`[metro] project_root : ${path.resolve(options.projectRoot)}`);
    console.log(`[metro] android_root : ${options.androidRoot}`);
    console.log(`[metro] entry        : ${options.entryFile}`);
    console.log(`[metro] bundle_out   : ${bundlePath}`);
    console.log(`[metro] assets_out   : ${resourcesDir}`);
    console.log(`[metro] platform     : ${platform}, dev=${dev}`);
    console.log("[metro] ────────────────────────────");

    const startedAt = Date.now();
    await runChildProcess("npx", args, path.resolve(options.projectRoot));

    if (!(await pathExists(bundlePath))) {
        throw new Error(`[metro] bundle was not created at ${bundlePath}`);
    }
    const stat = await fs.stat(bundlePath);
    if (stat.size === 0) {
        throw new Error(`[metro] bundle at ${bundlePath} is 0 bytes — refusing to continue`);
    }
    const result: BundleResult = {
        bundlePath,
        assetsPath: resourcesDir,
        sourcemapPath,
        sizeBytes: stat.size,
        durationMs: Date.now() - startedAt,
    };
    console.log(`[metro] ✓ bundle ready (${stat.size} bytes in ${result.durationMs}ms)`);
    return result;
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const positional = argv.filter((arg) => !arg.startsWith("--"));
    const projectRoot = positional[0] ?? process.cwd();
    const specIndex = argv.indexOf("--spec");
    const androidIndex = argv.indexOf("--android-root");
    const specPath = specIndex >= 0 ? argv[specIndex + 1] : undefined;
    let androidRoot = androidIndex >= 0 ? argv[androidIndex + 1] : undefined;

    (async () => {
        if (!specPath) {
            console.error("[metro] --spec <project-spec.json> is required (no entry-file guessing)");
            process.exit(64);
            return;
        }
        let entryFile: string | undefined;
        try {
            const spec = JSON.parse(await fs.readFile(specPath, "utf8"));
            entryFile = spec?.facts?.entry_file;
            if (!entryFile) throw new Error(`spec ${specPath} contains no facts.entry_file`);
            if (!androidRoot) {
                androidRoot = spec?.gate?.android_root ?? path.join(spec?.project_root ?? projectRoot, "android");
            }
            console.log(`[metro] inspection-confirmed entry: ${entryFile}`);
            console.log(`[metro] gate-confirmed android_root: ${androidRoot}`);
        } catch (error) {
            console.error("[metro] failed to read spec", error);
            process.exit(1);
            return;
        }
        try {
            await metroBundle({
                projectRoot,
                androidRoot: androidRoot!,
                entryFile: entryFile!,
            });
        } catch (error) {
            console.error("[metro] failed", error);
            process.exit(1);
        }
    })();
}
