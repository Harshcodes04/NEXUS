# Contributing to NEXUS

Thanks for your interest in contributing!

## Getting Started

1. Fork the repo and clone it locally
2. Install dependencies: `pip install -r api/requirements.txt`
3. Run the backend: `uvicorn api.main:app --reload`
4. Open `http://localhost:8000` in your browser

## Development Workflow

- **Backend changes** live in `api/` — FastAPI, services, routers
- **Frontend changes** live in `frontend/` — vanilla JS + CSS, no build step needed
- Run `python -m pytest tests/` before submitting a PR

## Reporting Bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) issue template.
Include browser console errors and backend logs where relevant.

## Suggesting Features

Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template.
Describe the use case, not just the solution.

## Code Style

- **Python:** follow PEP 8, type-hint all function signatures
- **JavaScript:** ES6+, IIFE modules (match existing pattern), no build tools
- **CSS:** use existing design tokens (`--bg-primary`, `--blue`, etc.) — no inline styles

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add orbital decay model
fix: correct LOS elevation calculation
docs: update API reference
refactor: simplify conjunction screener
```
