/**
 * inspector/inspectAndroidContents.ts
 *
 * Capability-level inspection of a user's android/ directory.
 *
 * The strict gate uses the structured evidence returned here to decide
 * whether the project is buildable as-is. Inspection is read-only and
 * never modifies the user's files. Anything missing is reported as a
 * blocking issue with a sentence the user can act on.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

async function exists(targetPath: string): Promise<boolean> {
    try { await fs.access(targetPath); return true; } catch { return false; }
}
async function readFileOrNull(targetPath: string): Promise<string | null> {
    try { return await fs.readFile(targetPath, "utf8"); } catch { return null; }
}
async function fileSize(targetPath: string): Promise<number> {
    try { return (await fs.stat(targetPath)).size; } catch { return -1; }
}

export interface FileEvidence {
    present: boolean;
    resolved_path: string | null;
    size_bytes: number;
    issues: string[];
}
export interface SettingsEvidence extends FileEvidence {
    includes_app: boolean;
    applies_native_modules_autolinking: boolean;
    root_project_name: string | null;
    /**
     * True when settings.gradle uses the React Native ≥ 0.75 settings
     * plugin flow (extensions.configure(ReactSettingsExtension),
     * id("com.facebook.react.settings"), or autolinkLibrariesFromCommand).
     * If the project's RN version is older, that class does not exist
     * on the classpath and Gradle dies before any task runs.
     */
    uses_modern_react_settings_extension: boolean;
    /**
     * True when settings.gradle declares a pluginManagement { … } block
     * that registers @react-native/gradle-plugin (modern path) or the
     * older react-native-gradle-plugin coordinate. Required by RN ≥ 0.71
     * projects whose app/build.gradle applies the com.facebook.react
     * plugin: without it Gradle dies with
     *   Plugin [id: 'com.facebook.react'] was not found.
     */
    declares_pluginmanagement_for_rngp: boolean;
}
export interface AppGradleEvidence extends FileEvidence {
    applies_android_application_plugin: boolean;
    applies_react_native_plugin: boolean;
    has_react_block: boolean;
    application_id: string | null;
    namespace: string | null;
}
export interface ManifestEvidence extends FileEvidence {
    package_attribute: string | null;
    has_application_node: boolean;
    has_launcher_activity: boolean;
    declared_permissions: string[];
}
export interface GradlePropertiesEvidence extends FileEvidence {
    hermes_enabled: boolean | null;
    new_arch_enabled: boolean | null;
    use_androidx: boolean | null;
}
export interface WrapperEvidence {
    gradlew_present: boolean;
    gradlew_size: number;
    gradlew_has_crlf: boolean;
    wrapper_jar_present: boolean;
    wrapper_jar_size: number;
    wrapper_properties_present: boolean;
    distribution_url: string | null;
    issues: string[];
}
export interface JavaSourcesEvidence {
    main_application_present: boolean;
    main_activity_present: boolean;
    detected_package: string | null;
    issues: string[];
}
export interface ResValuesEvidence {
    strings_xml_present: boolean;
    defines_app_name: boolean;
    styles_xml_present: boolean;
    defines_app_theme: boolean;
    issues: string[];
}

export interface AndroidContentEvidence {
    has_dir: boolean;
    android_root: string;
    settings: SettingsEvidence;
    root_build: FileEvidence;
    app_build: AppGradleEvidence;
    manifest: ManifestEvidence;
    gradle_properties: GradlePropertiesEvidence;
    wrapper: WrapperEvidence;
    java_sources: JavaSourcesEvidence;
    res_values: ResValuesEvidence;
    /** Aggregated, human-readable list of every issue across files. */
    all_issues: string[];
    /** Issues that block the build. In strict mode, every issue is blocking. */
    blocking_issues: string[];
}

const EMPTY_FILE: FileEvidence = { present: false, resolved_path: null, size_bytes: 0, issues: [] };

async function pickFile(rootPath: string, candidates: string[]): Promise<{ rel: string; abs: string } | null> {
    for (const candidate of candidates) {
        const absolutePath = path.join(rootPath, candidate);
        if (await exists(absolutePath)) return { rel: candidate, abs: absolutePath };
    }
    return null;
}

