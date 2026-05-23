# Issue 1: Missing standard contributing documentation (`CONTRIBUTING.md`)

## Description
The project is currently missing a unified and comprehensive contributing guide (`CONTRIBUTING.md`). As GitVerse Next.js transitions to an open-source collaboration model, new contributors lack clear documentation regarding:
- Local environment setup and requirements
- Branching strategy and naming conventions
- Pull request (PR) process
- Code linting and formatting standards
- Commit message standards (Conventional Commits)

This leads to inconsistent PR formatting, improper commit descriptions, and difficulty for new developers onboarding onto the project.

## Requirements & Acceptance Criteria
1. **Unified Contributing Guide**: A new `CONTRIBUTING.md` file should be placed in the project root.
2. **Branching Guidelines**: Explicitly outline branching conventions:
   - Features: `feature/`
   - Bugfixes: `bugfix/`
   - Refactoring: `refactor/`
   - Documentation: `docs/`
3. **Setup Steps**: Provide clear steps for local setup, installing dependencies, copying environment files, generating Prisma client, and running development servers.
4. **Commit Formatting**: Standardize on Conventional Commits structure (e.g. `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `chore: ...`).
5. **Pre-commit Checklists**: Instruct contributors to run lint checks (`npm run lint`), format formatting (`npm run format`), and type checking (`npm run typecheck`) prior to submission.
