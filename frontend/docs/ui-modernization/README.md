# UI modernization baseline

This baseline supports [issue #14572](https://github.com/kubeflow/pipelines/issues/14572) (the authoritative tracker; a KEP is not required). It records the existing UI before presentation changes, against application source and lockfiles at [`02cbc725ac9ddcd950f4400d8355dd78bfcd6c57`](https://github.com/kubeflow/pipelines/commit/02cbc725ac9ddcd950f4400d8355dd78bfcd6c57), captured on 2026-09-26.

The accompanying changes extend the existing screenshot harness and add the missing mock single-task lookup used by artifact lineage. Application code, backend contracts, dependencies and deployment configuration are unchanged. This document preserves the historical baseline and its then-outstanding gates. See the issue for subsequent modernization qualification and current release status.

## Evidence

[Browser performance measurements](performance-baseline.md) add nine fresh-context load samples, three filter trials and one exploratory run/task interaction trace under recorded CPU/network conditions. These extend the initial capture with controlled lab evidence.

| Artifact                                                                                        | Scope                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Route/action/state inventory](route-inventory.md)                                              | 23 page routes, root redirect and not-found handling; artifact subviews, actions, state and URL/storage/integration contracts. Unchecked items are verification work, not missing product requirements. |
| [Deployment and browser contracts](deployment-baseline.md)                                      | Root and `/pipeline`, embedding, namespace/auth, probes, signing configuration, browser-floor decision and immutable rollback candidate.                                                                |
| [Screenshot index](screenshots/README.md) and [capture manifest](evidence/capture-results.json) | 25 native-mock routes at 1280×720 and 900×900; 50 full-page light-theme captures.                                                                                                                       |
| [Test/coverage results](evidence/test-results.json)                                             | Counts, commands and original coverage denominators.                                                                                                                                                    |
| [Coverage comparison input](evidence/coverage-baseline.json)                                    | Totals compatible with the existing `coverage:compare` script.                                                                                                                                          |
| [Production bundle measurements](evidence/bundle-sizes.json)                                    | Per-file sizes, compressed sizes and SHA-256 digests.                                                                                                                                                   |

Repeat capture results are in [repeatability.json](evidence/repeatability.json): **42 images are byte-identical; all eight graph images require manual review.** Two focused-task images have zero differences with the existing pixelmatch antialias handling; six unfocused graph images still have nonzero differences (maximum 0.2514% at threshold 0.1) after Fit View normalization. Existing initial-fit timing and intentional tiny position jitter make strict graph screenshot gates unreliable. Keep graph stabilization open before using those references as automated acceptance gates.

Screenshots are reference images for visual review. Scrollable panels remain at their captured scroll positions; full-page capture does not expose content inside every scroll container. They do not prove that displayed mutation controls, hidden states or deployment-specific behavior work. The current fixtures represent succeeded runs, sparse comparison data and one Dataset artifact; the pending fixture matrix is listed below.

## Verification and measurements

Toolchain: Node 24.14.0, npm 11.17.0, Vitest 4.1.11, Playwright Chromium 145.0.7632.6, macOS ARM64. Screenshot locale is `en-US`, timezone `UTC`, reduced motion enabled, and browser date fixed at `2026-09-26T12:00:00.000Z`. Each page uses a fresh browser context. Compare images with the same browser, operating system and font environment. The two configured creation forms receive fixed visible names; date freezing alone does not normalize their random name suffixes.

Historical test commands, results, coverage denominators and bundle sizes are recorded in the linked JSON evidence. They describe the recorded revision, not later changes. Use matching toolchain, browser, fonts, build and compression settings when making comparisons.

## Reproduce tests and capture

Use the application revision above with the harness and mock-route changes accompanying this document. Install the pinned dependencies with `npm ci` in `frontend`; its postinstall installs the server and mock backend dependencies. Install the pinned browser with `npx playwright install chromium --only-shell`.

### Path and comparison contract

| Input                                                             | Resolution or behavior                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in output defaults, including `npm run visual:*`            | Always `frontend/.visual/`, regardless of invocation directory.                                                                                                       |
| Explicit relative CLI path flags                                  | Caller directory: `INIT_CWD` when `npm_lifecycle_event` identifies an npm lifecycle command, otherwise `process.cwd()`; an unrelated inherited `INIT_CWD` is ignored. |
| Explicit absolute CLI paths                                       | Used unchanged.                                                                                                                                                       |
| Paths inside a manifest                                           | Relative to that manifest; older absolute paths remain readable.                                                                                                      |
| Successful current capture absent from baseline                   | Informational added row; `--strict-inventory` makes it an error.                                                                                                      |
| Missing expected current capture or failed capture on either side | Error and nonzero exit; diagnostics identify the failing side.                                                                                                        |
| Pixel differences                                                 | Reported; nonzero only with `--fail-on-diff`.                                                                                                                         |
| Global incomplete-capture marker                                  | Always fails; completed rows may still be compared for diagnostics.                                                                                                   |

