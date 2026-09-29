# AI tool disclosure

Team Cipher used AI assistance during the Hackathon, as allowed by the rules. This page says what was used, for what, and how we checked it.

## Tools

| Tool | Used for |
|---|---|
| Claude (Anthropic), in the Claude app with code execution | Pair-programming: scaffolding the monorepo, drafting the API routes and SQL, the planning engine's first version, React screens from our Day 5 Figma design, tests, Docker/CI files and these docs. |
| Figma (our own Day 5 design and custom importer plugin) | The source of truth for layouts, components, colours and flows that the web app implements. |

No AI was used to generate or alter the competition datasets. The seeded delivery day is produced by deterministic code (`packages/core/src/demoDay.ts`) from the datasets.

## What the team decided (not the AI)

- The problem framing, personas, flows and every screen (Designathon, Day 5).
- The planning rules and their priority order, the forced/chosen deferral model, repeat-skip protection and escalation.
- The offline model: outbox with device time, idempotent sync, "keep the proof and ask" on conflicts instead of last-write-wins.
- The scope trade-offs listed in the README ("Departures from the Day 5 design").

## How we checked AI-assisted work

- **Tests against the real rules.** The planning engine has unit tests on the seeded day (143 orders → 135 served, 8 explained deferrals, 0 rule breaks, repeat-skip protection, the Kegalle trip on VEH041). The API has an end-to-end test of the whole judge walkthrough against a real PostgreSQL database (order → auto-plan → rule break caught → publish → dock shortfall → decision → release → offline delivery → sync conflict → decision → receipt issue).
- **Browser walkthrough.** Every step of the README walkthrough was run in a real browser (desktop, tablet and phone sizes), including a true offline test: the driver app reloaded with the network off, recorded a delivery, and synced it on reconnect.
- **Line-by-line review.** Every AI-drafted file was read and edited by a team member; generated code that we could not explain was rewritten.

## Limits we are aware of

- Some explanatory text in the UI and docs was drafted with AI help and edited by us.
- AI suggestions can look plausible and be wrong; we treated them as drafts, and the tests above are what we rely on.