async function inspectSettings(rootPath: string): Promise<SettingsEvidence> {
    const found = await pickFile(rootPath, ["settings.gradle", "settings.gradle.kts"]);
    if (!found) {
        return {
            ...EMPTY_FILE,
            issues: ["The Android settings.gradle file is missing."],
            includes_app: false,
            applies_native_modules_autolinking: false,
            root_project_name: null,
            uses_modern_react_settings_extension: false,
            declares_pluginmanagement_for_rngp: false,
        };
    }
    const fileContents = (await readFileOrNull(found.abs)) ?? "";
    const includesApp = /include\s*[(]?\s*["']:?app["']/.test(fileContents);
    // Accept every form Gradle supports for applying RN autolinking:
    //   apply from: "…/native_modules.gradle"
    //   apply from: file("…/native_modules.gradle")
    //   apply(from = "…/native_modules.gradle")          // Kotlin DSL
    //   apply(from = file("…/native_modules.gradle"))    // Kotlin DSL
    const appliesAutolink = /apply[\s(]+from[\s=:]+(?:file\s*\(\s*)?["'][^"']*native_modules\.gradle["']/.test(fileContents);
    const rootNameMatch = fileContents.match(/rootProject\.name\s*=\s*["']([^"']+)["']/);

    const usesReactSettingsExtensionConfigure =
        /extensions\.configure\s*\(\s*com\.facebook\.react\.ReactSettingsExtension\b/.test(fileContents);
    const usesReactSettingsPluginId =
        /id\s*\(?\s*["']com\.facebook\.react\.settings["']/.test(fileContents);
    const usesAutolinkLibrariesFromCommand =
        /\bautolinkLibrariesFromCommand\s*\(/.test(fileContents);
    const usesModernReactSettingsExtension =
        usesReactSettingsExtensionConfigure || usesReactSettingsPluginId || usesAutolinkLibrariesFromCommand;

    let declaresPluginManagementForRngp = false;
    const pluginManagementHeader = /\bpluginManagement\s*\{/g;
    let pluginManagementMatch: RegExpExecArray | null;
    while ((pluginManagementMatch = pluginManagementHeader.exec(fileContents)) !== null) {
        const openBraceIndex = fileContents.indexOf("{", pluginManagementMatch.index + pluginManagementMatch[0].length - 1);
        if (openBraceIndex < 0) continue;
        let braceDepth = 0;
        let inSingleQuote = false, inDoubleQuote = false;
        let inLineComment = false, inBlockComment = false;
        let closeBraceIndex = -1;
        for (let cursor = openBraceIndex; cursor < fileContents.length; cursor++) {
            const currentChar = fileContents[cursor];
            const nextChar = fileContents[cursor + 1] ?? "";
            if (inLineComment) { if (currentChar === "\n") inLineComment = false; continue; }
            if (inBlockComment) { if (currentChar === "*" && nextChar === "/") { inBlockComment = false; cursor++; } continue; }
            if (inSingleQuote) { if (currentChar === "'" && fileContents[cursor - 1] !== "\\") inSingleQuote = false; continue; }
            if (inDoubleQuote) { if (currentChar === '"' && fileContents[cursor - 1] !== "\\") inDoubleQuote = false; continue; }
            if (currentChar === "/" && nextChar === "/") { inLineComment = true; cursor++; continue; }
            if (currentChar === "/" && nextChar === "*") { inBlockComment = true; cursor++; continue; }
            if (currentChar === "'") { inSingleQuote = true; continue; }
            if (currentChar === '"') { inDoubleQuote = true; continue; }
            if (currentChar === "{") braceDepth++;
            else if (currentChar === "}") {
                braceDepth--;
                if (braceDepth === 0) { closeBraceIndex = cursor; break; }
            }
        }
        if (closeBraceIndex < 0) continue;
        const blockBody = fileContents.slice(openBraceIndex, closeBraceIndex + 1);
        if (/@react-native\/gradle-plugin|react-native-gradle-plugin/.test(blockBody)) {
            declaresPluginManagementForRngp = true;
            break;
        }
    }

    const issues: string[] = [];
    if (!includesApp) {
        issues.push("Your Android settings.gradle does not include the ':app' module.");
    }
    if (!appliesAutolink) {
        issues.push(
            "Your Android settings.gradle does not apply React Native's " +
            "native_modules.gradle (the autolinking script). Native libraries " +
            "in node_modules will not be linked.",
        );
    }
    return {
        present: true,
        resolved_path: found.rel,
        size_bytes: await fileSize(found.abs),
        issues,
        includes_app: includesApp,
        applies_native_modules_autolinking: appliesAutolink,
        root_project_name: rootNameMatch?.[1] ?? null,
        uses_modern_react_settings_extension: usesModernReactSettingsExtension,
        declares_pluginmanagement_for_rngp: declaresPluginManagementForRngp,
    };
}

async function inspectRootBuild(rootPath: string): Promise<FileEvidence> {
    const found = await pickFile(rootPath, ["build.gradle", "build.gradle.kts"]);
    if (!found) {
        return {
            ...EMPTY_FILE,
            issues: ["Your Android root build.gradle is missing."],
        };
    }
    return {
        present: true,
        resolved_path: found.rel,
        size_bytes: await fileSize(found.abs),
        issues: [],
    };
}

async function inspectAppBuild(rootPath: string): Promise<AppGradleEvidence> {
    const found = await pickFile(rootPath, ["app/build.gradle", "app/build.gradle.kts"]);
    if (!found) {
        return {
            ...EMPTY_FILE,
            issues: ["Your Android app/build.gradle is missing."],
            applies_android_application_plugin: false,
            applies_react_native_plugin: false,
            has_react_block: false,
            application_id: null,
            namespace: null,
        };
    }
    const fileContents = (await readFileOrNull(found.abs)) ?? "";
    const appPluginApplied =
        /apply\s+plugin\s*:\s*["']com\.android\.application["']|id\s*\(?\s*["']com\.android\.application["']/.test(fileContents);
    const reactNativePluginApplied =
        /apply\s+plugin\s*:\s*["']com\.facebook\.react["']|id\s*\(?\s*["']com\.facebook\.react["']/.test(fileContents);
    const reactBlockPresent = /\breact\s*\{/.test(fileContents);
    const applicationId = fileContents.match(/applicationId\s+["']([^"']+)["']/)?.[1] ?? null;
    const namespaceValue = fileContents.match(/namespace\s+["']([^"']+)["']/)?.[1] ?? null;
    const issues: string[] = [];
    if (!appPluginApplied) {
        issues.push("Your app/build.gradle does not apply the Android application plugin (com.android.application).");
    }
    if (!reactNativePluginApplied) {
        issues.push("Your app/build.gradle does not apply React Native's Gradle plugin (com.facebook.react).");
    }
    if (!reactBlockPresent) {
        issues.push("Your app/build.gradle has no `react { … }` configuration block.");
    }
    return {
        present: true,
        resolved_path: found.rel,
        size_bytes: await fileSize(found.abs),
        issues,
        applies_android_application_plugin: appPluginApplied,
        applies_react_native_plugin: reactNativePluginApplied,
        has_react_block: reactBlockPresent,
        application_id: applicationId,
        namespace: namespaceValue,
    };
}

async function inspectManifest(rootPath: string): Promise<ManifestEvidence> {
    const found = await pickFile(rootPath, ["app/src/main/AndroidManifest.xml"]);
    if (!found) {
        return {
            ...EMPTY_FILE,
            issues: ["Your AndroidManifest.xml is missing at app/src/main/AndroidManifest.xml."],
            package_attribute: null,
            has_application_node: false,
            has_launcher_activity: false,
            declared_permissions: [],
        };
    }
    const manifestXml = (await readFileOrNull(found.abs)) ?? "";
    const packageAttribute = manifestXml.match(/<manifest[^>]*\bpackage\s*=\s*"([^"]+)"/)?.[1] ?? null;
    const hasApplicationNode = /<application\b/.test(manifestXml);
    const hasLauncherActivity =
        /<category[^>]*android:name\s*=\s*"android\.intent\.category\.LAUNCHER"/.test(manifestXml);
    const declaredPermissions =
        [...manifestXml.matchAll(/<uses-permission[^>]*android:name\s*=\s*"([^"]+)"/g)].map((entry) => entry[1]);
    const issues: string[] = [];
    if (!hasApplicationNode) {
        issues.push("Your AndroidManifest.xml has no <application> node.");
    }
    if (!hasLauncherActivity) {
        issues.push("Your AndroidManifest.xml does not declare a launcher activity (android.intent.category.LAUNCHER).");
    }
    return {
        present: true,
        resolved_path: found.rel,
        size_bytes: await fileSize(found.abs),
        issues,
        package_attribute: packageAttribute,
        has_application_node: hasApplicationNode,
        has_launcher_activity: hasLauncherActivity,
        declared_permissions: declaredPermissions,
    };
}

async function inspectGradleProperties(rootPath: string): Promise<GradlePropertiesEvidence> {
    const found = await pickFile(rootPath, ["gradle.properties"]);
    if (!found) {
        return {
            ...EMPTY_FILE,
            issues: ["Your android/gradle.properties is missing."],
            hermes_enabled: null, new_arch_enabled: null, use_androidx: null,
        };
    }
    const propertiesContent = (await readFileOrNull(found.abs)) ?? "";
    const readBooleanFlag = (flagKey: string): boolean | null => {
        const matchedLine = propertiesContent.match(new RegExp(`^${flagKey}\\s*=\\s*(true|false)`, "m"));
        return matchedLine ? matchedLine[1] === "true" : null;
    };
    return {
        present: true,
        resolved_path: found.rel,
        size_bytes: await fileSize(found.abs),
        issues: [],
        hermes_enabled: readBooleanFlag("hermesEnabled"),
        new_arch_enabled: readBooleanFlag("newArchEnabled"),
        use_androidx: readBooleanFlag("android.useAndroidX"),
    };
}

async function inspectWrapper(rootPath: string): Promise<WrapperEvidence> {
    const gradlewPath = path.join(rootPath, "gradlew");
    const wrapperJarPath = path.join(rootPath, "gradle", "wrapper", "gradle-wrapper.jar");
    const wrapperPropsPath = path.join(rootPath, "gradle", "wrapper", "gradle-wrapper.properties");
    const gradlewExists = await exists(gradlewPath);
    let gradlewHasCrlf = false;
    if (gradlewExists) {
        const gradlewContent = await readFileOrNull(gradlewPath);
        gradlewHasCrlf = !!gradlewContent && gradlewContent.includes("\r");
    }
    const propertiesContent = await readFileOrNull(wrapperPropsPath);
    const distributionUrl =
        propertiesContent?.match(/^distributionUrl\s*=\s*(.+)$/m)?.[1]?.trim() ?? null;
    return {
        gradlew_present: gradlewExists,
        gradlew_size: await fileSize(gradlewPath),
        gradlew_has_crlf: gradlewHasCrlf,
        wrapper_jar_present: await exists(wrapperJarPath),
        wrapper_jar_size: await fileSize(wrapperJarPath),
        wrapper_properties_present: await exists(wrapperPropsPath),
        distribution_url: distributionUrl,
        issues: [],
    };
}

async function inspectJavaSources(rootPath: string, javaPackageHint: string | null): Promise<JavaSourcesEvidence> {
    const javaSourceRoot = path.join(rootPath, "app", "src", "main", "java");
    if (!(await exists(javaSourceRoot))) {
        return {
            main_application_present: false,
            main_activity_present: false,
            detected_package: null,
            issues: ["Your Android project has no Java/Kotlin source folder at app/src/main/java."],
        };
    }
    let foundMainActivity = false;
    let foundMainApplication = false;
    let detectedPackage: string | null = null;
    async function walkSourceTree(directoryPath: string): Promise<void> {
        const entries = await fs.readdir(directoryPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                await walkSourceTree(fullPath);
            } else if (/^MainActivity\.(java|kt)$/.test(entry.name)) {
                foundMainActivity = true;
                const fileContents = await readFileOrNull(fullPath);
                const packageMatch = fileContents?.match(/^package\s+([\w\.]+)/m);
                if (packageMatch && !detectedPackage) detectedPackage = packageMatch[1];
            } else if (/^MainApplication\.(java|kt)$/.test(entry.name)) {
                foundMainApplication = true;
                const fileContents = await readFileOrNull(fullPath);
                const packageMatch = fileContents?.match(/^package\s+([\w\.]+)/m);
                if (packageMatch && !detectedPackage) detectedPackage = packageMatch[1];
            }
        }
    }
    await walkSourceTree(javaSourceRoot);
    const issues: string[] = [];
    if (!foundMainActivity) {
        issues.push("Your Android project has no MainActivity.java/.kt under app/src/main/java.");
    }
    if (!foundMainApplication) {
        issues.push("Your Android project has no MainApplication.java/.kt — React Native cannot start without it.");
    }
    if (javaPackageHint && detectedPackage && detectedPackage !== javaPackageHint) {
        issues.push(
            `Your Java sources declare package '${detectedPackage}' but the manifest / build files declare '${javaPackageHint}'. ` +
            "Both must match.",
        );
    }
    return {
        main_application_present: foundMainApplication,
        main_activity_present: foundMainActivity,
        detected_package: detectedPackage,
        issues,
    };
}

async function inspectResValues(rootPath: string): Promise<ResValuesEvidence> {
    const stringsXmlPath = path.join(rootPath, "app", "src", "main", "res", "values", "strings.xml");
    const stylesXmlPath = path.join(rootPath, "app", "src", "main", "res", "values", "styles.xml");
    const stringsContent = await readFileOrNull(stringsXmlPath);
    const stylesContent = await readFileOrNull(stylesXmlPath);
    const definesAppName = !!stringsContent && /name\s*=\s*"app_name"/.test(stringsContent);
    const definesAppTheme = !!stylesContent && /name\s*=\s*"AppTheme"/.test(stylesContent);
    const issues: string[] = [];
    if (!stringsContent) {
        issues.push("Your Android project is missing res/values/strings.xml — manifest @string references will not resolve.");
    } else if (!definesAppName) {
        issues.push("Your strings.xml does not define 'app_name'.");
    }
    if (!stylesContent) {
        issues.push("Your Android project is missing res/values/styles.xml — manifest @style references will not resolve.");
    } else if (!definesAppTheme) {
        issues.push("Your styles.xml does not define 'AppTheme'.");
    }
    return {
        strings_xml_present: !!stringsContent,
        defines_app_name: definesAppName,
        styles_xml_present: !!stylesContent,
        defines_app_theme: definesAppTheme,
        issues,
    };
}

export async function inspectAndroidContents(userAndroidDir: string): Promise<AndroidContentEvidence> {
    if (!(await exists(userAndroidDir))) {
        return {
            has_dir: false, android_root: userAndroidDir,
            settings: {
                ...EMPTY_FILE,
                includes_app: false,
                applies_native_modules_autolinking: false,
                root_project_name: null,
                uses_modern_react_settings_extension: false,
                declares_pluginmanagement_for_rngp: false,
            },
            root_build: { ...EMPTY_FILE },
            app_build: {
                ...EMPTY_FILE,
                applies_android_application_plugin: false,
                applies_react_native_plugin: false,
                has_react_block: false,
                application_id: null,
                namespace: null,
            },
            manifest: {
                ...EMPTY_FILE,
                package_attribute: null,
                has_application_node: false,
                has_launcher_activity: false,
                declared_permissions: [],
            },
            gradle_properties: {
                ...EMPTY_FILE,
                hermes_enabled: null, new_arch_enabled: null, use_androidx: null,
            },
            wrapper: {
                gradlew_present: false, gradlew_size: -1, gradlew_has_crlf: false,
                wrapper_jar_present: false, wrapper_jar_size: -1,
                wrapper_properties_present: false, distribution_url: null,
                issues: ["Your project has no android/ directory."],
            },
            java_sources: {
                main_application_present: false, main_activity_present: false,
                detected_package: null,
                issues: ["Your project has no android/ directory."],
            },
            res_values: {
                strings_xml_present: false, defines_app_name: false,
                styles_xml_present: false, defines_app_theme: false,
                issues: ["Your project has no android/ directory."],
            },
            all_issues: [],
            blocking_issues: [],
        };
    }

    const settings = await inspectSettings(userAndroidDir);
    const rootBuild = await inspectRootBuild(userAndroidDir);
    const appBuild = await inspectAppBuild(userAndroidDir);
    const manifest = await inspectManifest(userAndroidDir);
    const gradleProperties = await inspectGradleProperties(userAndroidDir);
    const wrapper = await inspectWrapper(userAndroidDir);
    const javaPackageHint = manifest.package_attribute ?? appBuild.namespace ?? appBuild.application_id;
    const javaSources = await inspectJavaSources(userAndroidDir, javaPackageHint);
    const resValues = await inspectResValues(userAndroidDir);

    const allIssues = [
        ...settings.issues, ...rootBuild.issues, ...appBuild.issues, ...manifest.issues,
        ...gradleProperties.issues, ...wrapper.issues, ...javaSources.issues, ...resValues.issues,
    ];

    return {
        has_dir: true, android_root: userAndroidDir,
        settings, root_build: rootBuild, app_build: appBuild, manifest,
        gradle_properties: gradleProperties, wrapper,
        java_sources: javaSources, res_values: resValues,
        all_issues: allIssues,
        blocking_issues: allIssues,
    };
}
