# Documentation

PathWise documentation, organised by what you want to do. The project overview, the live demo, the seeded accounts and the judge walkthrough are in the [main README](../README.md).

## If you are reviewing the submission

| Read | To see |
|---|---|
| [README](../README.md) | The live demo, the five seeded accounts, the 15-minute judge walkthrough, setup and configuration, and the departures from the Day 5 design |
| [Architecture](architecture.md) | How the system is built: context, use cases, containers, components, data architecture, runtime sequences, deployment, security, decisions and traceability (23 figures) |
| [Data model](data-model.md) | The 26 tables in four domain views, the allowed values and the integrity rules |
| [AI disclosure](ai-disclosure.md) | Which work was AI-assisted, which was not, and how the tools were used |

## If you are working on the code

| Read | To see |
|---|---|
| [Planning engine](planning-engine.md) | The trip-time formula, every validation rule, the auto-planner, expected arrival times, the forecast and the peak-day checker |
| [API reference](api.md) | Every endpoint by role, with the error model |
| [When things go wrong](degradation.md) | Fifteen failure scenarios (A to O) and how the system behaves in each |
| [Architecture decisions](architecture.md#9-architecture-decisions) | Why the system is built the way it is, and what each choice costs |
| [Contributing](../CONTRIBUTING.md) | How to run, test and change the project |

## If you are running or securing it

| Read | To see |
|---|---|
| [Supabase setup](supabase.md) | Project, keys, Auth, Storage, migrate, seed and deploy (Railway, Render or any Docker host) |
| [Security](security.md) | Accounts and roles, sign-in, sessions, data protection and the secrets checklist |
| [Deployment views](architecture.md#7-deployment) | Production, Docker Compose and laptop topologies, the boot sequence and the CI pipeline |
| [Configuration reference](../README.md#configuration-reference) | Every environment variable and its default |

## Requirements and design inputs

The user stories written for the Designathon, one per role, which the build implements and the [use-case diagram](architecture.md#figure-2-use-cases) traces back to.

| Role | User stories |
|---|---|
| Dispatcher | [Dispatcher_User_Stories.md](user_stories/Dispatcher_User_Stories.md) |
| Loader | [Loader_User_Stories.md](user_stories/Loader_User_Stories.md) |
| Driver | [Driver_User_Stories.md](user_stories/Driver_User_Stories.md) |
| Store manager | [Store_Manager_User_Stories.md](user_stories/Store_Manager_User_Stories.md) |

## Diagrams and images

Diagrams in these documents are Mermaid blocks, which GitHub renders directly; edit the text. The one exception is the use-case diagram, an SVG at [`assets/diagrams/use-cases.svg`](assets/diagrams/use-cases.svg). The product screenshots in the README are in [`assets/screenshots/`](assets/screenshots).
