# AI tool disclosure

**Team Cipher · Tech-Triathlon 2026 Hackathon · as of 4 October 2026**

The brief asks us to explain *which work was AI-assisted, which was not, and how we used the tools*. This page answers those three questions, names every tool, and says how we checked the result. It is the written record of our AI use; commit trailers are not a complete record, this document is.

## 1. At a glance

| Question | Answer |
|---|---|
| **Which work was not AI-assisted?** | The problem framing, personas, flows and every screen of the Day 5 design (made in Figma). The planning rules and their priority order, the forced and chosen deferral model, repeat-skip protection and escalation. The offline model and its conflict policy. The scope trade-offs. The datasets and the seeded demo day (deterministic code). **The running product contains no AI at all.** |
| **Which work was AI-assisted?** | Writing and checking code: the planning engine, the API and SQL, the React screens, the Docker and CI files and the main test suite. We used AI as an assistant (suggestions, snippets, explanations and review) and the team wrote, edited and owns the code. Two bounded kinds of work were drafted by an AI agent and reviewed by us: a behaviour-neutral clean-up with some extra unit tests, and the documentation, including this page. |
| **How did we use the tools?** | We wrote the rules, flows and screens first, then used AI to help implement and review them. Every suggestion was read, edited or rejected by a team member, merged through pull requests, and had to pass the build, the type checker and 68 automated tests. |

**Levels used on this page**

| Level | Meaning |
|---|---|
| **Human-authored** | Written or decided by the team. AI was not used. |
| **AI-assisted** | The team wrote and owns it. AI gave suggestions, snippets, explanations or review that we accepted, edited or rejected. |
| **AI-drafted, human-reviewed** | An AI agent produced the first version at a team member's direction. A team member read, tested and approved it. |

## 2. Tools

