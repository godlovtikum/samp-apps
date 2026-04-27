# SAMP Apps

**Build an installable Android APK from a React Native or Expo repository — entirely from a phone.**

SAMP Apps takes a Git URL, runs your project through a hosted build
pipeline, and gives you a signed `.apk` you can download and install.
There is no laptop step, no local Android SDK, no Gradle command line.

You pick one of three project types when you queue a build:

- **React Native (bare)** — your repo already contains its own `android/` directory.
- **Expo (managed)** — your repo is an Expo project; SAMP runs `expo prebuild` for you.
- **Expo (prebuild committed)** — your repo is Expo and you committed the prebuild output.

Each type has its own GitHub Actions entry workflow that calls a
single shared pipeline, so the per-type behavior is independently
auditable.

> **New here?** If you just want to stand the platform up on your own Supabase / Netlify / GitHub accounts, follow [setup.md](./setup.md) — it is a phone-only, click-by-click walkthrough.

---

## Who it is for

- React Native developers who work primarily from a phone or another device that cannot run a full Android toolchain.
- Small teams who want a simple "paste a Git URL → get an APK" loop without standing up their own CI.
- Anyone who wants a transparent record of what the build platform actually did to their code (the answer: nothing — the build runs the exact code you committed).

---

## How it works

You start a build by sending a Git URL to the platform. The pipeline:

1. **Clones** your repository on a fresh, isolated runner.
2. **Inspects** the repository against a fixed list of requirements (see *What we check* below) and produces a report.
3. **Decides**: if the repository meets every requirement and the, the build moves forward; otherwise the pipeline stops and tells you exactly what is missing.
4. **Builds** by bundling your JavaScript with Metro and running your own Gradle wrapper. The build platform never edits your code.
5. **Signs** the APK and **publishes** it as a downloadable file.
6. **Reports**: a transparency report (project facts, security scan results, the gate decision, the stage timings, sanitized logs) is uploaded for every build, success or failure.

Builds are stateless. Nothing about your project is retained between runs except the transparency report (kept for 30 days).

---

## What we check

Your repository is **accepted** when all of the following are true:

1. `package.json` exists, parses as JSON, and lists `react-native`
   under `dependencies` or `devDependencies`.
2. A JavaScript entry file is detectable
   (`index.js`, `App.tsx`, `src/index.ts`, …).
3. `node_modules/` is populated after install (so React Native's
   autolinking can find your native modules).
4. A complete `android/` directory exists at the project root,
   containing valid `settings.gradle`, `build.gradle`,
   `app/build.gradle`, `AndroidManifest.xml`, and `gradle.properties`.
5. The Gradle wrapper is committed and well-formed: `gradlew`,
   `gradle/wrapper/gradle-wrapper.jar` (containing
   `org.gradle.wrapper.GradleWrapperMain`), and
   `gradle/wrapper/gradle-wrapper.properties`.
6. The React Native Gradle layout is internally consistent — for
   example, if your `app/build.gradle` applies `com.facebook.react`,
   then `settings.gradle` must declare a `pluginManagement { … }` block
   that registers `@react-native/gradle-plugin`. If you use the
   React Native ≥ 0.75 settings-plugin, the version in `package.json`
   must match.
7. The security scan reports zero critical findings.

