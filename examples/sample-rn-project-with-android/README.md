# Sample React Native project — Android demo

A small but real React Native application used to exercise the SAMP Apps
build platform end-to-end. The JavaScript app is a **Field Notes**
prototype: list notes, create a note (optionally with a location stamp),
and an About tab.

## What it shows

- A complete `android/` directory at the project root.
- A working Gradle wrapper (`gradlew`, `gradle/wrapper/*`).
- An `AndroidManifest.xml` declaring only the permissions the app
  actually uses (`ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`,
  `INTERNET`).
- A standard React Native Gradle plugin layout in `app/build.gradle`
  and `settings.gradle`.

## How the build platform uses it

This sample is the canonical "happy path" repository for SAMP Apps. The
strict gate inspects the repository, finds nothing missing, and the
pipeline produces an installable APK with the application label
**SAMP APPS Android Demo**.

The bundled wrapper jar is intentionally a stub so the gate exits with
a clear "missing wrapper jar" reason in local smoke tests; replace it
with the real `gradle-wrapper.jar` from a fresh `npx react-native init`
checkout to run a full local build.
