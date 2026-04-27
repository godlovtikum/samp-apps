#!/usr/bin/env bash
#
# run-gradle.sh — Strict-mode Gradle invoker.
#
# The strict pipeline accepts only repositories that ship a complete,
# valid Gradle wrapper. This invoker therefore does NOT stage a wrapper
# and does NOT fall back to a system Gradle. It performs the minimum
# environmental hygiene required to launch the user's wrapper:
#
#   * resolves JAVA_HOME (derives from PATH if unset)
#   * normalises CRLF line endings on the wrapper script (defence in
#     depth — preflight already accepted the repo)
#   * verifies the wrapper jar contains GradleWrapperMain
#
# Any unrecoverable wrapper problem is a system error; the strict gate
# was responsible for catching project-side wrapper omissions earlier.
#
# Usage:
#   run-gradle.sh <android-root> <gradle-args...>
#
# Exit codes:
#   0   Gradle exited 0.
#   N   Gradle's own non-zero exit code, propagated.
#   2   No usable Java.
#   3   Wrapper missing or unhealthy after hygiene pass.
#   64  Bad arguments.

set -euo pipefail

ANDROID_ROOT="${1:-}"
if [ -z "$ANDROID_ROOT" ] || [ ! -d "$ANDROID_ROOT" ]; then
    echo "[run-gradle] usage: run-gradle.sh <android-root> <gradle-args...>" >&2
    echo "[run-gradle] android-root '$ANDROID_ROOT' is not a directory" >&2
    exit 64
fi
shift

ANDROID_ROOT="$(cd "$ANDROID_ROOT" && pwd)"
cd "$ANDROID_ROOT"

log() { printf '[run-gradle] %s\n' "$*"; }

# --- 1. Java -------------------------------------------------------------
if [ -z "${JAVA_HOME:-}" ]; then
    if command -v java >/dev/null 2>&1; then
        java_binary="$(command -v java)"
        java_real="$(readlink -f "$java_binary" 2>/dev/null || echo "$java_binary")"
        JAVA_HOME="$(dirname "$(dirname "$java_real")")"
        export JAVA_HOME
        log "JAVA_HOME was unset; derived from PATH → $JAVA_HOME"
    else
        log "FATAL: no 'java' on PATH and JAVA_HOME is not set."
        exit 2
    fi
fi
if [ ! -x "$JAVA_HOME/bin/java" ]; then
    log "FATAL: JAVA_HOME=$JAVA_HOME but \$JAVA_HOME/bin/java is not executable."
    exit 2
fi
log "java: $("$JAVA_HOME/bin/java" -version 2>&1 | head -1)"

# --- 2. Wrapper hygiene (no staging, no fallback) ------------------------
if [ ! -f gradlew ]; then
    log "FATAL: gradlew is missing. Strict mode requires the project to ship a wrapper."
    exit 3
fi

if grep -q $'\r' gradlew 2>/dev/null; then
    log "stripping residual CR characters from gradlew"
    sed -i 's/\r$//' gradlew
fi
chmod +x gradlew

if [ ! -s gradle/wrapper/gradle-wrapper.jar ]; then
    log "FATAL: gradle/wrapper/gradle-wrapper.jar is missing or empty."
    exit 3
fi
if [ ! -s gradle/wrapper/gradle-wrapper.properties ]; then
    log "FATAL: gradle/wrapper/gradle-wrapper.properties is missing or empty."
    exit 3
fi

verify_wrapper_main_class() {
    local jar="$1"
    if command -v unzip >/dev/null 2>&1; then
        unzip -l "$jar" 2>/dev/null | grep -q 'org/gradle/wrapper/GradleWrapperMain\.class'
        return $?
    fi
    if command -v jar >/dev/null 2>&1; then
        jar tf "$jar" 2>/dev/null | grep -q '^org/gradle/wrapper/GradleWrapperMain\.class$'
        return $?
    fi
    if command -v node >/dev/null 2>&1; then
        node -e "
            const fs=require('fs');
            const buf=fs.readFileSync(process.argv[1]);
            let eocd=-1;
            for (let i=buf.length-22; i>=Math.max(0, buf.length-65557); i--) {
                if (buf.readUInt32LE(i) === 0x06054b50) { eocd=i; break; }
            }
            if (eocd<0) process.exit(1);
            const n=buf.readUInt16LE(eocd+10), off=buf.readUInt32LE(eocd+16);
            let p=off;
            for (let i=0; i<n; i++) {
                const fnLen=buf.readUInt16LE(p+28);
                const exLen=buf.readUInt16LE(p+30);
                const cmLen=buf.readUInt16LE(p+32);
                const name=buf.slice(p+46, p+46+fnLen).toString();
                if (name === 'org/gradle/wrapper/GradleWrapperMain.class') process.exit(0);
                p += 46 + fnLen + exLen + cmLen;
            }
            process.exit(1);
        " "$jar"
        return $?
    fi
    return 1
}

if ! verify_wrapper_main_class gradle/wrapper/gradle-wrapper.jar; then
    log "FATAL: gradle/wrapper/gradle-wrapper.jar lacks org.gradle.wrapper.GradleWrapperMain."
    exit 3
fi

log "  ✓ gradlew + wrapper jar (with GradleWrapperMain) + properties present"
log "    $(grep -E '^distributionUrl' gradle/wrapper/gradle-wrapper.properties || echo 'no distributionUrl')"

# --- 3. Run --------------------------------------------------------------
log "invoking: ./gradlew $*"
exec env JAVA_HOME="$JAVA_HOME" ./gradlew "$@"
