# KEP: Decouple the Kubeflow Pipelines control plane from execution infrastructure

- **Status:** Provisional / discussion draft
- **Authors:** Community proposal (initial draft)
- **Target:** Kubeflow Pipelines
- **Scope:** Architectural direction with incremental, backward-compatible implementation
- **Related:** [KFP proposal process](../README.md)

## Summary

Separate durable KFP control-plane responsibilities from replaceable execution infrastructure. A logical KFP service should retain tenant identity, pipeline definitions, experiments, runs, schedules, task/artifact metadata, policy, and history independently of the Kubernetes clusters that run pipeline workloads. Registered execution targets should be capable of accepting new work, draining, failing, and being replaced without a tenant migration or loss of durable KFP history.

This KEP is **not** a proposal to remove Kubernetes or Argo from the execution plane, replace KFP's database with a particular cloud service, or deliver global active-active persistence. It is a direction and a sequence of independently useful changes, designed to be achievable through many small PRs while preserving existing single-cluster deployments.

**Guiding contract: durable control plane; disposable execution targets; durable object data independent of execution; execution-scoped PVCs allowed but disposable.**

## Motivation and user problems

1. **Rebuilds become migrations.** Replacing a Kubernetes backend today can require a complex tenant migration because users, history, schedules, and compute are coupled to a KFP installation.
2. **Regional islands.** Multiple independently deployed regional KFP installations each expose their own UI, run history, and user-facing identity even when deployed for resilience or capacity.
3. **Static capacity placement.** Scaling out by adding Kubernetes clusters creates manual, point-in-time tenant placement decisions. Rebalancing or retiring clusters later becomes another migration, despite dynamically changing workload requirements.

These are problems with the **ownership and lifecycle boundary**, not simply the absence of a `cluster_id` column. The desired state is one **logical** user-facing service with durable identity and history, while a run can execute on an eligible target in a chosen region.

### Desired operating scenarios

- **Rebuild:** mark target A draining; stop new placements; finish or explicitly handle in-flight work; replace A; register replacement; no tenant/history/schedule migration.
- **Expand:** register target D and place new eligible runs there without remapping tenants.
- **Regional disruption:** unaffected targets continue; control-plane history remains accessible, with honest stale/unavailable execution status for the affected region.
- **Control-plane disruption:** already-submitted workflows can keep running locally; agents/observers eventually replay and reconcile without duplicating executions.
- **Scale in:** block new placements, track active executions and execution-scoped cleanup, and remove only after the target is demonstrably safe to retire.

## Goals

1. One logical KFP API/UI/catalog/history serving multiple isolated execution targets and regions.
2. A durable, resilient control plane whose identity, scheduling intent, metadata, and persistence do not depend on any execution cluster.
3. A semantic execution boundary that hides Kubernetes Workflow/Pod mechanics from core API/UI behavior.
4. Safe, idempotent submission, observation, cancellation, deletion, and eventually retry under network partitions and process failures.
5. Incremental adoption and single-cluster compatibility throughout the transition.
6. Explicit target capabilities and admission rules, later extended to policy- and capacity-based placement and draining.
7. Vendor neutrality: external persistence, object stores, identity, secrets, and cluster implementations are deployment choices.
8. Testable separation that permits—but does not initially require—hosting UI/API/control services outside Kubernetes.

## Non-goals and deferred concerns

- Globally **active-active writable** database replication and cross-region conflict resolution. Regionally resilient control-plane deployment and external durable state are separate goals; database replication/failover is delegated to the chosen persistence platform.
- Migrating running Workflows or task state between Kubernetes clusters.
- Executing different steps of one run in different clusters.
- Owning storage lifecycle, replication, backup, cross-cluster PVC migration, or data movement.
- Automatically provisioning EFS, FSx, or other durable filesystems.
- Supporting non-Kubernetes execution providers in the first implementation, though the contract should not rule them out.
- Replacing Argo or Kubernetes in local execution environments.
- Enabling all existing advanced features remotely on day one.
- Requiring a new database technology or an agent-based architecture before a first working multi-target milestone.

## Architectural invariants