If any check fails, the pipeline stops, marks the build as **rejected**,
and writes a plain-English reason to your job feed for each problem
(e.g. *"Your app/build.gradle does not apply the Android application
plugin (com.android.application)."*). We do not patch, generate, or
substitute anything — the next build runs only after **you** push a fix.

### Expo projects

Expo managed projects do not ship an `android/` directory. There are
two supported ways to build them on SAMP Apps:

1. **Expo (managed)** — submit the Expo source tree as-is and pick
   the **Expo (managed)** project type in the build form. The
   pipeline runs `npx expo prebuild --platform android` for you
   between *Install* and *Inspect*, then proceeds through the same
   strict gate as any other project.
2. **Expo (prebuild committed)** — run `npx expo prebuild --platform android`
   locally, commit the generated `android/`, and submit with the
   **Expo (prebuild committed)** project type. The pipeline uses
   exactly what you committed (no auto-prebuild).

Submitting an Expo source tree as **React Native (bare)** rejects
with a message that points you at the Expo (managed) option. See
`examples/sample-expo-project/` for a worked example.

---

## What the security scan looks for

The scanner reports **critical** findings (which reject the build) and
**warn** findings (which appear in the transparency report but do not
block):

| Code                              | Severity | What it catches                                                     |
| --------------------------------- | -------- | ------------------------------------------------------------------- |
| `runner_secret_token_read`        | critical | Code that reads GitHub Actions runner secrets                       |
| `runner_workspace_path_read`      | critical | Code that reads the build runner's filesystem paths                 |
| `exfil_pastebin_class`            | critical | Calls to anonymous paste / file-host relays (pastebin, ngrok, …)    |
| `exfil_telegram_bot`              | critical | Calls to `api.telegram.org/bot…`                                    |
| `exfil_discord_webhook`           | critical | Posts to Discord webhooks                                           |
| `destructive_rm_root`             | critical | `rm -rf /` (or `/*`) in lifecycle scripts                           |
| `destructive_disk_wipe`           | critical | `dd if=/dev/zero of=/dev/*`, `mkfs`, `shred /dev/*`                 |
| `fork_bomb`                       | critical | Classic shell fork-bomb pattern                                     |
| `miner_xmrig`                     | critical | XMRig, T-Rex, ethminer, nbminer and other miner binaries            |
| `miner_pool_endpoint`             | critical | `stratum+tcp://`, mining pool hostnames                             |
| `lifecycle_curl_pipe_sh`          | critical | `curl … \| sh` / `wget -O- … \| bash` in lifecycle scripts          |
| `obfuscated_eval_buffer`          | warn     | `eval(Buffer.from(…))` / `eval(atob(…))` malware-dropper patterns   |
| `lifecycle_remote_loader`         | warn     | `require('https://…')` / `import('https://…')`                      |

**The scanner does not flag your application's normal credentials.**
A React Native app that reads `process.env.SUPABASE_URL`,
`process.env.NEXT_PUBLIC_*`, a Stripe publishable key, a Netlify
function URL, or any other value belonging to your own product is not
flagged. Those values belong to the user's environment, not ours, and
shipping them in a mobile app is a normal product decision.

The scanner's job is only to detect attempts to attack the build
runner itself: to lift our pipeline secrets, to write to our runner's
filesystem, to ship miners, or to relay stolen data through anonymous
hosts.

---

## Build isolation

- Every build runs on a fresh runner that is destroyed when the build
  finishes. No state is shared between builds.
- Pipeline secrets (the platform's Supabase service-role key, the
  GitHub release token) are scoped to the steps that genuinely need
  them. The steps that run your code (install, bundle, Gradle) never
  see them.
- Before your code is cloned, the runner's git credential header is
  removed so your code cannot read the runner's `GITHUB_TOKEN`.
- Your project is installed with lifecycle scripts disabled
  (`--ignore-scripts`). Anything declared in `preinstall` / `install` /
  `postinstall` / `prepare` is reported in the transparency report but
  is not executed.
- All log output that crosses into our database or the public
  transparency bucket is filtered through a redaction pass that strips
  tokens, runner paths, and base64-looking blobs.

---

## Reading the rejection report

When a build is rejected, the per-job feed shows one entry for every
reason. Each entry is plain English and tells you exactly what is
missing or wrong. There are no Gradle stack traces, Node errors, or
internal file paths in user-facing output. Internal details (what step
crashed, what the underlying tool printed) stay in our CI logs.

If a build is **accepted** but the actual Android compile or signing
later fails, the pipeline marks it as a system error and shows a
generic message — there is nothing for you to fix in your code; we
investigate from our side.

---

## Project layout

```
samp-apps/
    builder/                  # Metro bundler wrapper
    config/                   # React Native ↔ Android toolchain reference
    examples/
        sample-rn-project/                  # bare RN, no android/         (gate rejects)
        sample-rn-project-with-android/     # bare RN, complete android/   (gate accepts)
        sample-expo-project/                # Expo source — submit as Expo (managed)
    github-actions/
        workflows/
            _build-shared.yml      # The shared APK build pipeline (workflow_call)
            react-native.yml       # Entry: bare RN  → repository_dispatch build_react_native
            expo-managed.yml       # Entry: Expo    → builds with auto `expo prebuild`
            expo-prebuild.yml      # Entry: Expo    → uses committed prebuild output
    inspector/                # Strict gate: facts + security + accept/reject
    netlify/                  # Phone web UI (Functions + static assets)
    pipeline/                 # Pre-Gradle health checks, helper scripts
    supabase/
        database-reset.sql    # SINGLE-FILE drop-and-recreate (the only SQL file)
        functions/            # Edge Functions (auth + jobs)
    validator/                # Post-bundle re-validation
    setup.md                  # Phone-only founder setup guide
    package.json
    tsconfig.json
```

---

## Operator deploy steps

If you are running your own SAMP Apps installation:

1. **Push the contents of this directory** (everything inside
   `samp-apps/`) to the root of your build repository on GitHub. Move
   the four files in `github-actions/workflows/` (`react-native.yml`,
   `expo-managed.yml`, `expo-prebuild.yml`, `_build-shared.yml`) into
   `.github/workflows/` so GitHub Actions picks them up. The
   underscore prefix on `_build-shared.yml` is a convention only — it
   is a `workflow_call` reusable workflow invoked by the other three
   entry workflows.
2. **Configure repository secrets** (Settings → Secrets and variables
   → Actions):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   The default `GITHUB_TOKEN` is sufficient for the release step.
3. **Run the database setup**: paste `supabase/database-reset.sql`
   into the Supabase SQL editor and run it once. It drops any prior
   SAMP objects, then re-creates the entire schema, RLS, RPCs,
   transparency layer, storage bucket, and retention sweep in a
   single transaction. This is the only SQL file in the repo — there
   is no incremental path.
4. **Confirm the Storage bucket** named `build-reports` exists in
   Supabase Storage. On free-tier projects you may need to create it
   manually (`public = true`, 25 MB file size limit). The pipeline
   tolerates a missing bucket and falls back to GitHub Actions
   diagnostics.
5. **Deploy the Edge Functions** at `supabase/functions/auth/` and
   `supabase/functions/jobs/`, set their secrets (`SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_OWNER`, `GITHUB_REPO`,
   `GITHUB_TOKEN`).
6. **Deploy the Netlify front-end** by pointing Netlify at the
   `netlify/` subdirectory (publish dir `netlify/public`, functions
   dir `netlify/functions`). Set its env vars to the same
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
7. **Verify a build** by triggering the workflow with a known-good
   `react-native init` repo URL via `workflow_dispatch`.

For a phone-only walkthrough of all of the above, see
[`setup.md`](./setup.md).

---

## Local smoke tests

```bash
cd samp-apps
npm install --ignore-scripts
npm run inspect      -- ./examples/sample-rn-project-with-android /tmp/spec.json
npm run threat-scan  -- ./examples/sample-rn-project-with-android
npm run validate     -- ./examples/sample-rn-project-with-android/android --no-bundle
```

The `sample-rn-project-with-android` fixture omits the real Gradle
wrapper jar so the inspector exits with a clear "missing wrapper jar"
reason — confirming the gate is wired correctly without needing a full
build.