| Tool | How we used it | Where it shows |
|---|---|---|
| **Claude** (Anthropic), chat | An assistant while building: suggestions, snippets, explanations and review across the engine, API, SQL, screens, Docker/CI files and tests | The AI-assisted rows in section 3 |
| **Claude Code** (Anthropic), VS Code extension | An agent working at a team member's direction on a behaviour-neutral clean-up and extra unit tests (3 to 4 October), and on drafting the documentation (4 October) | Section 3, rows 11 and 12 |
| **Cursor** | An assistant and agent in the editor: aligning scripts (building `@pathwise/core` before the `db:*` commands), checking the driver's offline flows against the code, and drafting documentation | Commits `4793cb5`, `4a3cd1f`, `711d3d9`, `42854b0` |
| **ElevenLabs** | Text-to-speech: it generated the narration voice for the demo video. Nothing else in the video | The demo video |
| **Figma** (not an AI tool) | Our own Day 5 design and importer plugin: the source of truth for layouts, components, colours and flows | The web app, [README](../README.md#departures-from-the-day-5-design) |

## 3. Work breakdown

| # | Area | Level | What AI did | What the team did | Evidence |
|---|---|---|---|---|---|
| 1 | Problem framing, personas, flows and every screen (Designathon, Day 5) | Human-authored | Nothing | Designed it in Figma | The Day 5 design; the web app implements it |
| 2 | Planning rules and their priority order, forced and chosen deferrals, repeat-skip protection, escalation | Human-authored | Nothing | Decided and specified them | [planning-engine.md](planning-engine.md) |
| 3 | Offline model: outbox with the phone's time, idempotent sync, "keep the proof and ask" instead of last write wins | Human-authored | Nothing | Decided it | [degradation.md](degradation.md), [architecture.md](architecture.md#9-architecture-decisions) |
| 4 | Scope trade-offs and departures from the Day 5 design | Human-authored | Nothing | Decided them | [README](../README.md#departures-from-the-day-5-design) |
| 5 | Planning engine (`packages/core`) | AI-assisted | Suggestions, snippets and review | Designed the rules and algorithm; wrote, edited and owns the code | 29 engine tests, including a golden snapshot of every planning decision |
| 6 | API: routes, services and SQL migrations | AI-assisted | Suggestions, snippets and review | Designed the behaviour; wrote, edited and owns the code | 39 API tests on real PostgreSQL, including the whole judge walkthrough |
| 7 | Web app: the React screens that implement the Figma design | AI-assisted | Suggestions, snippets and review | Built the screens against the design; owns the code | The judge walkthrough; strict type checking in CI |
| 8 | Docker, Compose, CI and deployment files | AI-assisted | Suggestions and review | Wrote, tested and owns them | CI on every push, including a `docker compose` smoke test |
| 9 | Main test suites | AI-assisted | Suggestions and review | Chose the cases and the assertions | The suites themselves, run in CI |
| 10 | Datasets and the seeded demo day | None | Nothing | Deterministic code builds the day from the datasets (`demoDay.ts`) | [planning-engine.md](planning-engine.md#4-the-seeded-day) |
| 11 | Behaviour-neutral clean-up and extra unit tests, 3 to 4 October (PR #8): removing unreferenced code, enabling `noUnusedLocals` and `noUnusedParameters`, naming magic numbers, typing the users row and the category table instead of `any`; a planner golden snapshot, a time helper test and database-free API unit tests | AI-drafted, human-reviewed | Claude Code made the edits at a team member's direction | Set the rule that a change had to be provably neutral, reviewed every diff, merged it | Compiler output unchanged, built CSS byte-identical, all tests passing |
| 12 | Documentation and diagrams: the README, the architecture document, this disclosure | AI-drafted, human-reviewed | Cursor and Claude Code drafted text and diagrams; Claude Code re-ran the judge walkthrough against a fresh install and checked every number against the code | Reviewed, corrected and approved the result | Counts and commands re-checked on 4 October; every link and diagram rendered |
| 13 | Demo video | AI-assisted (voice only) | ElevenLabs generated the narration voice | Everything in the video except the voice | n/a |

## 4. What the team decided

- **The problem and the experience:** who the four roles are, what each needs, and what every screen shows.
- **The planning rules:** the priority order (an outlet skipped on the last run first, then days since served, then chilled, then brand), the *forced* versus *chosen* deferral model, and the rule that an outlet skipped yesterday is served first today.
- **The honesty rules:** a stop moves only when the *expected* arrival misses the window, never because a phone is quiet; a delivery recorded offline for a stop that was moved is kept and becomes a decision.
- **The scope:** what to build, what to leave out and why (the [departures from the Day 5 design](../README.md#departures-from-the-day-5-design)).
- **What ships:** every merge was approved by a team member.

## 5. How we used AI

1. **Specify first.** The rules, flows and screens existed before the code. AI helped turn them into code and tests; it did not decide what the product should do.
2. **Read everything.** Every AI suggestion was read by a team member and accepted, edited or rejected. Code we could not explain was rewritten.
3. **Constrain agents.** For agent work (the clean-up) the rule was *only changes that can be shown to be neutral*, and the evidence was the compiler's output, the built CSS and the tests.
4. **Merge through review and CI.** Changes reach `main` through pull requests and a pipeline that builds, type-checks, runs 68 tests and starts the whole stack with `docker compose`.

## 6. How we checked the result

- **Tests against the real rules.** 29 engine tests on the seeded day (143 orders, 135 served, 8 explained deferrals, zero rule breaks, repeat-skip protection, the Kegalle trip on VEH041, a golden snapshot of every decision) and 39 API tests on a real PostgreSQL database: the whole judge walkthrough end to end, security and administration, mocked Supabase Auth and Storage with row-level security checks, and unit tests. All 68 passed on 4 October.
- **Browser run.** On 4 October the judge walkthrough was re-run in a real browser against a freshly installed copy, with the driver, loader and store screens at phone size, including an offline delivery (using the app's No signal switch) that survived a reload. Steps 1 to 9 were driven end to end; the screens of steps 10 and 11 were opened and their behaviour is covered by the API tests.
- **Continuous integration.** Build, type check, both test suites and a `docker compose` health and login smoke test on every push.

## 7. AI in the product

There is none. PathWise makes no call to any AI service and contains no machine-learned model: the planner is a deterministic priority algorithm, the forecast is a closed-form formula over the history, and the arrival-time model is a formula over the dataset's traffic and road-condition indices. We searched the code and the dependency lists for AI and machine-learning libraries and found none.

## 8. Data handling

No raw competition dataset file, and none of its contents, was given to any AI tool. The tools worked inside the repository, which contains compact tables derived from the reference data in `packages/core/src/dataset.ts` and `datasetExtra.ts`; those files were part of the code the tools could read.

## 9. Limits

- AI suggestions can look right and be wrong. We treated them as drafts, and the tests, the type checker and the walkthrough are what we rely on.
- Some explanatory text in the screens and documents was drafted with AI help and edited by us.
- The test counts, commands and numbers on this page were taken from runs on 4 October 2026.

## 10. Confirmation

Team Cipher confirms that this page describes how AI tools were used in this project, as of 4 October 2026.