- **User-facing ownership:** Tenants, pipeline definitions, experiments, run/task/artifact metadata, run history, and schedules are durable control-plane entities, not Kubernetes objects.
- **Run affinity, not tenant affinity:** A run is bound immutably to a selected execution target. A tenant is not pinned to a target. A future run can select a different target.
- **No authoritative KFP catalog in execution targets:** Kubernetes/Argo maintain live execution state, but clusters must not hold the only copy of durable KFP state.
- **Exact target addressing:** No Kubernetes mutation may be performed using only namespace/resource name without verified execution-target identity; never fall back to a different target on failure.
- **Separate identity domains:** Human/tenant authorization belongs centrally; target and runtime identity belongs to the selected execution trust domain. Kubernetes service-account names are not globally unique.
- **Eventual observation:** Execution state can be temporarily stale. The control plane must distinguish observation freshness from a terminal pipeline result.
- **Durable commands:** Submit/cancel/delete intent survives a control-plane restart and target outage. Ambiguous network errors are reconciled, not blindly repeated.
- **Execution resources are disposable:** Workflow, Pods, ephemeral volumes, and run-scoped PVCs may be deleted when execution ends or the target is retired. Durable outputs must be exported.
- **Deployment agnostic:** Core services cannot rely on in-cluster service discovery, a Kubernetes Lease, TokenReview, ConfigMaps, or Kubernetes Secrets as their only implementation.
- **Compatibility:** Legacy single-cluster installation behavior remains available and existing persisted rows remain addressable through a stable legacy/default target.

## High-level architecture

```text
                    One logical KFP endpoint
                       Browser / SDK
                            |
                    +-------v--------+
                    | UI / API / BFF  |
                    | auth / catalog  |
                    +-------+--------+
                            |
                 +----------v-----------+
                 | Durable control plane|
                 | tenants, runs, jobs  |
                 | history, metadata    |
                 | placement, policy    |
                 +---+-------------+----+
                     |             |
                External SQL   Object storage
                (HA capable)   durable outputs
                     |
              Execution protocol
                     |
             +-------+--------+
             |                |
       Target adapter A   Target adapter B
             |                |
       Kubernetes A      Kubernetes B
       Argo / Pods       Argo / Pods
       run-local PVCs    run-local PVCs
```

“Control plane” is logical, not necessarily one physical region. Conventional active/standby control-plane failover with appropriate RTO/RPO is acceptable; globally writable active-active state is deliberately separate. The execution protocol may first be implemented as direct Kubernetes client bundles, then replaced per target by local agents without redesigning public Run identity.

## Proposed conceptual models

Names below are illustrative and **not final protobuf or database schema**.

```text
ExecutionTarget
  id                  // stable opaque identity, never reuse for a different cluster
  backend_kind        // initially kubernetes-argo
  region / failure_domain
  lifecycle           // REGISTERING, READY, DRAINING, DISABLED, REMOVED
  capabilities        // compute, supported storage/runtime features
  health / observed_at
  policy              // tenant / namespace / service-account eligibility
  connectivity        // backend-private endpoint or agent identity

Run
  run_id
  owner / experiment
  resolved_target_id  // immutable once placed
  execution_id        // stable logical instance
  state / last_observed_at
  operation_generation / cancellation and deletion intent

ExecutionBinding (backend-private)
  target_id
  execution_id
  namespace / workflow_name / workflow_uid
  observed_resource_version / retry generation
  storage_profile
```

The public API should expose target ID and generic execution state, not demand that callers provide Workflow names, Pod identities, or Kubernetes credentials. Kubernetes-specific references can be diagnostic extensions. The exact internal representation may initially keep cluster identity on `Run` and reuse existing namespace/manifests to minimize migrations.

### Execution API boundary

Prefer semantics such as `SubmitExecution`, `Get/ObserveExecution`, `CancelExecution`, `DeleteExecution`, `GetTaskLogs`, and capability introspection, over an interface that directly exposes `Pods` or `Workflows`. Writes require operation identity, idempotency, retry behavior, and conditional resource identity/version checks. Observation carries authenticated target origin and a monotonic attempt/generation fence.

The practical source-code seam is the API server's `ResourceManager` and its **target-scoped bundle of execution services**, not `ExecutionClient` alone. Initial direct-client bundles need Argo Workflow, Pod/Core, observers, runtime config and appropriate identity/secret functions; do **not** route central authorization or pipeline catalog Kubernetes clients through the execution bundle.

