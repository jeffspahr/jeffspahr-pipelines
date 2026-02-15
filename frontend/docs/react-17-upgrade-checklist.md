# React 17 Upgrade Checklist (Frontend)

Last updated: 2026-02-15

Purpose: capture a minimal, auditable checklist for upgrading the frontend from React 16 to React 17 while keeping risk low and changes shippable.

## Prerequisites (must be true before upgrading)
- PR #12754 (Vite/Vitest migration) merged into the target branch.
- PR #12756 (frontend server ESM + dev workflow) merged into the target branch.
- MUI v4 baseline is present in the target branch (`@material-ui/core` 4.x and `@material-ui/icons` 4.x),
  via PR #12793 or an equivalent merge.

If any prerequisite is not true in the target branch, stop and rebase before proceeding.

Current status on 2026-02-15:
- PR #12754 merged on 2026-02-09.
- PR #12756 merged on 2026-02-06.
- This branch is already on MUI v4 (`@material-ui/core@^4.12.4`, `@material-ui/icons@^4.11.3`).

## Baseline Snapshot (fill in before starting)
- React core: `react`, `react-dom`, `@types/react`, `@types/react-dom`, `react-test-renderer` versions.
- Build/dev stack: confirm Vite/Vitest scripts are present and `react-scripts` is not used for client builds.
- Test stack: jest config, `@testing-library/*`, Enzyme + adapter version, jsdom environment.
- Storybook: version and preset used.
- Node version: `.nvmrc`.
- Frontend server build: confirm ESM entrypoint and build output expectations.

Suggested quick checks:
- `rg -n "react-scripts|vite|vitest" frontend/package.json`
- `rg -n "@material-ui/core|@material-ui/icons|react-motion|react-vis|re-resizable" frontend/package.json`
- `rg -n "enzyme|adapter|jsdom-sixteen" frontend/package.json`
- `rg -n "componentWill|UNSAFE_|findDOMNode" frontend/src`

## Compatibility Audit (before changing React)
Dependencies
- Identify packages with peer ranges or runtime behavior that can still block/stress a React 17 bump.
- Specifically review: `react`/`react-dom`/`react-test-renderer` + `@types/*` alignment, `react-motion`
  (transitive via `react-vis`), `react-vis`, `re-resizable`, Storybook 6.x compatibility, and any dependency
  that still emits React 16 lifecycle warnings during tests.
- Confirm Enzyme and `jest-environment-jsdom-sixteen` remain absent (migration should stay Testing Library + Vitest for UI).

Code patterns
- Legacy lifecycles: `componentWillMount`, `componentWillReceiveProps`, `componentWillUpdate` and `UNSAFE_` variants.
- `findDOMNode` usage.
- Assumptions about SyntheticEvent pooling.
- Tests relying on `react-dom/test-utils` behaviors.

## Verification Commands (baseline and after each slice)
- `npm run test:ci` (required pre-PR verification; mirrors CI gate)
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run test:server:coverage` (only if server changes)
- `npm run format:check` (if formatting touched)

## Notes
- Keep each change small and independently shippable.
- Prefer dependency updates that are React 17-compatible while still running on React 16 until the core bump is done.
