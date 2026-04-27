// SAMP Apps — Threat scanner.
//
// The scanner looks for code that targets the build pipeline itself:
// attempts to read GitHub Actions runner secrets, exfiltration of any
// file the runner can see, destructive shell commands, miners, and
// malware droppers.
//
// What the scanner does NOT do:
//   * It does not flag a mobile app for using Supabase, Netlify,
//     GitHub, AWS, GCP, Stripe, or any other third-party credentials.
//     Those values belong to the user's own product. They live in the
//     user's environment, not ours, and reading them from process.env
//     inside an Android app is normal application behaviour.
//   * It does not flag every reference to an external URL. Many apps
//     legitimately call analytics, ads, payments, and CDN endpoints.
//
// What the scanner DOES flag (critical → reject; warn → report only):
//   * Reads of variables that only exist on a CI runner
//     (ACTIONS_RUNTIME_TOKEN, ACTIONS_ID_TOKEN_REQUEST_TOKEN,
//      ACTIONS_RESULTS_URL, ACTIONS_CACHE_URL, RUNNER_TOKEN, …).
//     A React Native app has no business with those.
//   * Direct reads of GitHub Actions runner paths (/home/runner/work…,
//     $GITHUB_WORKSPACE, /tmp/sb/…) from project source files.
//   * Outbound calls to known anonymous-paste / webhook relay hosts
//     (pastebin, transfer.sh, requestbin, webhook.site, ngrok, …),
//     Telegram bot API, Discord webhooks.
//   * Destructive shell (rm -rf /, dd to /dev/*, mkfs, fork bomb).
//   * Cryptocurrency miners and mining-pool endpoints.
//   * `curl … | sh` style remote-script execution in lifecycle scripts.
//   * eval(Buffer.from(…)) / eval(atob(…)) malware-dropper patterns.
//
// Inputs:  <project-root>
// Outputs: ThreatReport (in-process) or report.json (CLI mode)
// Exit:    0 = no critical findings, 2 = at least one critical finding,
//          1 = scanner crashed.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { ThreatFinding, ThreatReport } from "./types";

const SCAN_FILE_EXTENSIONS = new Set([
    ".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs",
    ".json", ".sh", ".bash", ".zsh", ".yml", ".yaml",
    ".gradle", ".kts", ".java", ".kt", ".groovy",
    ".py", ".rb",
]);

const SKIP_DIRECTORIES = new Set([
    "node_modules", ".git", ".github", ".husky",
    "build", "dist", ".gradle", ".idea", ".vscode",
    "android/build", "android/.gradle", "android/app/build",
]);

const MAX_FILE_BYTES = 512 * 1024;        // 512 KB per file
const MAX_TOTAL_FILES = 5000;             // overall scan ceiling

interface SignatureRule {
    code: string;
    severity: "critical" | "warn";
    message: string;
    pattern: RegExp;
    extensionFilter?: Set<string>;
}

