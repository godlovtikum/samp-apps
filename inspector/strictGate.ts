// SAMP Apps — Strict gate.
//
// The strict gate is the single accept/reject decision point for an
// untrusted repository. It composes:
//
//   1. Inspector facts            (must satisfy every hard requirement)
//   2. Android-evidence inspection (every issue is blocking; no patching)
//   3. Capability cross-checks    (RN version vs Gradle plugin layout,
//                                  presence of @react-native/gradle-plugin
//                                  in node_modules)
//   4. Threat scan                (must report zero critical findings)
//
// Every reason returned here is written verbatim into the user's job
// feed, so messages must be plain English and describe what the user
// can fix in their own project.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { inspectAndroidContents, AndroidContentEvidence } from "./inspectAndroidContents";
import { InspectionIssue, ProjectFacts, StrictGateDecision, ThreatReport } from "./types";

interface StrictGateInputs {
    projectRoot: string;
    facts: ProjectFacts;
    inspectionIssues: InspectionIssue[];
    threatReport: ThreatReport;
}

async function pathExists(targetPath: string): Promise<boolean> {
    try { await fs.access(targetPath); return true; } catch { return false; }
}

function parseReactNativeMinor(rawVersion: string | undefined): { major: number; minor: number } | null {
    if (!rawVersion) return null;
    const versionMatch = rawVersion.match(/(\d+)\.(\d+)(?:\.\d+)?/);
    if (!versionMatch) return null;
    return { major: Number(versionMatch[1]), minor: Number(versionMatch[2]) };
}

async function deriveCapabilityCrossCheckIssues(
    projectRoot: string,
    facts: ProjectFacts,
    androidEvidence: AndroidContentEvidence,
): Promise<InspectionIssue[]> {
    const crossCheckIssues: InspectionIssue[] = [];
    const reactNativeVersion = parseReactNativeMinor(facts.react_native_version);

    // 1) Modern settings-plugin used while RN < 0.75.
    if (
        androidEvidence.settings.uses_modern_react_settings_extension &&
        reactNativeVersion &&
        (reactNativeVersion.major === 0 && reactNativeVersion.minor < 75)
    ) {
        crossCheckIssues.push({
            code: "android_rn_settings_extension_too_new",
            severity: "error",
            message:
                `Your Android settings.gradle uses React Native's settings-plugin (added in React Native 0.75), ` +
                `but your package.json declares react-native ${facts.react_native_version}. ` +
                `Either upgrade to React Native 0.75 or replace the settings-plugin block with the autolinking ` +
                `style your version supports.`,
        });
    }

    // 2) RN gradle plugin applied without pluginManagement{} declaration.
    if (
        androidEvidence.app_build.applies_react_native_plugin &&
        !androidEvidence.settings.declares_pluginmanagement_for_rngp
    ) {
        crossCheckIssues.push({
            code: "android_rngp_plugin_not_resolvable",
            severity: "error",
            message:
                "Your app/build.gradle applies the React Native plugin ('com.facebook.react'), but your " +
                "settings.gradle does not declare a `pluginManagement { … }` block that registers " +
                "@react-native/gradle-plugin. Without that block Gradle cannot find the plugin and the build " +
                "stops before it starts. Add `includeBuild('../node_modules/@react-native/gradle-plugin')` " +
                "inside `pluginManagement { … }` in settings.gradle.",
        });
    }

    // 3) RN plugin applied + pluginManagement OK, but the actual node_modules entry is missing.
    if (
        androidEvidence.app_build.applies_react_native_plugin &&
        facts.node_modules_present
    ) {
        const gradlePluginEntry = path.join(projectRoot, "node_modules", "@react-native", "gradle-plugin");
        if (!(await pathExists(gradlePluginEntry))) {
            crossCheckIssues.push({
                code: "android_rngp_plugin_missing_from_node_modules",
                severity: "error",
                message:
                    "Your project references React Native's Gradle plugin, but @react-native/gradle-plugin is " +
                    "not installed inside node_modules. Run `npm install` (or yarn / pnpm equivalent) so the " +
                    "plugin is on disk before building.",
            });
        }
    }

    return crossCheckIssues;
}

export async function decideStrictGate(
    inputs: StrictGateInputs,
): Promise<{ decision: StrictGateDecision; androidEvidence: AndroidContentEvidence | null }> {
    const reasons: InspectionIssue[] = [];

    // 1) Project-level errors from the inspector.
    const projectErrors = inputs.inspectionIssues.filter((issue) => issue.severity === "error");
    reasons.push(...projectErrors);

    // 2) Deep android/ inspection (only if the directory is present).
    let androidEvidence: AndroidContentEvidence | null = null;
    let androidBlockingCount = 0;
    if (inputs.facts.has_user_android_dir) {
        const androidRoot = path.join(inputs.projectRoot, "android");
        androidEvidence = await inspectAndroidContents(androidRoot);

        for (const blockingIssue of androidEvidence.blocking_issues) {
            reasons.push({
                code: "android_blocking_issue",
                severity: "error",
                message: blockingIssue,
            });
        }

        // Wrapper is mandatory: strict mode never stages or downloads one.
        if (!androidEvidence.wrapper.gradlew_present) {
            reasons.push({
                code: "android_wrapper_missing",
                severity: "error",
                message:
                    "Your Android project has no Gradle wrapper (the gradlew script). " +
                    "Commit the standard Gradle wrapper files (gradlew, gradle/wrapper/gradle-wrapper.jar, " +
                    "gradle/wrapper/gradle-wrapper.properties) generated by `npx react-native init`.",
            });
        }
        if (
            !androidEvidence.wrapper.wrapper_jar_present ||
            androidEvidence.wrapper.wrapper_jar_size <= 4096
        ) {
            reasons.push({
                code: "android_wrapper_jar_missing",
                severity: "error",
                message:
                    "Your Android project is missing a valid gradle/wrapper/gradle-wrapper.jar. " +
                    "Commit the standard Gradle wrapper jar that ships with React Native projects.",
            });
        }
        if (!androidEvidence.wrapper.wrapper_properties_present) {
            reasons.push({
                code: "android_wrapper_props_missing",
                severity: "error",
                message:
                    "Your Android project is missing gradle/wrapper/gradle-wrapper.properties.",
            });
        }

        // 3) Capability cross-checks (RN version ↔ Gradle layout ↔ node_modules).
        const crossCheckIssues = await deriveCapabilityCrossCheckIssues(
            inputs.projectRoot,
            inputs.facts,
            androidEvidence,
        );
        reasons.push(...crossCheckIssues);

        androidBlockingCount = androidEvidence.blocking_issues.length + crossCheckIssues.length;
    }

    // 4) Critical threat findings always reject.
    for (const finding of inputs.threatReport.findings) {
        if (finding.severity !== "critical") continue;
        const locationSuffix = finding.line ? ` (file: ${finding.file}, line ${finding.line})` : ` (file: ${finding.file})`;
        reasons.push({
            code: `threat_${finding.code}`,
            severity: "error",
            message: `${finding.message}${locationSuffix}`,
        });
    }

    const accepted = reasons.length === 0;
    const androidRoot = accepted ? path.join(inputs.projectRoot, "android") : null;

    const decision: StrictGateDecision = {
        accepted,
        android_root: androidRoot,
        reasons,
        summary: {
            project_issues: projectErrors.length,
            threat_critical: inputs.threatReport.critical_count,
            threat_warn: inputs.threatReport.warn_count,
            android_blocking_issues: androidBlockingCount,
        },
    };

    return { decision, androidEvidence };
}