`ExecutionClient.ForCluster` alone is insufficient because Kubernetes access is also performed by persistence informers, scheduled-workflow controller, retries/pod deletion, log paths, plugins, frontend handlers, and independently constructed runtime clients.

## State and failure semantics

### Durable submission

Today ad hoc Run creation can create a Workflow **before** inserting the Run row. A timeout after Kubernetes accepted the Workflow can orphan a workload. Introduce a durable submission record/intent before external creation, assign deterministic operation/execution identity, reconcile ambiguous creates using expected UID and labels, and update the run status when admission/submission is confirmed. Never manufacture a second run on retry.

### Observation and fencing

Observers run per target (central per-cluster informers initially, optional local agents later). Shared queue identities must include target ID; independent queues may use local namespace/name keys. Every report is bound cryptographically or by trusted transport to the enrolled target, then checked against stored target, Workflow UID/resource-version, owner relationship, and retry generation. A caller-provided field or Workflow annotation is not proof of origin. Reconnection must resync and avoid stale reports overwriting newer generations. APIs should distinguish last observed state from current availability.

### Cancellation and deletion

Record intent before attempting remote mutation. A transport error does not mean cancel/delete succeeded. Retain Run identity or a tombstone until conditional cleanup in the **selected** target completes or absence is safely verified. Define deletion completion (Workflow removed versus all descendant resources gone) explicitly. Retention/GC must not erase remote cleanup obligations.

### Scheduling

Schedule intent and trigger history belong centrally. Long term, schedule firing creates a normal Run that undergoes placement, rather than pinning intent to a cluster's `ScheduledWorkflow` CR. Existing recurring-run behavior may remain on the legacy target during early phases. Controller paths that directly create embedded Workflows and paths that call central `CreateRun` both require later treatment.

### Identity and security

Resolve target authorization as an explicit tuple of tenant, target, execution namespace, and service account; perform independent backend-local authorization. A runtime token issued by cluster A cannot be assumed valid in cluster B's or a central cluster's TokenReview. Proposed options include target-aware TokenReview, workload identity federation, or authenticated per-target agent/proxy identity. Central authentication must not trust unverified target claims, and user-facing endpoints must not accept arbitrary namespace/Pod names as privilege-escalation handles. Minimize central credentials; per-target agents can eventually keep Kubernetes credentials local.

### UI and API responsibility

The Node frontend server remains a legitimate browser-facing BFF for assets, sessions, and API proxying. However, `frontend/server/k8s-helper.ts`, pod log/info/event handlers, artifact/Secret resolution, Workflow reads, and Viewer/TensorBoard functionality directly call Kubernetes. Move execution-related reads and mutations behind authorized KFP APIs incrementally, independently useful even before multiple targets exist. Run-based log/task endpoints should resolve target and authorize ownership server-side. Keep legacy/local viewer functionality available until explicit replacements or exclusions exist.

### Cache, metadata, storage and runtime

Central relational metadata contains Run, Task, Artifact, Job, experiment and pipeline catalog state. The execution targets need **no additional authoritative KFP SQL database**: their Kubernetes state represents active execution. Cache lookup must include target and actual storage accessibility, including custom keys. A first distributed milestone may disable remote caching rather than risk cross-target false hits.

**First distributed storage contract:** durable pipeline inputs/outputs are object data available from eligible targets; Pod ephemeral volumes and dynamically created **run-scoped, disposable PVCs** are permitted, including CSI-backed EBS scratch. PVC objects and physical volumes are not inherently forbidden. What is excluded is a dependency on a persistent, tenant-owned cluster-local filesystem that must survive target retirement. Output persistence and volume cleanup are explicit. Object URIs require consistent identity/access semantics across targets, not merely matching strings.

Later, optional external storage-capability and preparation providers may advertise AVAILABLE/PREPARABLE/UNAVAILABLE data access and target-local bindings for EFS, FSx Lustre, NFS, etc. KFP consumes capabilities and records provenance; **external infrastructure owns provisioning, migration, replication, backups and deletion**. No AWS-specific APIs in upstream core.

