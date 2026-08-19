# Issue #122 — Manifest Self-Attestation Correction

The blocked `deployment-static` validation on release `23db5f4569264063bae4e4d61f65e828b81ec89a` proved that the worker release manifest generator itself was not part of the worker release tree.

That allowed the worker to retain an older local `scripts/cloud-pipeline-release-manifest.mjs` even while the release produced from the approved source attested all files in its then-current scope. Worker-local focused validation then read the stale generator and failed.

This correction makes `scripts/cloud-pipeline-release-manifest.mjs` both a critical file and a member of the immutable worker release tree. The release generator therefore attests the exact generator source used for future worker packaging and validation.

The recovery cron remains blocked until an exact merged release is deployed and detached `deployment-static` passes with stable provenance. No manual pipeline or recovery execution is part of this correction.
