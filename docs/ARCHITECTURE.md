# Architecture and moderation design

## Resource-aware routing

The router is intentionally asymmetric: missing an obvious violation is expensive, but asking AI to classify every greeting is wasteful.

Every message receives normalization plus deterministic checks. The router strips zero-width characters, folds common Unicode confusables and leetspeak, collapses evasion punctuation, and preserves link punctuation. It then scores:

- built-in and server-specific blocked terms;
- hate terms, threat language, harassment cues, scams, and doxxing indicators;
- URLs, lookalike Discord/Steam domains, suspicious TLDs, and executable attachments;
- mass mentions, `@everyone`, repeated content, character flooding, and excessive capitals;
- account/member age combined with links or mentions;
- reply context and recent same-author messages.

Messages shorter than five normalized characters with no signal never call AI. Ordinary short conversation also bypasses AI. High scores, ambiguous contextual risk, forced reports, and a deterministic sample of otherwise eligible traffic go to AI. The audit sample is stable per message ID so retries cannot change routing.

Default audit rates are 1%, 3%, and 7% for low, medium, and high strictness. The dashboard may raise this to 25%.

## AI contract

The model returns strict JSON: harmful, confidence, severity, categories, recommended action, PC delta, reason, evidence, and whether context changed the verdict. Temperature is zero, messages are treated as untrusted data, outputs are clamped, and calls time out. If AI is unavailable, deterministic high-confidence matches still act; ambiguous cases degrade to reports.

## Enforcement and progression

PC compounds independent offenses:

| PC | Baseline consequence |
|---:|---|
| 1 | Warning |
| 2 | Delete |
| 3–5 | Timeout (10 minutes → 1 hour → 1 day) |
| 6–7 | Kick |
| 8+ | Ban |

Critical severity can jump directly to kick or ban. AI confidence must cross the selected strictness threshold before enforcement. In standby, every non-allow outcome becomes an open report and PC is not advanced.

## Data model

```text
guilds/{guildId}                       server configuration
guilds/{guildId}/members/{userId}      PC and warning counters
guilds/{guildId}/cases/{caseId}        moderation case + evidence
guilds/{guildId}/logs/{logId}          audit event
```

All IDs are Discord snowflakes stored as strings. ISO timestamps support the in-memory development adapter; Firestore logs also receive a server timestamp. Client-side writes are denied by security rules.

## Availability model

The API and gateway share one process so command actions and OAuth server discovery see identical Discord state. Cloud Run is pinned to one minimum and maximum instance because two gateway instances would duplicate message handling. Instance-based CPU keeps the WebSocket alive when no HTTP request is active. LRU caches reduce Firestore and FTCScout reads.