The commands below run from `frontend`. From repository root, prefix explicit script and frontend-relative flag paths with `frontend/`. The wrapper supplies absolute output paths; unset `FIXED_TIME` selects its deterministic default, empty `FIXED_TIME` selects real time, and a nonempty value fixes both clocks.

From `frontend`, before starting the mock server:

```sh
CI=true npm run test:ui:coverage
CI=true npm run test:server:coverage
npm run format:check
npm run typecheck:mock-backend
npm run check:react-peers
CI=true npm run build
node --test scripts/production-bundle.smoke.mjs
```

The UI coverage command uses the same four-worker fork pool and test selection as frontend CI, including all capture, publication, and wrapper unit tests. These harness tests use mocked browsers and do not need a browser installation. For a focused harness check with the same coverage and worker settings, run `CI=true npx vitest run --coverage scripts/visual-compare.test.mjs scripts/publish-visual-capture.test.mjs scripts/visual-compare-run.test.mjs scripts/visual-capture-flow.test.mjs` from `frontend`.

Server tests use mocked Kubernetes clients but require a valid context during client construction. For isolated execution, set `KUBECONFIG` for that command to a temporary credential-free config whose cluster server is `https://127.0.0.1:9`, with matching cluster/context/user names and an empty user object. This does not qualify a live deployment. Do not run the mock API server concurrently with server tests: both use port 3001.

After tests, run these in separate terminals from `frontend`:

```sh
npm run mock:api
```

```sh
NODE_OPTIONS=--dns-result-order=ipv4first npx vite preview --host 127.0.0.1 --port 4173 --strictPort
```

```sh
node scripts/visual-compare.mjs capture \
  --base-url http://127.0.0.1:4173 \
  --out-dir .visual/current \
  --fixed-time 2026-09-26T12:00:00.000Z \
  --viewports 1280x720,900x900
```

Use a fresh output directory. A failed capture removes that route's stale image and causes a nonzero exit; unrelated old files are retained, but comparison uses each capture manifest as the authoritative inventory and does not count PNGs omitted from it. Failed manifest entries remain errors even if a stale PNG exists. Legacy directories without manifests still use their PNG inventory and should be kept separate. The manifest records each attempted route, readiness checks, setup, viewport and status. The raw capture command does **not** produce the enriched historical manifest checked in here. That manifest was assembled from multiple capture batches: paths were normalized relative to this document, hashes were calculated, and repeatability/source/batch annotations were added separately. The historical screenshot bytes and measurements remain unchanged; manifest paths have been normalized to the common manifest-relative contract with the original manifest digest and retained evidence reference recorded in `pathNormalization`; the commands above reproduce the capture procedure, not that hand-assembled publication or necessarily identical browser pixels.

To compare against the 50 preserved historical screenshots, run from `frontend`:

```sh
node scripts/visual-compare.mjs diff \
  --baseline-dir docs/ui-modernization/evidence \
  --current-dir .visual/current
```

The historical `evidence/capture-results.json` is directly usable by comparison and publication. Its `filePath` values point to `../screenshots/`, and `routesPath` points to the route definition restored beside it from the retained evidence tag. `pathNormalization` records the original manifest digest, its in-repository `original-capture-results.json` copy, retained reference and route snapshot provenance; only path/provenance metadata was updated, not screenshot bytes, hashes, measurements or annotations. No capture-time route hash existed for these legacy captures, so publication correctly marks that integrity check unverified. Copy the documentation tree together to retain the historical manifest's sibling screenshot references.

### Publish new capture evidence

Run browser capture in hosted CI. After capture, the browser-free publisher copies the exact PNG bytes and route definition into a new portable directory, writes SHA-256 digests, and records the full application and harness commits supplied by the operator:

```sh
node scripts/publish-visual-capture.mjs \
  --manifest .visual/current/capture-results.json \
  --out-dir .visual/published-current \
  --source-commit "$APPLICATION_COMMIT" \
  --harness-commit "$HARNESS_COMMIT"
```

Set both variables to the full 40-character commits actually used for the application build and capture harness. If the input already records either revision, the supplied value must match; republication cannot rewrite provenance; do not substitute the checkout's current HEAD if it differs. New raw and published manifests use the same contract: `filePath` and `routesPath` resolve relative to the directory containing `capture-results.json`. Copy or move the whole directory together. Capture saves the exact route bytes it parsed as `routes.json` and records `routesSha256`; publication verifies that snapshot before copying it. Older absolute-path captures remain readable, but cannot be relocated without updating their paths.

A published directory is directly usable as `--baseline-dir .visual/published-current` for comparisons against a subsequent capture. The comparison follows each manifest's screenshot paths (including `screenshots/`) and retains failed-entry checks; do not bypass its manifest by pointing into the published screenshot subdirectory. Expected baseline captures missing from current, failed captures, invalid images and other comparison errors always exit nonzero. Additional successful current captures are informational “added” rows; use `--strict-inventory` to require identical inventories. A global capture failure is reported while successfully recorded routes remain available as partial diagnostic comparisons; publication still rejects the incomplete run. Pixel differences alone only exit nonzero when `--fail-on-diff` is supplied.

