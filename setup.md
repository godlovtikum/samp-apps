# SAMP Apps — Founder Setup Guide

Build a hosted React-Native APK builder **entirely from your phone**.
This guide assumes you have only an Android phone and a browser. No
laptop, no Android Studio, no Gradle CLI.

---

## What you are setting up

Three free-tier services work together:

| Service        | Job                                             | Plan you need |
|----------------|-------------------------------------------------|---------------|
| **GitHub**     | Hosts the build code + runs the build pipeline | Free          |
| **Supabase**   | Database + Edge Functions orchestrating the system    | Free          |
| **Netlify**    | The web UI you interact with on your phone             | Free          |

End result: a URL on your phone where you paste a React-Native repo URL and minutes later you download a real `.apk`.

---

## Before you start

You need:

- A phone with a browser.
- A working email address.
- About 30 minutes the first time.

You **do not** need:

- A laptop, an Android SDK, Java, Node, or Gradle.
- Paid plans on any service.

---

## Step 1 — Get the SAMP code into your own GitHub

You will host two GitHub repositories:

- **Build repo**: holds the SAMP pipeline + GitHub Actions workflow
  that compiles APKs.
- (Optional) **Web repo**: holds the Netlify-deployed phone UI. You
  can also upload the same `samp-apps/` folder to a single repo and
  just point Netlify at the `netlify/` subfolder — that is simpler and
  is what this guide assumes.

On your phone:

1. Open **github.com** and sign in (create an account if needed).
2. Tap the **+** in the top bar → **Import repository** (or **New
   repository** if you are uploading manually).
3. Name it `samp-apps`. Make it **private**.
4. Upload the `samp-apps/` folder from this project. The GitHub web
   editor lets you upload a folder at a time — use **Add file → Upload
   files** and drag the folder in.
5. Once uploaded, go to **Settings → Actions → General**. Under
   *Workflow permissions* choose **Read and write permissions** and
   tick **Allow GitHub Actions to create and approve pull requests**.
   Save.
6. The build engine is split across **four** workflow files in
   `samp-apps/github-actions/workflows/`:

   | File                  | What it builds                              |
   |-----------------------|---------------------------------------------|
   | `react-native.yml`    | Bare React Native repos (committed android/) |
   | `expo-managed.yml`    | Expo source — pipeline runs `expo prebuild` |
   | `expo-prebuild.yml`   | Expo where you committed the prebuild output |
   | `_build-shared.yml`   | The shared pipeline the three above call   |

   GitHub only runs workflows from `.github/workflows/`. On the
   GitHub web UI, open each of the four files and use **⋯ → Move
   file** to move them, keeping the same filenames, into
   `.github/workflows/`. (You can also upload the whole folder by
   creating `.github/workflows/` first, deleting the four files from
   their old location, and re-uploading them at the new path.)

Done. The build engine is now installed.

---

## Step 2 — Create the Supabase project

On your phone:

1. Open **supabase.com** and sign in with GitHub.
2. Tap **New project**. Pick the closest region. Use any name (e.g.
   `samp-apps`). Set a strong database password — write it down; you
   will not see it again.
3. Wait ~2 minutes for the project to provision.

### 2a. Run the database setup

1. In the Supabase dashboard, open **SQL Editor → New query**.
2. Open `samp-apps/supabase/database-reset.sql` in another tab on your
   phone, copy the entire contents, paste into the editor, tap **Run**.
   This creates every table, policy, RPC, and the storage bucket.

### 2b. Confirm the storage bucket

Open **Storage** in the left sidebar. You should see a bucket called
`build-reports`. If it is missing (free tier sometimes blocks the
auto-create):

- Tap **New bucket**, name it exactly `build-reports`, mark it
  **Public**, set max file size to `25 MB`, and save.

### 2c. Deploy the Edge Functions

Edge Functions are SAMP's brain. There are two:

- `auth` — handles sign-up, sign-in, session validation.
- `jobs` — creates build jobs and triggers GitHub Actions.