Runtime Pods execute local Kubernetes operations (PVC creation/deletion, ConfigMap/Secret access, Argo metadata) in their selected cluster; this is appropriate and should not be routed centrally. Compiled driver/launcher endpoints currently derive from cluster-local service DNS and must use reachable, TLS-authenticated central service endpoints or a scoped local proxy. The central API's storage and log readers cannot assume a single local object-store endpoint.

## Direct clients versus agents

| Dimension | Direct per-target client bundle | Per-target execution agent |
|---|---|---|
| Initial change | Closest to current ResourceManager and informer paths | New command transport, agent semantics and enrollment |
| Credentials | Central stores scoped target Kubernetes credentials | Kubernetes credentials stay local; agent identity centrally trusted |
| Connectivity | Control plane reaches each K8s API | Can use outbound-only agent connection |
| Watches | Central per-target watchers/queues | Local watches with authenticated event forwarding |
| Failure modes | remote API outages, timeouts, lost watches | plus command delivery, replay, version-skew |
| Future fit | Useful incremental prototype | Strong separation for SaaS / non-K8s hosting |

**Recommendation:** deliver the semantic boundary and direct-client implementation first if connectivity allows, keeping the contract suitable for replacing the adapter with agents. Agent transport is not required for every early improvement. An agent is not equivalent to today's persistence agent, which observes/reports but does not implement command execution.

## Phased implementation and deliverable milestones

Phases are **capability gates**, not a single giant release. Each may be subdivided into narrow PRs with tests, dark-launch configuration and rollback. In particular, phases 0–3 offer independent improvements on existing single-cluster installations.

### Phase 0 — Contracts, inventory and test harness (no behavioral changes)

- Agree on invariants, user-visible semantics, terminology, lifecycle, failure modes and supported feature matrix.
- Inventory independent Kubernetes construction paths in API, persistence agent, controllers, plugins, frontend and runtime. Identify central-only versus execution-target clients.
- Add seam-focused integration harness with fake/restartable backend and fault injection for timeout-after-success, stale report, duplicate command and unreachable target.
- Define compatibility/feature gates and per-phase acceptance tests.

**Exit:** agreed minimal execution contract, initial APIs/storage model and reproducible failing tests for known single-cluster orphaning/deletion behaviors.

### Phase 1 — Decouple frontend-server execution reads (independently useful)

- Introduce/expand run-authorized backend endpoints for logs, pod/task information, events, artifacts and Workflow-derived state.
- Migrate frontend handlers incrementally; preserve paths and behavior while switching implementation.
- Inventory and isolate Viewer/TensorBoard and Secret/config access; leave explicitly legacy-only paths until replacements exist.
- Reduce frontend K8s RBAC only after corresponding routes no longer need it.

**Exit:** ordinary run detail/log/artifact flows no longer require the frontend server's direct Kubernetes client; single-cluster UX remains unchanged. This is its own upstream-sized workstream.

### Phase 2 — Durable execution identity and safe lifecycle (single target)

- Add stable legacy/default target ID, immutable persisted Run target and migration/backfill of old rows.
- Update explicit SQL projections and API converters, not merely ORM models. Include Workflow UID and retry-generation fences.
- Persist submission/termination/deletion intent with idempotency and reconciliation; correct create-before-row and delete-on-error hazards.
- Introduce semantic execution interface around ResourceManager with the existing local Kubernetes adapter.
- Add detailed operation/freshness metrics and target-qualified log/audit metadata.

**Exit:** unchanged existing single-cluster operation plus safe recovery under ambiguous create, delete outage and process restarts. No multi-target exposure required.

### Phase 3 — Multi-target observation, identity and first remote run (explicit target)

- Static registry for a small number of known targets with unique IDs, scoped Kubernetes credentials, endpoints, namespace mappings and health.
- Per-target execution service bundles and informer/queue contexts; authenticate report origin and fence reconciliation by target/UID/generation.
- Expose optional target selection in protobuf, API, SDK and UI, defaulting old clients to the historical target.
- Compile runtime with central API endpoint/TLS, authenticate run-bound requests using target-qualified trust, and route live logs through Run ID.
- Support create/get/list/observe/cancel/delete on remote targets; default cache to disabled for remote targets and validate required object-storage access.
- Explicitly reject remote unsupported features; do not silently route to legacy cluster.

