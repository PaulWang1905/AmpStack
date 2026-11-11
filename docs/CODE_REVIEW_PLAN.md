# Code review and improvement plan

Date: 2026-11-11

Scope: playback and queue reliability, regression coverage, and routine CI.
Keep the existing interface and library format.

1. Inspect the frontend store, event lifecycle, Rust playback commands, library
   deletion, and build configuration. Establish the available validation tools.
2. Reconcile the queue after track/folder removal; reload stopped tracks before
   playing; prevent overlapping or stale playback polls from advancing the queue.
3. Dispose event listeners even when registration resolves after unmount, and
   report registration errors.
4. Add focused store and listener regression tests. Run frontend tests/builds and
   Rust checks on pushes and pull requests, independently of release tagging.
5. Run available checks, review the diff, and record results and remaining risks.

Validation: mocked Tauri commands and deferred responses exercise queue changes,
stop/resume, natural completion, and asynchronous cleanup without an audio device.
The production build checks TypeScript and bundling. Rust compilation requires a
Rust toolchain and Tauri's native dependencies; desktop playback still needs a
manual smoke test on a machine with audio output.

## Results

- Implemented queue reconciliation, stopped-track reload, guarded polling,
  listener cleanup, and clearing playback when its library folder is removed.
- Added 24 regression tests and the push/pull-request Checks workflow.
- Passed a clean install from the updated lockfile, `npm test`, `npm run build`,
  workflow YAML parsing, and `git diff --check`.
- Local Rust compilation and desktop audio smoke testing remain unverified:
  this environment has no Rust toolchain or GTK/WebKit/ALSA development packages.
  The backend CI job is configured but has not been executed in this review.

Follow-up areas outside this patch: native integration tests, database migration
error handling, and the existing URL-validation/network boundary. This review
does not constitute a complete security audit.
