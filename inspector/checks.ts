// SAMP Apps — Inspector checks (strict-mode pipeline).
//
// Every export here is a focused, side-effect-free fact extractor. The
// orchestrator in inspector/index.ts composes them into a ProjectSpec.
//
// Strict-mode requirements (HARD; failure ⇒ project error, exit 2):
//   1. package.json present and parseable
//   2. react-native declared in dependencies
//   3. Detectable JS entry file (or App.{js,jsx,ts,tsx})
//   4. node_modules present (post-install)
//   5. android/ directory present at the project root
//
// Soft signals (informational; never blocking):
//   - ios/ directory presence
//   - Hermes / JSC engine selection
//   - Asset directories

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { InspectionIssue, ProjectFacts } from "./types";

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function readJsonOrNull<T = unknown>(target: string): Promise<T | null> {
    try {
        const raw = await fs.readFile(target, "utf8");
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

interface PackageJsonShape {
    name?: string;
    version?: string;
    main?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

export interface PackageJsonFacts {
    present: boolean;
    parseable: boolean;
    name?: string;
    version?: string;
    main?: string;
    react_native_version?: string;
    is_expo: boolean;
    expo_version?: string;
    raw?: PackageJsonShape;
}

export async function readPackageJson(projectRoot: string): Promise<PackageJsonFacts> {
    const pkgPath = path.join(projectRoot, "package.json");
    if (!(await pathExists(pkgPath))) {
        return { present: false, parseable: false, is_expo: false };
    }
    const data = await readJsonOrNull<PackageJsonShape>(pkgPath);
    if (!data || typeof data !== "object") {
        return { present: true, parseable: false, is_expo: false };
    }
    const deps = { ...(data.dependencies ?? {}), ...(data.devDependencies ?? {}) };
    const rnVersion = deps["react-native"];
    const expoVersion = deps["expo"];
    return {
        present: true,
        parseable: true,
        name: data.name,
        version: data.version,
        main: data.main,
        react_native_version: rnVersion,
        is_expo: typeof expoVersion === "string",
        expo_version: expoVersion,
        raw: data,
    };
}

export async function detectEntryFile(
    projectRoot: string,
    pkgMain: string | undefined,
): Promise<string | undefined> {
    if (pkgMain && (await pathExists(path.join(projectRoot, pkgMain)))) {
        return pkgMain;
    }
    const candidates = [
        "index.js",
        "index.tsx",
        "index.ts",
        "App.js",
        "App.tsx",
        "App.ts",
        "src/index.js",
        "src/index.tsx",
        "src/App.js",
        "src/App.tsx",
    ];
    for (const candidate of candidates) {
        if (await pathExists(path.join(projectRoot, candidate))) {
            return candidate;
        }
    }
    return undefined;
}

export async function detectConfigFiles(projectRoot: string): Promise<{
    babel_config?: string;
    metro_config?: string;
    tsconfig?: string;
    rn_config?: string;
}> {
    const result: {
        babel_config?: string;
        metro_config?: string;
        tsconfig?: string;
        rn_config?: string;
    } = {};
    const lookups: Array<[keyof typeof result, string[]]> = [
        ["babel_config", ["babel.config.js", "babel.config.cjs", ".babelrc", ".babelrc.js"]],
        ["metro_config", ["metro.config.js", "metro.config.cjs"]],
        ["tsconfig",     ["tsconfig.json"]],
        ["rn_config",    ["react-native.config.js", "react-native.config.cjs"]],
    ];
    for (const [key, candidates] of lookups) {
        for (const candidate of candidates) {
            if (await pathExists(path.join(projectRoot, candidate))) {
                result[key] = candidate;
                break;
            }
        }
    }
    return result;
}

export async function detectJsEngine(
    projectRoot: string,
): Promise<"hermes" | "jsc" | "unknown"> {
    const propsPath = path.join(projectRoot, "android", "gradle.properties");
    if (await pathExists(propsPath)) {
        const text = await fs.readFile(propsPath, "utf8");
        if (/^hermesEnabled\s*=\s*true/m.test(text)) return "hermes";
        if (/^hermesEnabled\s*=\s*false/m.test(text)) return "jsc";
    }
    return "unknown";
}

export async function detectAssetDirs(projectRoot: string): Promise<string[]> {
    const candidates = ["assets", "src/assets", "app/assets"];
    const found: string[] = [];
    for (const candidate of candidates) {
        if (await pathExists(path.join(projectRoot, candidate))) found.push(candidate);
    }
    return found;
}

export async function detectAutolinkedNativeModules(projectRoot: string): Promise<string[]> {
    const nodeModules = path.join(projectRoot, "node_modules");
    if (!(await pathExists(nodeModules))) return [];
    const entries = await fs.readdir(nodeModules, { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "react-native") continue;
        if (entry.name.startsWith("@")) {
            const scopeRoot = path.join(nodeModules, entry.name);
            const scopeEntries = await fs.readdir(scopeRoot, { withFileTypes: true });
            for (const sub of scopeEntries) {
                if (!sub.isDirectory()) continue;
                if (await modulePublishesAndroidPackage(path.join(scopeRoot, sub.name))) {
                    found.push(`${entry.name}/${sub.name}`);
                }
            }
            continue;
        }
        if (await modulePublishesAndroidPackage(path.join(nodeModules, entry.name))) {
            found.push(entry.name);
        }
    }
    return found.sort();
}

async function modulePublishesAndroidPackage(moduleRoot: string): Promise<boolean> {
    const androidDir = path.join(moduleRoot, "android");
    if (!(await pathExists(androidDir))) return false;
    const buildGradle = path.join(androidDir, "build.gradle");
    return pathExists(buildGradle);
}

/**
 * Build the strict project facts AND the issue list. The first issue with
 * severity "error" becomes the primary reject reason.
 */
export async function inspectStrict(projectRoot: string): Promise<{
    facts: ProjectFacts;
    issues: InspectionIssue[];
}> {
    const issues: InspectionIssue[] = [];

    const pkg = await readPackageJson(projectRoot);
    if (!pkg.present) {
        issues.push({
            code: "no_package_json",
            severity: "error",
            message: "package.json is missing at the project root.",
        });
    } else if (!pkg.parseable) {
        issues.push({
            code: "package_json_invalid",
            severity: "error",
            message: "package.json could not be parsed as JSON.",
        });
    }

    if (pkg.parseable && !pkg.react_native_version) {
        issues.push({
            code: "missing_react_native",
            severity: "error",
            message: "package.json does not declare 'react-native' as a dependency.",
        });
    }

    const entryFile = await detectEntryFile(projectRoot, pkg.main);
    if (!entryFile) {
        issues.push({
            code: "no_entry_file",
            severity: "error",
            message: "No JavaScript entry file detected (looked for index.js, App.{js,tsx,ts}, src/index.*).",
        });
    }

    const configs = await detectConfigFiles(projectRoot);
    const jsEngine = await detectJsEngine(projectRoot);
    const assetDirs = await detectAssetDirs(projectRoot);

    const nodeModulesPresent = await pathExists(path.join(projectRoot, "node_modules"));
    if (!nodeModulesPresent) {
        issues.push({
            code: "node_modules_missing",
            severity: "error",
            message: "node_modules is missing — installation step did not complete.",
        });
    }

    const hasUserAndroidDir = await pathExists(path.join(projectRoot, "android"));
    if (!hasUserAndroidDir) {
        issues.push({
            code: "no_android_directory",
            severity: "error",
            message:
                "Strict mode requires a complete android/ directory at the project root. " +
                "SAMP Apps does not generate or patch Android projects.",
        });
    }

    const hasUserIosDir = await pathExists(path.join(projectRoot, "ios"));

    const rnNativeModules = nodeModulesPresent
        ? await detectAutolinkedNativeModules(projectRoot)
        : [];

    const facts: ProjectFacts = {
        has_package_json: pkg.present,
        package_name: pkg.name,
        package_version: pkg.version,
        react_native_version: pkg.react_native_version,
        is_expo: pkg.is_expo,
        expo_version: pkg.expo_version,
        entry_file: entryFile,
        babel_config: configs.babel_config,
        metro_config: configs.metro_config,
        tsconfig: configs.tsconfig,
        rn_config: configs.rn_config,
        js_engine: jsEngine,
        node_modules_present: nodeModulesPresent,
        rn_native_modules: rnNativeModules,
        asset_dirs: assetDirs,
        has_user_android_dir: hasUserAndroidDir,
        has_user_ios_dir: hasUserIosDir,
    };

    if (pkg.is_expo && !hasUserAndroidDir) {
        // Soft message clarifying *why* an otherwise-fine Expo app rejects
        // when it has been submitted as bare React Native instead of
        // through the Expo (managed) workflow that auto-prebuilds.
        issues.push({
            code: "expo_managed_unsupported",
            severity: "warn",
            message:
                "Expo project detected without a committed android/ directory. " +
                "Re-submit this build with the \"Expo (managed)\" project type so " +
                "SAMP Apps runs `expo prebuild` for you, or run " +
                "`npx expo prebuild --platform android`, commit android/, and " +
                "submit it as \"Expo (prebuild committed)\".",
        });
    }

    return { facts, issues };
}