**Exit:** one API/UI/database records runs executed concurrently on two clusters, with verified status/logs, safe target-specific delete, auth isolation, and recoverable disconnect. Legacy single-cluster paths work unchanged.

### Phase 4 — Move recurring intent and lifecycle management centrally

- Uncouple scheduling intent from target-local ScheduledWorkflow ownership; trigger central run creation with replay-safe scheduling IDs.
- Support target READY/DRAINING/DISABLED registration lifecycle and health/freshness; disable new placement immediately on drain.
- Implement safe removal criteria: no active executions and all execution-scoped resources/cleanup obligations settled.
- Migrate recurring jobs incrementally; preserve schedule identity, audit history and old Jobs while a transition mechanism is active.

**Exit:** a target can be drained/replaced without moving tenant definitions, history or schedules; recurring work can land on a subsequent target.

### Phase 5 — Policy/capability-based placement and operational resilience

- Resolve run constraints (tenant, region, runtime capabilities, object-store access) before optimizing among eligible READY targets.
- Placement initially can be simple deterministic/weighted choice; queue depth, cost and capacity can be added later. Hard constraints remain explicit.
- Build robust retry/backpressure, reconnection/replay and target readiness/observability; distinguish infrastructure provisioning failures from pipeline task failures.
- Support conventional HA control-plane deployment with externally managed SQL/object stores and provider-agnostic leader/claim coordination (not mandatory K8s Leases).

**Exit:** adding capacity immediately makes it eligible for new work; scale-in/rebuild doesn't cause tenant migration; control-plane outage and target outage are separated failure domains.

### Phase 6 — Optional later extensions (separate KEPs where warranted)

- Execution agents with local credential custody and outbound-only connectivity.
- Durable/shared filesystem capability + bindings and external storage preparation API (EFS, FSx, etc.).
- Remote retry/resume, advanced TensorBoard/viewers, cache reuse across targets with verifiable storage identity.
- Non-Kubernetes execution providers.
- Globally active-active writable control-plane database (a separate distributed-systems effort, potentially not worth its operational cost).

## Versioned compatibility and rollout

- Default target is a stable identity, not a mutable alias that retroactively moves old runs.
- Legacy rows with null target resolve to the old local target and are backfilled; do not invalidate namespace/Workflow UID semantics.
- Existing SDK clients may omit target; new clients can specify it. Preserve protobuf field numbers and HTTP body mappings.
- Feature flags and capability checks gate remote functionality. A disabled remote feature returns an explicit unsupported response rather than partial behavior.
- Ensure status/report and cache SQL indexes account for target IDs without violating existing single-target scans/filters.
- Deploy adapter/informer capabilities before allowing selection. Retain old runtime endpoints while cutover proceeds.
- Preserve open runs and recurring schedules across roll-forward/rollback where migration format permits; run explicit compatibility tests against mixed component versions.
- Do not require operator adoption of external identity providers, object stores or multiple regions for existing installs.

## Testing plan

- **Unit/contract:** submission idempotency; immutable target; target-qualified lookup; authorization; state/generation monotonicity; capability gates and drain transitions.
- **Fault injection:** timeout after Kubernetes accepted create; repeated create; unavailable target on delete/cancel; agent/observer disconnect and replay; DB restart between intent and mutation; stale UID/resource-version; re-enrollment under wrong target identity; unreachable object store.
- **Security:** token from target A presented as B; unauthorized tenant targeting; forged report origin; malicious Pod/log selector; namespace collisions across clusters; scoped service-account and TLS trust.
- **Compatibility:** old SDK/API requests, old database rows, legacy recurring runs, single-cluster local PVCs, and frontend URLs/UX.
- **Integration:** two independent K8s/Argo installations, one external SQL/object-store-backed KFP, run create/status/logs/terminate/delete and simultaneous matching namespace/name cases.
- **Operational:** drain target during queued/running work, rebuild cluster, add cluster capacity, central control-plane restart, regional target outage, storage cleanup verification.
- **Frontend:** logs/events/artifact previews function without frontend-server K8s credentials for migrated paths.
- **KFP Local:** no changes required for initial local compilation/execution; any new SDK target argument should be remote-only or ignored/rejected explicitly by local runner, with tests.

## Observability and success measures

