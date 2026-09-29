# Contributing to PathWise

Thank you for your interest in contributing to PathWise! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful and professional in all interactions. We're building this together.

## Getting Started

### Prerequisites

- Node.js 20 or newer (https://nodejs.org)
- Git
- PostgreSQL 14+ (optional if using Docker or local PostgreSQL)

### Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Cipher_PathWise.git
   cd Cipher_PathWise
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run locally**
   ```bash
   npm run local        # With Docker (recommended)
   # OR
   npm run dev          # With your own PostgreSQL
   ```

## Development Workflow

### Branching

- Create feature branches from `main`: `git checkout -b feature/your-feature-name`
- Use descriptive branch names: `feature/`, `fix/`, `docs/`, `refactor/`
- Keep branches focused on a single concern

### Commits

- Write clear, descriptive commit messages
- Reference issue numbers when applicable: `fix: resolve issue #123`
- Keep commits atomic and logical

### Code Style

- **TypeScript**: Strict mode enabled everywhere
- **Linting**: Run `npm run typecheck` before committing
- **Testing**: Run `npm test` to ensure all tests pass
- **Formatting**: Code should follow the existing style

### Testing

Before submitting a pull request:

```bash
npm run typecheck     # Type checking
npm test              # Run all tests
npm run build         # Build the project
```

## Making Changes

### Planning Engine (`packages/core`)

- Pure TypeScript, no side effects
- All validation rules centralized here
- Unit tests in `packages/core/test/`
- Changes affect the planner, validator, and API

### API (`apps/api`)

- Fastify-based REST API
- Plain SQL migrations in `apps/api/src/migrations`
- Business logic in `apps/api/src/services`
- End-to-end tests in `apps/api/test/`

### Web App (`apps/web`)

- React 19 + Vite + Tailwind CSS
- Role-based routes: dispatcher (`/d`), loader (`/l`), driver (`/r`), store (`/s`)
- Service worker for offline support

### Database

- All migrations are append-only
- Use transactions for multi-row changes
- Transactions wrap every state change in `stop_events` and `audit_log`

## Pull Request Process

1. **Create a clear PR title and description**
   - What does it do?
   - Why is it needed?
   - How should it be tested?

2. **Ensure all checks pass**
   - CI must pass (build, typecheck, tests)
   - No merge conflicts with `main`

3. **Request review**
   - Tag relevant reviewers
   - Wait for approval before merging

4. **Merge**
   - Squash and merge for cleaner history (optional)
   - Delete the branch after merging

## Documentation

- Update relevant docs in `docs/` for architectural changes
- Keep comments minimal; code should be self-documenting
- Update README if adding new features or dependencies

## Reporting Issues

When reporting bugs, include:

- Description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node version, etc.)
- Screenshots or logs if applicable

## Performance and Security

- Avoid N+1 queries; optimize database access
- Validate all user input at the API boundary
- Use parameterized queries to prevent SQL injection
- Keep dependencies up to date

## Questions?

- Check existing documentation in `docs/`
- Review the README's judge walkthrough for feature context
- Open a discussion or issue on GitHub

---

Thank you for contributing to PathWise! 🚚
