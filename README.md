# ApexBot

ApexBot is an AI-assisted Discord moderation and FTC intelligence bot built from scratch for high-volume robotics communities. Every message passes through a fast local safety router; only ambiguous, risky, or statistically audited messages consume an AI call.

## What ships

- Deterministic normalization and safety checks on every message, including leetspeak, zero-width characters, Unicode confusables, blocked terms, phishing, suspicious attachments, spam, mass mentions, threats, doxxing indicators, and new-account risk.
- Context-aware Gemini 2.5 Flash or NVIDIA GPT-OSS-120B classification with strict JSON verdicts, timeouts, fail-safe fallback, and configurable audit sampling.
- `standby` report-only and `active` enforcement modes, independently configurable per server.
- Low, medium, and high moderation strictness.
- Compounding progression counter (PC), warnings, automated escalation, and moderator PC controls.
- Message reporting by `/report`, prefix command, message link/ID, or replying while mentioning ApexBot.
- Slash and configurable prefix command parity (`?` and `!` by default).
- Manual warn, timeout/mute, kick, ban, unban, purge, slowmode, lock, unlock, history, and case workflows.
- FTCScout commands for team search/profile, OPR/quick stats, matches, events, awards, and event details.
- Discord OAuth dashboard authentication restricted to servers where the user has Manage Server or Administrator.
- Firestore-backed server config, cases, progression, and audit logs; Discord logging and moderator channels.
- Responsive mission-control dashboard with overview, case queue, audit stream, guardrails, and command catalog.

## Architecture

```text
Discord Gateway
     │ every message
     ▼
Deterministic router ── safe/short ──► no AI call, no Firestore write
     │ risky / ambiguous / audit / report
     ▼
AI classifier ──► policy + PC compounding ──► standby report OR active action
                                              │
                               Firestore case/log + Discord log channel

Firebase Hosting ── /api rewrite ──► Cloud Run (bot gateway + OAuth API)
      │                                    │
      └── React dashboard             Discord + Firestore + FTCScout
```

The persistent Discord WebSocket runs on Cloud Run with one always-on instance and CPU throttling disabled. Firebase Hosting serves the dashboard, Firestore stores state, and Firebase custom tokens back the Discord OAuth session. This remains one Google/Firebase deployment stack while using the correct runtime for a persistent gateway.

## Local setup

```powershell
Copy-Item .env.example .env
npm install
npm run test
npm run typecheck
npm run build
npm run dev:bot
npm run dev:dashboard
```

With Discord credentials configured, deploy slash commands instantly:

```powershell
npm run deploy:commands
```

Global command registration can take up to an hour. Remove `DISCORD_TEST_GUILD_ID` to register globally.

## Required Discord settings

In the application’s Bot page, enable **Server Members Intent** and **Message Content Intent**. The invite needs these permissions:

- View Channels, Send Messages, Embed Links, Read Message History
- Manage Messages, Moderate Members, Kick Members, Ban Members
- Manage Channels (for lock, unlock, and slowmode)

OAuth redirect URI must exactly match `DISCORD_REDIRECT_URI`.

## Deploy

Deployment is CLI-only. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for project bootstrap, secrets, Firestore, Hosting, Cloud Run, Discord commands, and rollback instructions.

## Safety and privacy

Safe deterministic passes are not persisted. AI-reviewed or signaled messages, cases, moderation actions, configuration changes, and server events are logged. Message evidence is truncated; secrets and auth headers are redacted from application logs. Firestore client writes are denied—configuration changes go through the server-side permission check.

This bot assists moderators. Communities should publish their rules, retention policy, appeal path, and use age-appropriate settings. Automated moderation can be wrong; standby mode is the recommended initial rollout.