On the dashboard:

1. Open **Edge Functions** in the sidebar.
2. Tap **Deploy a new function**. Name it `auth`. In the editor, paste
   the entire contents of `samp-apps/supabase/functions/auth/index.ts`.
   The function imports its handlers from sibling files; the easiest
   way is to copy each file (`handlers/signup.ts`, `handlers/signin.ts`,
   `handlers/validate.ts`, `handlers/logout.ts`, plus the shared files
   under `_shared/`) into the same Function workspace, keeping the
   folder structure. Deploy.
3. Repeat for `jobs`, copying the files under
   `samp-apps/supabase/functions/jobs/`.

If the Edge Function dashboard does not let you create folders, install
the Supabase CLI on a computer once and use `supabase functions deploy
auth` and `supabase functions deploy jobs`. (You can borrow a friend's
laptop for this 5-minute step, or use a free in-browser shell like
**replit.com**.)

### 2d. Set the Edge Function secrets

In Supabase, open **Edge Functions → Manage secrets**. Add these four:

| Name                        | Where to find it                                          |
|-----------------------------|-----------------------------------------------------------|
| `SUPABASE_URL`              | *Project URL*  is automatically injected                  |
| `SUPABASE_SERVICE_ROLE_KEY` | *service_role* (secret)   also automatically injected     |
| `GITHUB_OWNER`              | Your GitHub username (e.g. `godlovtikum`)               |
| `GITHUB_REPO`               | The build-repo name (`samp-apps`)                         |
| `GITHUB_TOKEN`              | Created in step 3 below — leave blank for now             |

Save. Come back to add `GITHUB_TOKEN` after step 3.

---

## Step 3 — Create the GitHub token

1. On GitHub, tap your avatar → **Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token**.
2. Settings:
   - **Token name**: `samp-apps-dispatch`
   - **Expiration**: 90 days (re-issue when it expires)
   - **Repository access**: *Only select repositories* → pick your
     `samp-apps` build repo
   - **Permissions** → Repository permissions:
     - **Actions**: Read and write
     - **Contents**: Read and write
     - **Metadata**: Read-only (auto)
3. Tap **Generate token**. Copy it immediately.
4. Go back to Supabase → **Edge Functions → Manage secrets**, paste
   the token into `GITHUB_TOKEN`, save.


---

## Step 4 — Deploy the Netlify web UI

1. Open **netlify.com**, sign in with GitHub.
2. Tap **Add new site → Import an existing project → GitHub** and
   pick your `samp-apps` repo.
3. **Build settings**:
   - **Base directory**: `netlify`
   - **Publish directory**: `netlify/public`
   - **Functions directory**: `netlify/functions`
   - **Build command**: leave empty
4. **Site settings → Environment variables**, add:

   | Name                        | Value                                |
   |-----------------------------|--------------------------------------|
   | `SUPABASE_URL`              | The Supabase Project URL             |
   | `SUPABASE_SERVICE_ROLE_KEY` | The Supabase service_role key        |

5. Tap **Deploy site**. Wait ~1 minute. Open the site URL Netlify
   gives you.

You should see the SAMP Apps sign-in screen.

---

## Step 5 — First build

1. On the deployed site, **Create account** with your email and a password (≥ 8 characters).
2. Tap **+ New** in the bottom tab bar.
3. Paste a React Native Git URL and pick the **project type**:
   - **React Native (bare)** — your repo already contains an `android/` directory.
   - **Expo (managed)** — your repo is an Expo project; SAMP runs `expo prebuild` for you.
   - **Expo (prebuild committed)** — your repo is Expo *and* you committed the prebuild output yourself.

   The known-good demo for the bare path is the React Native team's
   official template: `https://github.com/react-native-community/template`
   on branch `main`. For the Expo (managed) path, point at
   `samp-apps/examples/sample-expo-project/`.
