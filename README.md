# Kindred

[![Project checks](https://github.com/JackivGarg/Kindred/actions/workflows/checks.yml/badge.svg)](https://github.com/JackivGarg/Kindred/actions/workflows/checks.yml)

A mental health peer-support community built with React, TypeScript, Vite and Supabase. People can share a check-in, reply with support, explore global or regional posts, and request a private conversation. Direct messages require the recipient to accept first. Members can report content and block other members.

## Run locally

Requires a current Node.js release supported by the installed Vite version and npm.

```sh
npm install
npm run dev
```

Leave both Supabase environment variables empty to explore the fictional demo. Demo changes stay in the browser's session storage; sample people are fictional and messages do not reach real people. Clearing the browser session discards the demo state. Do not enter sensitive personal information into a shared browser.

```sh
npm test
npm run build
npm run check:bundle
npm run preview
```

The configured local project runs at [localhost:3000](http://localhost:3000).
Use [the fictional demo](http://localhost:3000/?demo=1) to explore without an
account. `npm run test:live` runs read-only authentication and signed-out access
checks against the configured Supabase project; it never creates user content.

For a real community, follow [the setup guide](docs/SETUP.md) and connect a **new, separate Supabase project**. Existing projects must not receive this schema.

## Product boundaries

This is an adults-only pilot intended for peer support. It is not a clinical service, and reports are not an emergency response channel. A person must operate the moderation queue before inviting a community.

Regional settings control discovery, not confidentiality: signed-in community members can access regional posts. Use a nickname and avoid sharing precise locations or identifying details. Direct messages are access-controlled in the database but are **not end-to-end encrypted**. Operators with privileged database access can access stored data.

Database row-level policies enforce ownership, conversation participation, message-request acceptance and blocking. The test suite includes repository behavior checks and database policy tests. A local test run is not a substitute for verifying the final Supabase configuration and redirects before release.

Frontend regression tests exercise real React components in jsdom, including
StrictMode support actions, posting boundaries, duplicate-submit protection,
recipient consent before messaging, and dialog Escape/focus restoration.

For the release path, follow [Azure deployment](docs/DEPLOY.md). It includes a
Free-site preparation command, production preflight and a manual deployment
workflow. Configure [signup email](docs/EMAIL-SETUP.md) once before inviting people.
No Azure resources are created by running the local app or ordinary checks.

See the [performance measurements](docs/PERFORMANCE.md) and
[300-member launch preparation](docs/LOAD-READINESS.md) for the tested improvements,
capacity assumptions and email-delivery requirements.

The live inbox currently shows the newest 100 conversations by creation time,
with the latest 200 messages in an opened conversation. Block management shows
the newest 500 blocked members. These screens do not yet provide older-history
pagination; database blocks remain effective beyond the displayed list.
