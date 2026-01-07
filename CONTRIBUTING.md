# Contributing to AyPi

Thanks for your interest in contributing to AyPi.

This guide explains how to report issues and propose changes in a way that is efficient to review and maintain.

## Ground Rules
- Keep changes small and focused.
- For significant changes, open an issue first to align on scope/design.
- Be respectful and professional (see `CODE_OF_CONDUCT.md`).

## Development Setup
### Prerequisites
- Node.js (LTS recommended)
- npm

### Run locally
1. Install dependencies:
   - `npm install`
2. Start the application:
   - `npm start`

> If the project requires additional build steps (packaging, signing, auto-update, etc.), document them here as the project evolves.

## Reporting Bugs
Use the **Bug Report** template and include:
- Expected vs actual behavior
- Steps to reproduce
- App version
- OS details (Windows/macOS/Linux)
- Logs/screenshots (redact sensitive data)

For security issues, do not use public issues. See `SECURITY.md`.

## Requesting Features
Use the **Feature Request** template and include:
- The problem you are solving
- Proposed solution and expected UX
- Alternatives considered and constraints

## Pull Requests
- Use a dedicated branch (e.g. `feature/...` or `fix/...`).
- Ensure the app starts correctly with `npm start`.
- Update documentation if behavior changes.
- Keep formatting/style consistent with the existing codebase.

## License & Rights
By contributing, you agree that your contributions may be incorporated into the project under the terms of the repository license (`LICENSE`).