const SIGNATURES: SignatureRule[] = [
    // ── CI-runner exploitation ───────────────────────────────────────────
    // These environment variables only exist on a GitHub Actions runner.
    // Reading them from code that ships inside a mobile app cannot be
    // legitimate — the only purpose is to lift tokens out of the
    // pipeline that built the APK.
    {
        code: "runner_secret_token_read",
        severity: "critical",
        message:
            "Project source reads a GitHub Actions runner secret " +
            "(ACTIONS_RUNTIME_TOKEN / ACTIONS_ID_TOKEN_REQUEST_TOKEN / " +
            "RUNNER_TOKEN). These exist only inside our build runner and " +
            "have no purpose inside an installable app.",
        pattern:
            /\b(?:process\.env(?:\.|\[\s*['"`])|System\.getenv\s*\(\s*['"`]|os\.environ(?:\.get)?\s*\(\s*['"`])(ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN|ACTIONS_ID_TOKEN_REQUEST_URL|ACTIONS_RESULTS_URL|ACTIONS_CACHE_URL|RUNNER_TOKEN|GITHUB_ACTIONS_RUNTIME_URL)\b/,
    },
    {
        code: "runner_workspace_path_read",
        severity: "critical",
        message:
            "Project source reads files from a GitHub Actions runner path " +
            "(/home/runner/…, $GITHUB_WORKSPACE, /tmp/sb/…). The build " +
            "pipeline keeps its own state in those locations; user code " +
            "should never touch them.",
        pattern:
            /(?:["'`](?:\/home\/runner\/work|\/tmp\/sb)[\/'"`]|process\.env(?:\.|\[\s*['"`])(?:GITHUB_WORKSPACE|RUNNER_TEMP|RUNNER_WORKSPACE)\b)/,
    },
    // ── Anonymous exfiltration relays ────────────────────────────────────
    {
        code: "exfil_pastebin_class",
        severity: "critical",
        message:
            "Project source contacts a public paste / file-host relay " +
            "(pastebin, ix.io, transfer.sh, 0x0.st, requestbin, " +
            "webhook.site, pipedream, ngrok). These hosts are the standard " +
            "drop points for stolen build-time data.",
        pattern:
            /\bhttps?:\/\/(?:[a-z0-9-]+\.)?(pastebin\.com|hastebin\.com|ix\.io|paste\.ee|0x0\.st|transfer\.sh|file\.io|requestbin\.com|webhook\.site|pipedream\.net|[a-z0-9-]+\.ngrok\.(?:io|app))\b/i,
    },
    {
        code: "exfil_telegram_bot",
        severity: "critical",
        message:
            "Project source posts to api.telegram.org/bot* — the most " +
            "common low-effort relay for tokens stolen from a build runner.",
        pattern:
            /\bhttps?:\/\/api\.telegram\.org\/bot[A-Za-z0-9:_-]+\//,
    },
    {
        code: "exfil_discord_webhook",
        severity: "critical",
        message:
            "Project source posts to a Discord webhook — frequently used " +
            "to relay scraped values out of a build runner.",
        pattern:
            /\bhttps?:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//,
    },
    // ── Destructive shell ───────────────────────────────────────────────
    {
        code: "destructive_rm_root",
        severity: "critical",
        message:
            "A lifecycle script contains 'rm -rf /' (or '/*'). This would " +
            "wipe the build runner's filesystem and is never legitimate.",
        pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/(?:\s|\*|$|[^a-zA-Z0-9_./-])/,
        extensionFilter: new Set([".sh", ".bash", ".zsh", ".json", ".yml", ".yaml"]),
    },
    {
        code: "destructive_disk_wipe",
        severity: "critical",
        message:
            "A lifecycle script invokes a disk-level wipe (dd if=/dev/zero " +
            "of=/dev/*, mkfs, shred /dev/*).",
        pattern:
            /\b(?:dd\s+if=\/dev\/(?:zero|urandom)\s+of=\/dev\/[a-z]+|mkfs(?:\.[a-z0-9]+)?\s+\/dev\/[a-z]+|shred\s+(?:-[a-zA-Z]+\s+)*\/dev\/[a-z]+)\b/,
        extensionFilter: new Set([".sh", ".bash", ".zsh", ".json", ".yml", ".yaml"]),
    },
    {
        code: "fork_bomb",
        severity: "critical",
        message: "A lifecycle script contains a classic fork-bomb pattern.",
        pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    },
    // ── Mining ──────────────────────────────────────────────────────────
    {
        code: "miner_xmrig",
        severity: "critical",
        message:
            "Project source / scripts reference a known cryptocurrency " +
            "miner binary (XMRig, T-Rex, ethminer, nbminer, …). Mining on " +
            "free CI runners is grounds for an account ban.",
        pattern: /\b(?:xmrig|xmr-stak|cpuminer-multi|t-rex(?:miner)?|ethminer|nbminer|trex)\b/i,
    },
    {
        code: "miner_pool_endpoint",
        severity: "critical",
        message:
            "Project source / scripts reference a known mining pool " +
            "endpoint (stratum+tcp, *.minexmr.com, ethermine, nanopool, …).",
        pattern:
            /\b(?:stratum\+tcp:\/\/|(?:[a-z0-9-]+\.)?(?:minexmr|nanopool|ethermine|2miners|nicehash|miningpoolhub)\.(?:com|org))\b/i,
    },
    // ── Obfuscation droppers ────────────────────────────────────────────
    {
        code: "obfuscated_eval_buffer",
        severity: "warn",
        message:
            "Source code eval()s decoded base64/hex output. This pattern " +
            "is the hallmark of malware droppers — please confirm the " +
            "snippet is legitimate before approving.",
        pattern:
            /\beval\s*\(\s*(?:Buffer\.from\s*\(|atob\s*\(|Buffer\.from\s*\(\s*[`'"][A-Za-z0-9+/=]{40,}[`'"])/,
        extensionFilter: new Set([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"]),
    },
    {
        code: "lifecycle_curl_pipe_sh",
        severity: "critical",
        message:
            "A lifecycle script downloads and executes a remote shell " +
            "script via `curl … | sh` / `wget -O- … | bash`. The build " +
            "runs with --ignore-scripts so the script does not run, but " +
            "the intent is recorded.",
        pattern: /\b(?:curl|wget)\s+[^|]*\|\s*(?:bash|sh|zsh)\b/,
    },
    {
        code: "lifecycle_remote_loader",
        severity: "warn",
        message:
            "Source code dynamically requires() / imports() a remote URL. " +
            "This is how runtime payload loaders ship malicious code.",
        pattern: /\b(?:require|import)\s*\(\s*[`'"]https?:\/\/[^`'"]+[`'"]\s*\)/,
        extensionFilter: new Set([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"]),
    },
];

interface ScanCounters {
    scanned: number;
    skipped: number;
    skippedReasons: Record<string, number>;
}

function recordSkip(counters: ScanCounters, reason: string): void {
    counters.skipped += 1;
    counters.skippedReasons[reason] = (counters.skippedReasons[reason] ?? 0) + 1;
}

async function shouldScanFile(absolutePath: string): Promise<boolean> {
    try {
        const fileStat = await fs.stat(absolutePath);
        if (!fileStat.isFile()) return false;
        if (fileStat.size === 0 || fileStat.size > MAX_FILE_BYTES) return false;
        return true;
    } catch {
        return false;
    }
}

async function* walkProject(
    projectRoot: string,
    counters: ScanCounters,
): AsyncGenerator<string> {
    const directoryQueue: string[] = [projectRoot];
    while (directoryQueue.length > 0) {
        const currentDirectory = directoryQueue.shift()!;
        let entries;
        try {
            entries = await fs.readdir(currentDirectory, { withFileTypes: true });
        } catch {
            recordSkip(counters, "unreadable_dir");
            continue;
        }
        for (const entry of entries) {
            const absolutePath = path.join(currentDirectory, entry.name);
            const relativePath = path.relative(projectRoot, absolutePath);
            if (entry.isSymbolicLink()) {
                recordSkip(counters, "symlink");
                continue;
            }
            if (entry.isDirectory()) {
                if (SKIP_DIRECTORIES.has(entry.name)) {
                    recordSkip(counters, "skip_dir");
                    continue;
                }
                if (SKIP_DIRECTORIES.has(relativePath)) {
                    recordSkip(counters, "skip_dir");
                    continue;
                }
                directoryQueue.push(absolutePath);
                continue;
            }
            yield absolutePath;
        }
    }
}

function applySignatures(
    relativePath: string,
    fileExtension: string,
    fileContents: string,
): ThreatFinding[] {
    const findings: ThreatFinding[] = [];
    for (const rule of SIGNATURES) {
        if (rule.extensionFilter && !rule.extensionFilter.has(fileExtension)) continue;
        const matchResult = rule.pattern.exec(fileContents);
        if (!matchResult) continue;
        const matchOffset = matchResult.index;
        const lineNumber = fileContents.slice(0, matchOffset).split(/\r?\n/).length;
        const lineStart = fileContents.lastIndexOf("\n", matchOffset) + 1;
        const lineEnd = fileContents.indexOf("\n", matchOffset);
        const rawLine = fileContents.slice(
            lineStart,
            lineEnd === -1 ? Math.min(fileContents.length, matchOffset + 200) : lineEnd,
        );
        findings.push({
            code: rule.code,
            severity: rule.severity,
            message: rule.message,
            file: relativePath,
            line: lineNumber,
            excerpt: rawLine.trim().slice(0, 240),
        });
    }
    return findings;
}

export async function scanProjectForThreats(projectRoot: string): Promise<ThreatReport> {
    const startedAt = Date.now();
    const counters: ScanCounters = { scanned: 0, skipped: 0, skippedReasons: {} };
    const findings: ThreatFinding[] = [];

    for await (const absolutePath of walkProject(projectRoot, counters)) {
        if (counters.scanned >= MAX_TOTAL_FILES) {
            recordSkip(counters, "scan_ceiling");
            continue;
        }
        const fileExtension = path.extname(absolutePath).toLowerCase();
        const isLifecycleManifest = path.basename(absolutePath) === "package.json";
        if (!isLifecycleManifest && !SCAN_FILE_EXTENSIONS.has(fileExtension)) {
            recordSkip(counters, "extension");
            continue;
        }
        if (!(await shouldScanFile(absolutePath))) {
            recordSkip(counters, "size_or_type");
            continue;
        }
        let fileContents: string;
        try {
            fileContents = await fs.readFile(absolutePath, "utf8");
        } catch {
            recordSkip(counters, "read_error");
            continue;
        }
        counters.scanned += 1;
        const relativePath = path.relative(projectRoot, absolutePath);
        findings.push(...applySignatures(relativePath, fileExtension, fileContents));
    }

    const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
    const warnCount = findings.length - criticalCount;
    return {
        scanned_files: counters.scanned,
        skipped_files: counters.skipped,
        skipped_reasons: counters.skippedReasons,
        duration_ms: Date.now() - startedAt,
        findings,
        critical_count: criticalCount,
        warn_count: warnCount,
    };
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const projectRoot = argv[0];
    const outIndex = argv.indexOf("--out");
    const outPath = outIndex >= 0 ? argv[outIndex + 1] : null;
    if (!projectRoot) {
        console.error("usage: threatScan <project-root> [--out <report.json>]");
        process.exit(64);
    }
    scanProjectForThreats(projectRoot)
        .then(async (report) => {
            console.log(`[threat-scan] scanned ${report.scanned_files} files in ${report.duration_ms}ms`);
            console.log(`[threat-scan] findings: ${report.critical_count} critical, ${report.warn_count} warn`);
            for (const finding of report.findings) {
                const severityTag = finding.severity === "critical" ? "✗" : "·";
                console.log(`[threat-scan]   ${severityTag} ${finding.code} → ${finding.file}:${finding.line ?? "?"}`);
            }
            if (outPath) await fs.writeFile(outPath, JSON.stringify(report, null, 2));
            process.exit(report.critical_count > 0 ? 2 : 0);
        })
        .catch((scanError) => {
            console.error("[threat-scan] crashed:", scanError);
            process.exit(1);
        });
}