4. Tap **Queue build**. Watch the timeline tick through *Clone →
   Preflight → Install → (Expo prebuild, if applicable) → Inspect →
   Bundle → Validate → Pre-Gradle → Gradle → Sign → Publish*.
5. When it succeeds, the **Download APK** button appears. Tap it,
   install the APK on your phone (you may need to allow installs from
   unknown sources), and confirm it runs.

If the build is **rejected**, the timeline will tell you exactly what
the inspector found. The most common rejection on first runs is
*"Strict mode requires a complete android/ directory at the project
root"* — usually because an Expo project was submitted as **React
Native (bare)**. Re-queue it as **Expo (managed)** and SAMP will
generate the `android/` for you. See the *Examples* section below
for what a passing repo looks like.

---

## Examples (already in this folder)

- `examples/sample-rn-project/` — a bare React Native source tree
  *without* `android/`. Submitting this URL demonstrates the strict
  rejection message the user sees when their project is missing the
  Android wrapper.
- `examples/sample-rn-project-with-android/` — bare React Native
  *with* a complete `android/` tree (the wrapper jar is intentionally
  empty so the gate rejects with the exact wrapper-missing message —
  swap in a real `gradle-wrapper.jar` to see a green build).
- `examples/sample-expo-project/` — a small Expo app. Submit its Git
  URL with project type **Expo (managed)** and the pipeline will run
  `expo prebuild` for you. Submitting it as **React Native (bare)**
  rejects on purpose — see its `README.md`.

---

## Day-2 operations

- **Watch a live build**: Tap the build in **History** to see the
  per-stage timeline update every ~12 seconds.
- **Re-deploy the UI**: Push to your GitHub repo → Netlify rebuilds
  automatically.
- **Re-deploy the Edge Functions**: Edit in the Supabase dashboard
  and tap **Deploy**. (Or run `supabase functions deploy <name>` if
  you set up the CLI.)
- **Reset the database**: Run `supabase/database-reset.sql` again. It
  wipes every user / build / report and re-installs cleanly. **Only
  use this on a fresh install — it deletes data.**
- **Rotate the GitHub token**: Generate a new one, paste it into
  Supabase → Edge Function secrets → `GITHUB_TOKEN`. Old token can be
  revoked on GitHub immediately after.
- **30-day retention**: The `retention_sweep()` function runs nightly
  at 03:15 UTC and clears reports older than 30 days. You can run it
  on demand from Supabase **SQL Editor**: `select
  public.retention_sweep();`

---

## Troubleshooting

| Symptom                                   | What to check                                                                                       |
|-------------------------------------------|-----------------------------------------------------------------------------------------------------|
| "Server misconfigured" on sign-in         | Netlify env vars `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are missing or wrong.                 |
| "GitHub not configured" when queuing      | Supabase Edge Function secrets `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_TOKEN` are missing.         |
| Build stays in "queued" forever           | The four workflow files are not under `.github/workflows/`, or the token lacks Actions write access. |
| Inspect succeeds but Gradle fails         | This is a system error on our side — re-run; if it persists, share the public report URL.           |
| Build rejected with "complete android/ directory" message | You submitted an Expo project as **React Native (bare)**. Re-queue it as **Expo (managed)** so SAMP runs `expo prebuild` for you. |
| "Storage upload returned HTTP 404"        | The `build-reports` bucket does not exist in Supabase Storage. Create it manually (Step 2b).        |
| The downloaded APK won't install on phone | Allow *Install unknown apps* for your browser in Android Settings → Apps.                           |

---

## What the platform does NOT do

- It does not edit, generate, or "fix" your project.
- It does not retain your source code after the build runner is
  destroyed.
- It does not read your application's secrets — `process.env.*` values
  inside your React Native app are your business, not ours.
- It does not run `preinstall` / `install` / `postinstall` / `prepare`
  scripts from your `package.json` (they are reported but skipped).

If a build is rejected, the only fix is to push a correction to your
own repository and queue the build again.
