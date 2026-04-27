# Sample Expo project — for SAMP Apps

A minimal Expo React Native app (a single notes screen) used to
demonstrate how SAMP Apps builds Expo projects.

## Two ways to build this project on SAMP Apps

SAMP Apps offers three project types in the build form. Two of them
work for an Expo source tree like this one:

### 1. Expo (managed) — recommended

This is the easiest path. In the SAMP Apps build form, paste this
folder's Git URL and pick **Expo (managed)** as the project type.

What happens server-side:

1. SAMP Apps clones your repo.
2. The pipeline runs `npx expo prebuild --platform android` for you,
   generating a real `android/` directory from your `app.json`.
3. The strict gate inspects the generated `android/` exactly the same
   way it inspects a hand-written one. If the prebuild output is
   complete (it should be, for a vanilla Expo app), the gate accepts
   and the build proceeds.

You never have to run `expo prebuild` yourself. You never have to
commit `android/` to your repo. Just push your Expo source and queue
a build.

### 2. Expo (prebuild committed) — for power users

If you have already run `npx expo prebuild --platform android`
locally and committed the generated `android/` folder to your
repository, pick **Expo (prebuild committed)** in the build form.

The pipeline skips the prebuild step (your committed output is used
verbatim) and goes straight to inspect → bundle → gradle. This path
is useful when you have hand-edited the prebuild output (for example
to add a custom Gradle dependency) and want SAMP Apps to use exactly
what you committed.

### Why not pick "React Native (bare)"?

If you submit this folder as **React Native (bare)** the strict gate
will reject it with a helpful message — bare React Native expects
`android/` to be present in the repo. The rejection text points you
back to the Expo (managed) option.

## Source layout

```
sample-expo-project/
    App.tsx              # the actual app — a tiny notes screen
    app.json             # Expo config: package name, app name, icon, plugins
    babel.config.js      # babel-preset-expo
    index.js             # Expo entry point
    package.json         # Expo SDK 51 + React Native 0.74
    tsconfig.json        # extends expo/tsconfig.base
    .gitignore           # excludes node_modules, .expo, etc.
```

## Why we don't include a prebuilt `android/` in this example

`expo prebuild` output depends on your installed Expo SDK version,
the plugins listed in `app.json`, and the package name. Committing a
single hand-crafted `android/` here would make this example fragile
and misleading. The **Expo (managed)** workflow generates a fresh
`android/` from these exact files every build, which is always
consistent with the source.
