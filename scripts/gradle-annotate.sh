#!/usr/bin/env bash
# Runs Gradle with the given arguments and, when it fails, repeats its error messages as GitHub
# annotations ("::error::"), shown on the run's page to anyone who can see the run, where the full
# log needs admin rights on the repository (.github/workflows/android-apk.yml).
set -o pipefail
./gradlew "$@" 2>&1 | tee "$RUNNER_TEMP/gradle.log"
code=$?
if [ $code -ne 0 ]; then
  # Gradle's own summary, and the compilers' errors (javac "error:", Kotlin "e: ").
  awk '/What went wrong:/{n=25} n>0{print; n--}' "$RUNNER_TEMP/gradle.log" | grep -v '^\s*$' | head -40 | while IFS= read -r l; do echo "::error::$l"; done
  grep -E '(^e: |error: |FAILED$|Could not (find|resolve)|Duplicate class)' "$RUNNER_TEMP/gradle.log" | head -40 | while IFS= read -r l; do echo "::error::$l"; done
fi
exit $code
