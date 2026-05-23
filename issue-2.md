# Issue 2: Lack of environment configuration validation script

## Description
GitVerse Next.js depends on several environment variables (`DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `NEXTAUTH_SECRET`, etc.) to run properly.
Currently, when a developer sets up the application for the first time:
- There is no automated script to check if they have configured all necessary parameters.
- Missing or malformed configuration values only trigger runtime errors/crashes, which are hard to debug for first-time contributors.
- There is no early feedback mechanism to check database or API key connection formatting.

An automated environment configuration validation script is needed to check environment variables against predefined rules and output human-friendly reports of any missing or malformed keys.

## Requirements & Acceptance Criteria
1. **Validation Script**: Create `scripts/validate-env.ts` to load and validate environment variables.
2. **Key Requirements**: Check for the following essential configurations:
   - `DATABASE_URL` (Must exist and have standard postgres prefix `postgresql://` or `postgres://`).
   - `JWT_SECRET` (Must exist and meet a minimum strength requirement, e.g., length of 8+ characters).
   - `GEMINI_API_KEY` (Must exist for AI features to function).
   - `NEXTAUTH_SECRET` (Must exist for NextAuth-based sessions).
3. **Execution Integration**: Add a script entry to `package.json`:
   - `"validate-env": "tsx scripts/validate-env.ts"`
4. **User-Friendly Report**:
   - Provide colored/styled output.
   - Highlight missing variables with clear error indicators.
   - Provide a green success status if everything checks out successfully.
   - Do NOT print or leak sensitive configuration values (like secrets or passwords) to the console log.