Expose target health and last observation time, pending commands/tombstones, orphan detection, report lag, placement decisions/rejections, active run counts, and drain blockers. Success criteria include (a) no tenant/history/schedule data migrations for execution-cluster replacement, (b) one UI/history across regional targets, (c) ability to add/remove capacity without static tenant reassignment, (d) zero cross-target Kubernetes mutations under identity collisions, and (e) no silent success on unknown cancel/delete outcome.

## Risks and tradeoffs

- Increased system complexity: multi-target reconciliation and identity will demand careful protocol design.
- Eventual consistency: target outage must be surfaced as **unknown/stale**, not silently reported as failed or completed.
- Shared control plane can be a blast-radius amplifier; availability, quotas, isolation and region policy matter.
- External SQL HA is not globally active-active consistency; RTO/RPO must be documented per deployment.
- Storage remains real data gravity. V1 assumes portable durable object data and disposable execution PVCs; legacy long-lived filesystem workloads cannot be silently treated as portable.
- Agents improve custody/connectivity but add distributed command execution and version-skew complexity.
- Frontend removal of Kubernetes access and runtime authentication require careful staged migrations; not every legacy Viewer path should be moved in one PR.

## Source-grounded current-state evidence

The following paths were identified in a source review of commit [`cfdb6b0a0f56bf140b5b67d5572f562d6317d945`](https://github.com/kubeflow/pipelines/tree/cfdb6b0a0f56bf140b5b67d5572f562d6317d945) (Oct 1, 2026). Line numbers can change; verify against the implementation branch before patching.

- `backend/src/apiserver/model/run.go`: Run stores Workflow name/namespace and manifest but no target cluster.
- `backend/src/common/util/execution_client.go`, `backend/src/common/util/service.go`: namespace-scoped execution client, default in-cluster-first Kubernetes config; independent informer.
- `backend/src/apiserver/client_manager/client_manager.go`: separate Workflow, ScheduledWorkflow, core, SAR and TokenReview clients.
- `backend/src/apiserver/resource/resource_manager.go`: Run creation creates Kubernetes Workflow before DB row; delete can discard DB row after Kubernetes failure; retry touches pods and Workflows; report reconciliation checks UID/resource-version/generation.
- `backend/src/agent/persistence/`: single-target observation, namespace/name queue keys, reporting origin without a persistent target identity.
- `backend/src/crd/controller/scheduledworkflow/controller.go`: both local embedded Workflow submission and API `CreateRun` paths.
- `backend/src/v2/driver/cache.go`, `backend/src/apiserver/storage/task_store.go`: central task-cache matching currently lacks target/storage identity.
- `backend/src/v2/compiler/argocompiler/container.go`, `backend/src/v2/config/env.go`: runtime tokens and local cluster-DNS API endpoint assumptions.
- `backend/src/apiserver/auth/authenticator_token_review.go`: one Kubernetes TokenReview trust domain.
- `frontend/server/k8s-helper.ts`, `frontend/server/handlers/pod-logs.ts`, `pod-info.ts`, `artifacts.ts`: frontend direct Kubernetes and storage access.
- `backend/src/apiserver/gc/run_gc.go`: Kubernetes Lease and retention behavior need decoupling.

These are verified observations from that checkout, **not implementation claims for this proposal**; integration testing and security review remain necessary.

## Open questions for implementation reviews

1. What minimal public Run target fields are needed now without cementing Kubernetes concepts into the API?
2. What is the precise command protocol/consistency contract and tombstone retention rule?
3. Should the first adapter be direct clients, and when does agent transport become a separately reviewable improvement?
4. How are runtime workload identities authenticated against a non-local control plane without weakening tenant authorization?
5. Which frontend Kubernetes routes can use existing APIs immediately, and which require new narrow APIs?
6. Which existing features are legacy-target-only during initial rollout (retry, schedules, cache, Viewer, storage)?
7. How is control-plane HA coordination expressed without committing upstream to a single DB vendor?

## Decision requested

Seek agreement on the **separation of durable ownership from disposable execution**, the semantic execution boundary, and the staged migration plan. Approval of this KEP should **not** imply approving all later phases or fixing every detailed API schema in advance. Each milestone should land with its own tests, compatibility assessment and ability to run unchanged in a single-cluster configuration.
