# React 17 Frontend Upgrade Plan

## Plan
- [x] Restate goal + acceptance criteria
- [x] Locate existing implementation / patterns
- [x] Design: minimal approach + key decisions
- [x] Implement smallest safe slice (PR1 baseline checklist)
- [ ] Add/adjust tests
- [ ] Run verification (lint/tests/build/manual repro)
- [ ] Summarize changes + verification story
- [ ] Record lessons (if any)

## Goal + Acceptance Criteria
- [ ] Upgrade the frontend to React 17 on top of the Vite/Vitest + ESM server baseline.
- [ ] All frontend build/lint/test commands pass (at minimum: `npm run lint`, `npm run test`, `npm run build`).
- [ ] No remaining React 16-only dependencies or adapters (e.g., Enzyme React 16 adapter).
- [ ] Docs reflect the React 17 baseline and any new dev/test commands.

## Working Notes
- [x] Assumption: PR #12754 (Vite/Vitest migration) and PR #12756 (frontend server ESM + dev workflow) are merged.
- [x] Vite/Vitest scripts are present in `frontend/package.json` after merging the prerequisite PRs.
- [ ] PR1 output: `frontend/docs/react-17-upgrade-checklist.md`.
- [ ] Keep changes minimal and independently shippable; avoid refactors not required for React 17.
- [ ] Prefer dependency updates that are React 17-compatible while still supporting React 16 to reduce risk.

## Proposed Shippable Slices (PRs)
- [x] PR1: Baseline audit + compatibility checklist
- [ ] PR2: Dependency alignment for React 17 (no React bump yet)
- [ ] PR3: React 17 core upgrade (react/react-dom/types/test-renderer)
- [ ] PR4: Fixes for React 17 runtime/test issues + optional JSX runtime decision
- [ ] PR5: Docs + CI verification polish

## PR2 Plan (Dependency Alignment)
- [x] Acceptance criteria
- [x] React version remains 16.x in `frontend/package.json`
- [x] Packages that would block React 17 (peer ranges) are updated or noted with rationale
- [ ] Frontend commands still pass: `npm run lint`, `npm run test`, `npm run build`
- [x] Identify dependencies with React 16-only peer ranges
- [x] Update dependencies to React 17-compatible versions (keep React 16 in package.json)
- [x] Adjust code/tests only if required by dependency changes
- [ ] Run verification (lint/tests/build)

## PR2 Notes (React 17 peer-deps audit)
- [x] Updated: `react-virtualized` (peer range now includes React 17), `@types/react-virtualized`, `react-ace` (migrated imports from `brace` to `ace-builds`).
- [x] Replaced `Editor` snapshots with targeted assertions because Ace DOM output is large and environment-dependent.
  Rationale: full DOM snapshots for third-party widgets are brittle and noisy on upgrades; asserting key behaviors (placeholder visibility/content) preserves test intent with far less churn.
- [x] Verification run: `npm run test -- src/components/Editor.vitest.test.tsx`, `npm run build` (lint + typecheck + vite build).
- [ ] Remaining blockers: `@material-ui/core` v3 + `@material-ui/icons` v3 (peer deps only React 16); `react-vis` (no React 17-compatible release).

## Results
- [x] Added `frontend/docs/react-17-upgrade-checklist.md` with prerequisites, baseline audit steps, and verification commands.
