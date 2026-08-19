# Issue #122 worker validation dependency attestation

The blocked `deployment-static` validation on release `d711c8983fc4b15ceff95e0d699b2c0afb38040d` exposed a release-provenance gap, not a documentation defect in the approved GitHub source.

At that SHA, `docs/CLOUD-PIPELINE-SETUP.md` already contained both approved cron expressions. The worker-local validation nevertheless saw stale documentation because the immutable worker release manifest did not include the documentation files read by `server/pipelineWorkerRelease.issue104.test.ts`.

This correction makes both worker-validation runbooks part of the attested worker release:

- `docs/CLOUD-PIPELINE-SETUP.md`
- `docs/WORKER-CONTROL-CHANNEL.md`

A worker can no longer be declared exact while either validation dependency remains stale. No production pipeline, recovery, provider, database, cron, environment, or worker process is changed by this source correction.
