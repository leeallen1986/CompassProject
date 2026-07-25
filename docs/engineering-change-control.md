# Engineering change control

## Ownership

Architecture, source-code changes, branch management, pull-request content,
review findings, test gates, merge decisions and approved immutable release SHAs
are controlled by the OpenAI engineering controller acting for the repository
owner.

Manus is an execution environment for explicitly authorised deployment and
production verification only.

## Manus boundary

Manus may:

- deploy one immutable merge SHA explicitly approved in writing;
- run the exact deployment and read-only verification commands supplied;
- return raw evidence and stop when a gate fails.

Manus must not autonomously:

- write or amend application code;
- create or modify branches, commits or pull requests;
- merge or choose a release SHA;
- deploy a pull-request head or floating branch name;
- create or run migrations;
- modify production data, trigger pipelines, call providers or send email;
- perform remediation or rollback without a separate exact instruction.

## Required release gates

A trust-boundary pull request cannot be approved until all of the following pass
on the exact final head:

1. frozen dependency installation;
2. `pnpm tsc --noEmit` with zero errors;
3. focused trust-boundary and contact-reconciliation regression tests;
4. the full test suite;
5. the production build;
6. review of the complete final diff;
7. confirmation that no unapproved migration, provider call or production write
   is included.

Deployment authorisation identifies one immutable squash-merge SHA. No branch
name, open pull request, draft pull request or unmerged head is deployment
authorisation.