The publisher refuses failed captures, missing files, duplicate screenshot names, digest or revision mismatches and existing output directories. It preserves supported metadata only, copies and verifies the referenced original manifest under `metadata/`, and validates and copies screenshots one at a time with digest rechecks. Failed writes remove only the newly created output directory; the success manifest is written last. Its raw-manifest and publication route-file digests identify the inputs; older manifests without a capture-time route digest are explicitly marked unverified for capture-time route integrity. On republication, the prior publication route digest is verified and recorded separately as `inputRoutesIntegrity`; this verifies unchanged published bytes without inventing capture-time provenance; source/harness provenance is explicitly operator-supplied, not inferred from screenshots. This step does not measure repeatability and deliberately drops old repeatability/batch annotations. Publish independent repeat captures separately and retain their actual comparison report before claiming repeatability. The existing historical repeatability report remains the record of its original trials. No undocumented manual enrichment is needed for future portable publications.

The comparison wrapper passes the same fixed UTC time to both captures, defaulting to `2026-09-26T12:00:00.000Z`; set `FIXED_TIME` to override it for both sides, or set `FIXED_TIME=` to use the real clock.

Historical screenshots and compact traces are committed as review artifacts. Their hashes, normalized manifest, original manifest and route snapshot are available in this repository; the personal-fork tag is an auxiliary history reference, not required by capture, publication or comparison. Routine tests check historical path/hash integrity and use tiny PNG fixtures for cross-tool comparisons.

Capture route options are limited to readiness checks, deterministic form values, graph framing and error detection. Interactive navigation and workflow actions belong in the existing smoke harness; do not extend these options into a general action DSL.

The capture CLI uses Chromium. Browser injection is a test/programmatic seam, not a declared Firefox or WebKit CLI mode.

The [route manifest](../../scripts/visual-compare.routes.json) is the executable capture definition. Optional `fitGraph` invokes the existing Fit View control after fonts and node measurements settle; the three unfocused graph captures use it, while the task-focused view retains its existing framing. `waitForSelectors` requires additional loaded data, `fillFields` normalizes accessible textboxes, and `failOnRequestErrors` checks same-origin pathname prefixes. These error checks and `failOnPageErrors` are opt-in so intentional error-state captures and deployment probes can be configured explicitly. Comparison requires both expected run rows and successful scoped data requests; an empty-parameters message alone is insufficient.

## Gates before workflow migration and release qualification

- [ ] Stabilize graph capture timing/position jitter and prove repeated equivalence before enabling strict graph image gates. Preserve task-focused framing.
- [ ] Add scenario fixtures/captures for loading, empty, backend error, partial response, recovery and 401/403 states; preserve the happy-path fixtures.
- [ ] Add running, failed, canceled/paused and archived runs with consistent tasks/retry attempts. Add long names, enough rows for pagination, overflow and mixed selection.
- [ ] Populate comparison parameters and metrics, ClassificationMetrics, HTML/Markdown/table viewers, multiple artifacts and missing/deleted provenance. Existing static viewer files are not wired native workflow evidence.
- [ ] Exercise graph/task navigation, logs/events, form validation, upload, creation/cloning, archive/restore/delete, retry/terminate and schedule enable/disable against a seeded backend. Reuse the existing [interactive smoke harness](../../scripts/ui-smoke-test/README.md) rather than growing a second general action framework.
- [ ] Qualify standalone and embedded multi-user namespace/permission behavior, shared pipelines and Kubernetes-backed pipeline storage. The default mock health response is single-user with database storage; artifact fixture endpoints ignore query filtering/paging.
- [ ] Agree a versioned browser floor and measured performance budgets. The [initial browser baseline](performance-baseline.md) covers loads, filtering and exploratory run/task navigation; extend it to realistic workload sizes, repeated task navigation, selection and populated comparison before closing this gate.
- [ ] Verify the previous UI image and modernized UI against the same backend, record immutable UI/backend identities, and rehearse rollback using the [deployment checklist](deployment-baseline.md). Registry resolution alone does not establish compatibility.

The 900-pixel capture documents existing narrow layout, not mobile acceptance. Dark theme, keyboard/focus, contrast and broader responsive acceptance remain implementation/qualification work. KFP Local execution, SDKs and backend schemas are unchanged by this baseline; the issue’s no-migration requirement still applies to the eventual UI cutover.

### Capture failure handling

The CLI accepts fixed time only in UTC as `YYYY-MM-DDTHH:MM:SS[.mmm]Z`; calendar validity is checked separately from the format. Capture request prefixes must begin with `/`. Injected browser engines use their Playwright cancellation signals; loaded-data checks and genuine HTTP/transport failures remain required. CLI capture continues to default to Chromium.

The browser closes even if manifest publication fails. Both script entrypoint guards tolerate imports with a missing `argv[1]` path. Comparison attempts both sides and preserves errors in its report; Node setup failures are explicitly propagated instead of falling back to another installed Node. These behaviors are covered by browser-free regressions, not new live-browser qualification.
