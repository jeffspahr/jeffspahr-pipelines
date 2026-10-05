# KEP: One Kubeflow Pipelines control plane, multiple execution clusters

| Metadata | Value |
| --- | --- |
| Status | Author draft in fork; not submitted or approved upstream |
| KEP number | Unassigned |
| Author | Jeff Spahr (@jeffspahr) |
| Scope | Kubeflow Pipelines API, persistence, runtime, controllers, UI, SDK, deployment |
| Implementation | None; this change contains proposal documents only |
| Preparation baseline | Updated fork master `e3c93651a44fa718ab079010bb332318854e0491`; see [current-base delta](source-investigation.md#s12-updated-fork-base) |
| Source baseline | `kubeflow/pipelines` master at `cfdb6b0a0f56bf140b5b67d5572f562d6317d945` |

## Summary

Allow one Kubeflow Pipelines (KFP) API, UI, and database to manage runs on
multiple registered Kubernetes clusters. Users submit runs normally; KFP resolves
the execution cluster through administrator-defined placement policy. Authorized
users may optionally override that policy with an explicit cluster selection.
The resolved execution location becomes immutable Run identity and governs creation, observation, logs, termination, deletion, and
eventually retry and recurring runs. Requests that omit a target use placement
policy from day one;
single-cluster installations retain their configured default behavior.

The proposal introduces a target-aware execution backend, durable operation
intent, authenticated execution provenance, and a separation between central
tenant ownership and Kubernetes execution location. The first implementation
uses direct Kubernetes client bundles and a separate observation context per
cluster. A per-cluster execution agent is an evaluated alternative behind the
same semantic boundary, not an initial implementation requirement.

The MVP retains one central catalog and metadata database, includes transparent
static policy placement for ad hoc runs, and requires shared reachable object
storage. It does not introduce capacity-aware scheduling, cross-cluster task
scheduling, or failover that restarts a Run on another cluster.

## Motivation

Organizations may operate separate clusters for GPUs, geographic placement,
capacity, or administrative boundaries while wanting one pipeline catalog and
run history. A separate full KFP installation in each cluster duplicates control
planes, user-facing endpoints, and metadata stores.

Current KFP associates execution with a namespace and Workflow name, supplemented
by UID and resource version in saved Workflow manifests. Its backend clients and
UI Kubernetes clients each select one cluster. Namespace/name is ambiguous across
clusters, and a remote runtime pod must also authenticate to the central KFP API
and resolve storage correctly. Extending only Workflow creation would leave
observation, deletion, logs, authorization, and other paths attached to the wrong
cluster. See the [source investigation](source-investigation.md).

### Goals

- Retain one KFP API/UI and one central KFP database/catalog.
- Resolve placement transparently using administrator-defined policy from day one.
- Permit explicit cluster selection as an optional, separately authorized override.
- Bind every execution mutation and observation to immutable target identity.
- Preserve database-backed Get/List during an execution-cluster outage.
- Survive ambiguous Kubernetes responses without losing cleanup identity or
  dispatching the same Run to another cluster.
- Preserve the omission-to-default contract for single-cluster installations.
- Establish a boundary that can later support local execution agents.
- Define the changes needed for schedules, cache, metadata, storage, UI, and
  security, even where the MVP deliberately restricts those capabilities.

### Non-Goals

- Dynamic capacity-aware scheduling, reservations, or load balancing across clusters.
  Static policy-based placement is included in the MVP.
- Moving an existing Run or its retry to a different cluster.
- Splitting a single Run's tasks across clusters.
- Provisioning Kubernetes clusters or synchronizing arbitrary Secrets/PVCs.
- Federating independent KFP databases or importing their live runs.
- Guaranteeing exactly-once execution of user task side effects.
- Supporting every historical KFP release's MLMD/cache architecture with this design.

## Proposal

The central service owns Run identity, tenant policy, durable intent, metadata,
and API behavior. Execution clusters own Workflows, pods, local storage resources,
service accounts, and the Argo controller that executes those Workflows.

A registered cluster is an administrator-controlled destination, not a user
supplied Kubernetes endpoint or kubeconfig. The API resolves the destination
before execution, persists it, and never changes it in response to a failure.

### User stories

1. A pipeline user submits a training run without naming a cluster. An
   administrator-defined experiment or tenant policy resolves it to `gpu-east`;
   the user reads state, logs, and outputs through the normal KFP UI. An
   authorized advanced user can optionally request a specific destination.
2. An administrator grants a central tenant access to a particular execution
   namespace/service-account set in `gpu-east` without granting access to all
   similarly named namespaces in other clusters.
3. An operator loses connectivity to `gpu-east`. Historical Get/List continues,
   observations are marked stale, and cancellation/deletion intent is retained
   until the cluster can be reconciled.
4. An existing single-cluster installation upgrades without changing SDK calls;
   new submissions continue using the registered legacy/default cluster.

### Proposed architecture

```text
                         Users / SDK
                              |
                              v
                    +--------------------+
                    | One KFP UI / API   |
                    | tenant + target    |
                    | authorization      |
                    +---------+----------+
                              |
               +--------------+----------------+
               |                               |
               v                               v
    +-----------------------+      +--------------------------+
    | One central KFP DB    |      | Placement / execution    |
    | Runs / targets        |      | registry + client bundles|
    | Tasks / artifacts     |      | per-cluster observers    |
    | durable operation     |      | operation reconciliation |
    | intent / tombstones   |      +------------+-------------+
    +-----------------------+                   |
                            +------------------+------------------+
                            |                                     |
                            v                                     v
                 +----------------------+             +----------------------+
                 | Kubernetes A         |             | Kubernetes B         |
                 | Argo / Workflows     |             | Argo / Workflows     |
                 | local runtime pods   |             | local runtime pods   |
                 | local SA/config/PVCs |             | local SA/config/PVCs |
                 +-----------+----------+             +-----------+----------+
                             |                                    |
                             +-------- TLS runtime API -----------+
                                              |
                                              v
                                     Central KFP API

                 Runtime pods in A/B <--> Shared object storage

        Cluster-specific list/watch --> central report reconciliation
        Cluster-specific TokenReview --> qualified runtime identity
```

One central database means one logical KFP metadata store. It does not require
all runtime Kubernetes resources to move into the control-plane cluster.

### Constraints

This draft is grounded in the pinned source baseline, rather than an unspecified
latest release. The baseline's runtime uses the KFP Task/Artifact APIs and native
database caching. Legacy MLMD files/configuration remnants are not evidence of
an active MLMD runtime client in this path. Older deployed versions require a
separate compatibility investigation. [S8](source-investigation.md#s8-cache-and-metadata)

## Design details

### Execution identity and namespace ownership

Conceptual types, not final protobuf definitions:

```text
ExecutionTarget {
  cluster_id
  namespace
}

ExecutionResource {
  target
  workflow_name
  workflow_uid
  attempt_generation
}
```

`cluster_id` is a stable, non-secret installation identity. Display names,
endpoints, credentials, and CA bundles are registration properties. Credential
rotation is allowed; repointing an existing ID at a replacement cluster is not.
Replacing a cluster requires a new ID even when the operator reuses its name.

Central ownership remains attached to the experiment/tenant namespace. Execution
namespace is a separate concept. The MVP requires an approved mapping to the
same namespace name on the selected cluster; it does not expose arbitrary
namespace remapping. Equal namespace strings alone never establish permission.

The default cluster used for new submissions is distinct from the fixed legacy
cluster assigned to pre-migration rows. Changing the submission default must
not reinterpret existing Run identity.

### Transparent placement from day one

Placement is a server-side step before submission intent is persisted. The normal
UI and SDK submission flow requires no cluster knowledge or additional input.
For the MVP, administrators configure deterministic mappings with this precedence:

1. An explicit cluster override, if the caller has override permission and the
   destination passes the same tenant/namespace/service-account eligibility checks.
2. An experiment-specific mapping scoped to its owning central tenant.
3. A central tenant/namespace mapping.
4. The configured installation default, if permitted for that tenant.

Each mapping names one registered destination. Reject conflicting mappings at
configuration validation; do not choose by rule iteration order. Rules match
authoritative experiment/tenant identity, not arbitrary user-supplied labels.
Placement policy does not itself bypass destination authorization. Permission to
submit through an approved policy does not automatically grant override permission.

Validate the resolved target is Active and meets configured execution prerequisites.
An unauthorized, draining, retired or unconfigured mapped target yields a clear
submission error; do not silently try a lower-precedence mapping. A transient
connectivity failure also must not select another cluster: reject before acceptance
or retain target-bound submission intent after acceptance. There is no placement
queue, live capacity polling, reservation or automatic failover in this MVP.

Persist the resolved target and the placement provenance (policy revision and
matched rule, installation default, or explicit override) with Run/submission
intent before any Kubernetes create. API replicas must use a consistent published
policy revision. Policy changes affect new Runs only. An idempotent replay of an
accepted submission returns its original Run and placement even if policy changed;
reconciliation, termination, deletion and later retry never rerun placement.

Single-cluster installations need no new submission arguments or mapping rules:
their existing cluster is registered as the permitted installation default. Later
capability constraints (for example GPU, region or data locality) and dynamic
capacity-aware scheduling may extend this boundary without making cluster IDs
mandatory in callers or portable pipeline IR.

### Registration and cluster lifecycle

Introduce a registry with stable IDs, lifecycle state, configuration revision,
credential references, allowed tenant/namespace/service-account mappings,
runtime API endpoint/TLS settings, and storage-profile references. Credentials
remain in operator-managed secret storage; do not copy credential values into
Run rows, Workflow annotations, or public target responses.

For the MVP, operators supply registration through controlled configuration.
Persist the stable registration identity/lifecycle and reject incompatible
configuration changes across API replicas. Dynamic registration APIs are later
work. A discovery API exposes only destinations the caller may use and their
non-secret readiness/capability information.

Registration validation checks API/CA connectivity, required CRDs and RBAC,
supported runtime/controller versions, approved namespaces/service accounts,
and the configured storage/API connectivity contract. Runtime-to-central
connectivity must be exercised from an execution pod; a central API probe alone
cannot establish it.

Suggested lifecycle: `Active -> Draining -> Retired`. Draining rejects new Runs
and schedules but permits observation, logs, cancellation, and deletion.
Retirement is blocked by unresolved execution/cleanup records. Preserve historical
registrations for Get/List; never cascade-delete Runs when removing credentials.
Forced retirement, if added later, is an explicit administrative abandonment
operation with retained tombstones and audit history.

### Data model and persistence

| Entity | Proposed change |
| --- | --- |
| `run_details` | Add placement provenance (policy revision/matched rule or override/default), immutable cluster identity and resolved execution namespace, explicit Workflow UID, registration/storage configuration references, observation freshness, and durable operation state or a link to it. Keep central ownership distinct. |
| `recurring_run_states` | API-owned tick claims inherit the immutable Job target through `JobUUID`; preserve claims and completion atomicity when adding routing. No independent placement field is needed unless state can outlive its Job. |
| `jobs` | Add target identity before enabling remote recurring runs. Existing jobs are bound to the legacy cluster during migration. |
| Cluster registry | Persist stable identity, lifecycle, and non-secret configuration references/revision. |
| Operation/tombstone records | Retain Run ID, target, intended Workflow name/UID, desired action, generation, and retry status across crashes and deletion. |
| `tasks` | Derive target from `RunUUID`; optionally denormalize cluster/cache scope for indexed lookup. Validate any denormalized value against the owning Run. |
| `artifacts` | Add trusted storage-profile provenance where URI meaning depends on provider configuration; cluster identity alone is not storage identity. |
| `artifact_tasks` | Derive execution provenance through existing Run/Task relationships; an independent cluster column is unnecessary initially. |
| Experiments/pipelines/versions | Keep central logical ownership. They do not need cluster columns merely because their Runs execute remotely. |
| Legacy metrics/resource references | Resolve execution location through Run identity; do not encode authoritative cluster selection as an optional legacy reference. |

The Run/Job SQL stores use explicit column lists, scans, and write maps. Changing
GORM model fields alone is insufficient. Migration must update all projections,
filters, inserts, concurrency predicates, and list responses. Index design must
be reviewed for supported MySQL/PostgreSQL dialects and existing key-length
constraints. [S2](source-investigation.md#s2-persistence)

Artifacts can outlive a Run or be imported/reused; assigning every Artifact one
execution cluster would conflate production provenance with storage identity.
For the MVP, approved shared storage gives URIs consistent meaning across
targets. The wider design scopes artifact identity/reuse by trusted storage
profile and tenant, where required.

### Public API and SDK

Add an optional `execution_target` to Run submission and return its resolved
value and non-secret placement provenance on Get/List. Omission invokes placement policy; `cluster_id`, when supplied,
is an optional override selecting a registered destination. The
execution namespace is resolved server-side; the initial API can expose it as
output while rejecting unsupported overrides. Add target filtering and
authorized destination discovery. Exact protobuf tags are assigned during API
review using unused numbers; existing field numbers and semantics remain intact.

The normal SDK call remains unchanged:

```python
client.create_run_from_pipeline_package(
    "training.yaml",
    experiment_id=experiment_id,
)
```

An authorized user may optionally add `cluster_id="gpu-east"`; the SDK maps that
convenience argument to the API execution target. Neither the SDK nor UI resolves
policy locally. Placement belongs to submission, so compiled pipeline IR stays portable.
Extend `run_pipeline` and both create-run helpers, generated HTTP clients,
OpenAPI/gateway bindings, converters, and UI types together.

Add a submission idempotency key with caller/tenant scope. Reusing a key with a
different requested override or materially different request fails validation.
An omitted target is part of the original request; a policy change must not turn
its replay into a new placement or payload conflict. Without a
key, retrying an entire client request may create another logical Run; deterministic
Workflow naming only prevents duplicate Workflows for the same Run ID.

Get/terminate/delete use Run ID and derive the target from persisted state.
Callers cannot redirect an existing Run by passing another cluster. Retry also
retains the original target. Report APIs need authenticated origin context;
their existing REST bindings use a serialized-resource field as the body, so
adding fields must preserve that transport contract.
[S3](source-investigation.md#s3-public-run-api)

### Execution backend boundary

Keep lifecycle coordination in `ResourceManager`. Introduce an engine-neutral
semantic backend selected by resolved target, conceptually:

```text
ExecutionBackends.ForTarget(target)
  EnsureExecution(intent)
  ObserveExecution(resource)
  RequestTermination(resource, generation)
  EnsureExecutionDeleted(resource, generation)
  ReadLogs(run/task identity, options)
  ValidateRuntimeIdentity(request)
```

These names describe responsibilities, not committed Go signatures. Local
Workflow/resource adapters remain behind this interface. An implementation must
support conditional identity checks and classify definitive absence separately
from transport/authentication failures.

The direct implementation owns a cluster-scoped Argo/core client bundle and,
when enabled, ScheduledWorkflow and TokenReview clients. Constructors accept
explicit `rest.Config`; they do not independently rediscover the process's
default cluster. Reuse clients/rate limiters per cluster and separate observer
contexts/queues so one unavailable destination does not block others.

`ExecutionClient.ForCluster(clusterID)` alone would cover Workflow operations
but miss core pod/log access, authorization, schedules, plugin configuration,
frontend clients, and runtime clients. Central catalog/webhook clients and GC
leader-election clients remain explicitly central. Driver/launcher clients
remain local to their execution pods.
[S1](source-investigation.md#s1-client-construction-and-routing)

### Run lifecycle and operation semantics

The following changes are required for remote targets. Use shared lifecycle code
where possible; the default cluster must retain API compatibility even where
failure handling becomes stricter.

| Operation | Proposed behavior |
| --- | --- |
| Create | Authorize submission; resolve static placement policy or authorized override; validate target and service accounts; resolve config; transactionally persist Run, resolved target, placement provenance and submission intent; create a deterministically named Workflow; reconcile UID/result into the row. |
| Observe | Select target from trusted observer context; load Run; require target/name/UID/generation agreement before state updates or cleanup. |
| Get/List | Read central DB, return resolved target and last observation time; do not require execution-cluster reachability. |
| Archive/unarchive | Update logical storage state; preserve target and operation identity. Archival does not imply cancellation or execution deletion. |
| Terminate | Persist cancellation intent and issue a target-specific, identity-checked mutation; reconcile until observed terminal or a definitive condition requires operator action. |
| Delete | Persist deletion intent, prevent further submission/retry, perform UID-conditional foreground Workflow deletion, observe required cleanup, then remove user-visible records while retaining any needed tombstone. |
| Retry, later | Retain target, existing retry generation/CAS protections, and task reset semantics; route both failed-pod deletion and Workflow update/create to that target. |

Source behavior differs today: CreateRun creates Kubernetes execution before
inserting the Run, and DeleteRun continues with DB deletion after any Kubernetes
delete error. The proposal replaces those failure semantics for remote safety.
[S4](source-investigation.md#s4-run-lifecycle-and-failure-ordering)

#### Submission and concurrency

Use stable Run ID and deterministic Workflow name for reconciliation. An
AlreadyExists response permits adoption only after checking Run ownership,
target, expected submission identity, and generation. A name/label match by
itself does not authorize adopting an unrelated replacement Workflow.

Persist the compiled submission intent or an immutable reference/digest sufficient
to reproduce it. If create succeeds but its response is lost, perform a live
lookup in the same cluster and reconcile the result. A timeout never authorizes
fallback to another cluster.

Serialize lifecycle actions per Run using durable claims/CAS and explicit
operation generations. Deletion or cancellation arriving during submission must
supersede future dispatch and remain visible to an in-flight worker. Central
leases alone do not fence a Kubernetes request already in flight: retained
tombstones and observer reconciliation must catch late-created resources and
clean them up. Define and test worker quiescence and request deadlines; do not
claim cross-system atomicity or exactly-once task execution.

An initial report can race persistence of the create response. Only the trusted
submission reconciler may establish the first UID from the intended live object;
the ordinary report path waits or reconciles through that mechanism. It must
not adopt an arbitrary UID simply because the pre-created Run has no UID yet.

#### Cancellation and deletion responses

Preserve the current RPC response shapes for the MVP. A successful terminate
response means the termination request has been applied, not that all pods have
already stopped. Execution completion is observed separately. An unreachable
target returns a retryable error while retaining cancellation intent.

Delete returns success only after the recorded Workflow and its owned pods meet
the documented deletion condition. A deadline/outage returns a retryable error
and leaves durable pending deletion visible to subsequent reads/retries. A live
UID mismatch blocks deletion and requires reconciliation; it is not permission
to delete a same-name replacement. Definitive NotFound is scoped to the correct
registered cluster and checked against in-flight submission/cleanup state.

Kubernetes foreground deletion does not promise removal of externally managed
resources or PVCs deliberately configured for retention. Such resources follow
their declared ownership/retention policy. Tombstones survive ordinary Run
retention while requests or late reports could still recreate/adopt execution.
The initial design favors retaining them over premature cleanup.

### Observation, reports, and health

Run one list/watch context per registered cluster. Scope queues and informer
caches by cluster, either structurally separate or with composite keys. Existing
`namespace/name` keys are safe only inside one cluster context.

The MVP uses trusted central observer contexts to invoke reconciliation. Legacy
public persistence-agent reports remain bound to the legacy cluster. Enabling
remote agents later requires a registered identity bound to exactly one cluster;
a request field or Workflow annotation cannot establish origin.

Extend current live UID, namespace/name, resource-version and retry-generation
checks with cluster identity before any Kubernetes lookup or database update.
Preserve the final-state persistence/label/cleanup ordering. Kubernetes resource
versions are opaque and scoped to the relevant API server; never compare versions
across clusters as a global ordering mechanism.
[S5](source-investigation.md#s5-observation-reporting-and-cleanup)

Expose cluster connectivity, observer freshness, last successful observation,
pending operations, and reconciliation errors separately from Run phase. An
unreachable cluster does not prove a Run failed. Relist on reconnect and requeue
pending operations. Apply per-cluster backoff, concurrency budgets, and QPS caps.

Central liveness must not fail because one execution cluster is unavailable.
Keep central DB/control-plane readiness and per-target execution readiness
separate. Report metrics for target health, observation lag, ambiguous writes,
pending cancellation/deletion age, and reconciliation outcomes with bounded
label cardinality.

### Authentication and authorization

The security boundary has three separate decisions:

1. **User ownership:** authenticate the user and authorize central KFP Run,
   experiment, pipeline, and artifact access using the central tenant policy.
2. **Placement authority:** authorize use of the registered cluster, execution
   namespace, and effective service-account set. Central namespace permission
   alone does not grant placement on every cluster. Policy-selected placement
   requires destination authorization; explicit overrides require an additional
   permission and cannot bypass destination eligibility.
3. **Runtime identity:** authenticate the executing workload in its actual
   cluster and bind its permitted API methods/resources to its Run.

For the direct MVP, a runtime request containing/bound to a Run ID selects that
Run's registered TokenReview client after an internal DB lookup. The lookup does
not grant access. The request still needs a valid token, expected Run audience,
approved target namespace/service account, and method/resource authorization.
Do not try the token against every cluster or trust an unverified issuer hint as
the final cluster identity. Include cluster identity in authentication cache keys.

Represent remote service-account principals as cluster-qualified identities.
Never feed a bare remote `system:serviceaccount:namespace:name` into central SAR
as if it were the same central-cluster account. Runtime authorization should
permit the required Run/Task/Artifact methods for the authenticated Run and
approved storage scope, while user access continues using central policy.
Preserve audience binding and reject tokens from another Run/cluster even when
namespaces/service-account names match. Broad remote tokens for generic APIs are
outside the MVP.

Projected token possession/audience is not a new isolation boundary against an
administrator or principal allowed to create arbitrary pods using the same
service account. State that trust assumption explicitly and retain Kubernetes
RBAC restrictions; evaluate pod-bound token identity checks during security review.

The API's cluster credentials are operator-managed and least-privilege for the
required namespaces and verbs. Where target-local SAR policy is used later,
identity mapping is explicit. All remote runtime/API communication uses TLS
with validated trust and token rotation. The existing single-cluster TokenReview
and SAR construction requires changes; it cannot validate arbitrary remote tokens.
[S9](source-investigation.md#s9-authentication-and-service-accounts)

### Runtime configuration and local resources

Compile a reachable central KFP endpoint and TLS configuration into the selected
Run. Existing compiler-generated service DNS/arguments can override environment
fallback, so environment injection alone is insufficient. Persist the chosen
configuration revision for reconciliation and audit.

Each execution cluster runs compatible Argo components and has approved runner
service accounts/RBAC, launcher configuration, image access, storage credentials,
and workload prerequisites. Driver/launcher Kubernetes operations remain local:
reading the current Workflow, creating/deleting PVCs, resolving Secrets and
ConfigMaps, and configuring image pulls. Cluster-local names do not imply the
same resource exists in another cluster.

Server-side plugin hooks must receive target context for target-owned
configuration/credential operations. Keep central plugin settings central;
document which configuration source owns each override. Disable unsupported
plugins for remote targets rather than silently reading the central cluster's
same-name Secret. [S10](source-investigation.md#s10-runtime-configuration-storage-and-plugins)

### Scheduled runs

Full support requires a target on Job/RecurringRun as well as Run. Schedule
creation, enable/disable/delete, startup reconciliation, reporting, and both
controller submission paths must use it. The current controller can directly
create an embedded Workflow or call CreateRun; both paths need provenance.

The updated fork also persists API-owned tick claims in `recurring_run_states`
and validates deterministic recurring Workflow reuse. Preserve these protections;
target routing must not create a second scheduling authority.
[S12](source-investigation.md#s12-updated-fork-base)

Keep a schedule and its generated Workflows in the same execution cluster so
owner references and local concurrency tracking remain meaningful. Bind each
generated Run to the Job target and reject conflicting target requests. Current
Job UUID is taken from the ScheduledWorkflow UID; a future separation of logical
Job ID and Kubernetes UID needs explicit migration, not silent identity reuse.

The MVP pins existing schedules and their generated Runs to the legacy cluster
and rejects remote recurring-run selection. A change to the default ad hoc target
must not move existing schedules. [S7](source-investigation.md#s7-recurring-runs)

### Cache and metadata

The inspected runtime finds cached successful tasks through KFP APIs and the
`tasks` table. Include target/storage scope in cache authorization and lookup
before allowing remote cache reuse. A join through Run can provide target;
denormalization may be justified by index/query cost. Scope is applied even with
a custom fingerprint. Same PVC/Secret names or URI strings across clusters do
not establish equivalent execution inputs or accessible output bytes.

The MVP disables caching for remote runs in both compiled behavior and the
server's cache lookup policy; disabling only the UI flag is insufficient. Existing
legacy-cluster caching remains available. Cross-cluster reuse later requires
explicit policy for tenant access, storage provenance, and execution equivalence.

Tasks inherit target from their Run. Pod references are resolved in that target;
do not make raw pod names globally meaningful. Artifact identity/reuse must not
merge different physical stores just because namespace and URI match. Legacy
MLMD compatibility fields do not need a new MLMD federation layer for this source
baseline. [S8](source-investigation.md#s8-cache-and-metadata)

### Artifacts, roots, logs, and storage trust

The MVP requires administrator-approved shared object storage reachable from all
enabled execution clusters and the authorized content-serving path. Resolve and
persist the selected storage profile/root for each Run; do not re-resolve old
artifacts against an unrelated replacement configuration. Credential rotation is
allowed within the same profile identity. Cluster-local default service names
and identical `minio://bucket/key` strings are not proof of shared storage.

Backend log APIs resolve target from Run identity, validate pod ownership and
container selection, stream with cancellation, and use trusted archive provenance
after pod removal. Archived log configuration and artifact content access need
storage-profile resolution instead of one implicit global bucket assumption.

Do not move tenant-secret resolution into a centrally privileged service without
preserving its authorization boundary. An Artifact row containing a URI is not
by itself permission to use central credentials against that URI. Retain exact
artifact identity checks and enforce approved roots/endpoints, credential scope,
redirect policy, and bounded previews/streaming downloads.

Coordinate the eventual artifact-ID content/storage-provenance API with
[kubeflow/pipelines#14031](https://github.com/kubeflow/pipelines/issues/14031).
[Issue #14046](https://github.com/kubeflow/pipelines/issues/14046) concerns URI
provider-query authority and is relevant specifically to preserving that storage
trust contract; it is not a prerequisite for Workflow routing.

### Frontend considerations

Keep normal submission free of a required cluster selector. Offer an optional
advanced override only to authorized users. Show the resolved target, placement
provenance, namespace, observation freshness, and pending operation state in Run
views. Omitted selection invokes server-side placement policy. Existing run-based links
continue to resolve location server-side.

The UI server currently accesses Kubernetes independently for logs, pod
information/events, Workflow lookup, artifact configuration/credentials, and
Tensorboard Viewer resources. Route execution-facing functionality through
authenticated backend APIs keyed by Run/task/artifact identity. Keep diagnostics
and log/archive behavior available as routes migrate.

Removing all UI Kubernetes access is a staged prerequisite for a complete
cluster-independent UI. UI signing-key bootstrap and self-pod/config discovery
are separate infrastructure concerns: replace them with deployment-provided
configuration/material rather than routing them to a Run's cluster. Remove UI
Kubernetes RBAC/token/client dependencies only when callers have migrated.

For the MVP, remote logs and basic Run views use backend APIs; unsupported remote
viewer/pod diagnostic paths are explicitly disabled with a capability explanation.
Do not issue a local-cluster lookup as fallback. Remote Tensorboard/PVC viewers
are deferred. [Issue #10740](https://github.com/kubeflow/pipelines/issues/10740)
documents pod-event visibility users need to preserve; it is context for that
feature, not an architectural dependency.
[S11](source-investigation.md#s11-frontend-and-independent-kubernetes-access)

### KFP local considerations

Cluster selection is a remote submission option. The pipeline IR and local
Subprocess/Docker execution remain independent of cluster registration. A local
execution interface must reject an execution-target argument if one is exposed
there; silently ignoring placement would be misleading. Local compilation does
not contact the registry or embed cluster credentials. SDK tests cover this
separation and continued compilation/local execution of unchanged pipelines.

### Cleanup and retention

Run retention currently invokes database archive/delete methods separately from
Workflow cleanup. Preserve pending operations and tombstones independently of
Run-row retention. Kubernetes final-state persistence, Workflow TTL, pod/PVC
retention, and archived object retention are separate policies.

Configure Workflow retention so central observation can persist terminal state
before execution evidence disappears. A watch cannot reconstruct history already
removed during a long outage. If the Workflow is absent without a persisted final
state, report an explicit unresolved observation condition instead of inventing
success/failure. Audit such cases and keep cleanup provenance.

The GC leader-election Lease remains in the central cluster. Per-target cleanup
workers need separate budgets and backoff; one unreachable cluster must not
prevent another's cleanup. [S6](source-investigation.md#s6-database-retention-and-health)

## Migration and compatibility

1. Add schema fields/tables and read-compatible handling for null/empty cluster
   identity. Install a fixed legacy registration matching the old execution
   cluster. Backfill Run and Job targets; recover namespaces from existing
   authoritative fields/manifests/references using current legacy rules.
2. Update every API replica, report consumer, lifecycle worker, and GC path before
   enabling remote submissions. Old binaries must not process remote rows with
   local clients. A rolling upgrade uses the feature gate off until the entire
   relevant control plane is compatible.
3. Deploy optional protobuf fields/converters/generated clients. Old SDK calls
   omit selection and use policy, which resolves to the existing default for
   single-cluster installations without additional rules. Verify actual generated-client
   handling of added response fields, rather than assuming it.
4. Validate default-cluster create/get/list/archive/retry/terminate/delete and
   recurring-run behavior. Migrate existing target identity independently of
   any later change to the default submission target.
5. Register additional clusters, validate prerequisites, then enable an alpha
   feature gate for approved tenants and ad hoc runs only.

The migration is additive and must be tested on supported databases with old
rows, large histories, legacy namespace representations, and interrupted/repeated
backfills. Use existing migration bookkeeping and explicit SQL scan/write updates.

Disabling the feature gate stops new remote dispatch but does not disable
observation, cancellation, deletion, or reads for existing remote Runs. Downgrading
to an unaware binary is unsupported while remote execution/cleanup remains.
Drain remote work first and retain the schema/identity data; do not rewrite remote
rows to the local default to make a downgrade appear compatible.

## Implementation plan and minimum viable scope

| Stage | Deliverable |
| --- | --- |
| 0 | Identity/schema, operation-intent semantics, cluster registry, static placement policy and provenance, API/SDK contract and migration tests. |
| 1 | Explicit client configuration and semantic execution backend; prove default-cluster parity. |
| 2 | Remote ad hoc creation, trusted per-cluster observation, runtime authentication/API connectivity, safe terminate/delete, shared storage and remote cache restrictions. |
| 3 | Transparent UI submission, optional authorized override and resolved-target display, routed logs, unsupported-path guards, outage/cleanup observability and two-cluster E2E validation. These complete the alpha MVP. |
| Later | Capability constraints and dynamic capacity-aware scheduling; target-aware retry, schedules, scoped cache, storage profiles/content API, remote viewers/plugins, and optional execution agents. |

The MVP supports transparent static policy placement with an optional authorized
override, correct-cluster creation/observation and
Get/List, termination, and deletion; it preserves default single-cluster use.
All tasks of a Run execute in its selected cluster. Default-cluster schedules and
retry remain supported under existing behavior.

The MVP excludes remote recurring runs; remote retry/resume; dynamic capacity-aware
scheduling, reservations or failover; cross-cluster task execution/cache reuse; arbitrary cluster-local
storage; arbitrary namespace remapping; unsupported remote plugins/viewers; and
self-service registration/forced removal. Reject these combinations explicitly.

## Test plan

This is a documentation-only draft. No implementation tests or coverage claims
are implied. Component owners may require additions to this plan before
implementation. Current coverage measurements have not been collected.

### Prerequisite testing updates

- Capture default-cluster API/SDK behavior and migration fixtures for legacy
  namespace/manifest representations.
- Add injectable per-cluster client/backend factories and controllable observer
  contexts; distinguish timeout-after-commit from definitive NotFound.
- Establish two-cluster test infrastructure with deliberately identical namespace,
  Workflow, pod, service-account, PVC, and Secret names where applicable.

### Unit tests

- Placement precedence, conflicting-rule rejection, policy revision consistency,
  override permission, ineligible-target rejection without fallback, immutable
  resolved target/provenance, registration replacement rejection, tenant
  mapping, Run/Job target consistency, and constructor configuration propagation.
- API converters, explicit SQL scans/writes, filter/pagination handling, and
  operation CAS/generation/tombstone retention.
- Report-origin validation before live lookup; UID replacement, stale resource
  snapshots, retry generation, and create-response/report races.
- Cluster-qualified token identity/cache keys, Run audience/method scope, and
  refusal of same-name service accounts from the wrong cluster.
- Target-aware logs/ownership; archive provenance; disabled remote cache on both
  compilation and API lookup paths; future custom-key scope.
- UI capability guards, submission without a cluster selector, and SDK
  omission/policy/override/local-execution behavior.

### Integration tests

- MySQL and PostgreSQL additive migration/backfill, idempotent reruns, existing
  rows, large-list queries, and feature-gated rolling upgrade.
- Crash after intent persistence, Kubernetes create accepted/response lost,
  DB update failure, duplicate submission key and mismatched payload rejection.
- Change policy between submission and idempotent replay; return the original
  placement. Persist policy provenance atomically with Run/intent; reject new placement
  from replicas with stale policy revisions, while continuing reconciliation of
  previously accepted Runs using their stored target.
- Cancellation/deletion racing create/retry; worker lease loss with in-flight
  requests; late Workflow creation/report after deletion; tombstone persistence.
- Kubernetes deletion acknowledged but finalizer/owned pod cleanup pending;
  UID mismatch and same-name replacement must not delete the replacement.
- Remote authentication rotation, wrong audience/cluster/Run, auth-service
  failure, unauthorized target, and credential/config revision changes.
- Shared-store artifact reads and imported artifact attacks against unapproved
  roots/endpoints; large/interrupted log and artifact streams.
- Watch disconnect, relist, stale observations, remote TTL before persistence,
  and independent progress of healthy clusters.

### E2E tests

- One KFP installation plus two execution clusters: submit the same pipeline
  without cluster arguments under two tenant/experiment mappings; verify resource
  location, central Run/Task/artifact history,
  logs, terminal status, and target-isolated terminate/delete. Exercise an
  authorized explicit override and reject the same override for an ordinary user.
- Use identical namespace/pod names in both clusters to prove correct routing;
  an unauthorized user must not read or mutate the other target's resources.
- Partition one cluster: reads remain available, state becomes stale, operation
  intent persists, no fallback execution occurs, and reconnect completes cleanup.
- Run the supported UI paths without direct UI Kubernetes access; ensure unsupported
  remote paths are guarded and default-cluster user flows still work.
- Change mappings/default and prove only new ad hoc Runs receive new placement;
  existing Runs, idempotent replays and legacy schedules retain their target.
- Submit from an unchanged SDK and the normal UI without any cluster selection;
  verify single-cluster default behavior and clear errors for invalid mapped targets.
- Drain a registration and verify no new dispatch, continued cleanup, and blocked
  retirement while unresolved operations remain.

### Graduation criteria

**Alpha:** feature gated, static registrations, two-cluster tests passing for the
MVP, supported-version prerequisites documented, migration/rollback restrictions
tested, and security review of runtime identity and cleanup completed.

**Beta:** evidence from sustained multi-cluster operation; bounded per-cluster
resource use and failure isolation; reviewed target-aware retry/schedule support
or an explicit stable exclusion contract; artifact and UI coverage documented.

**Stable:** documented compatibility/support matrix, tested upgrades across the
supported release window, recovery/rotation/drain procedures, and measured
scalability targets agreed by maintainers. No release version is promised here.

## Risks and mitigations

| Risk | Mitigation / review requirement |
| --- | --- |
| Wrong-cluster mutation or report | Immutable target, qualified clients/queues/principals, origin validation and collision tests. |
| Central credential compromise | Least-privilege per-target credentials, external secret references, rotation/audit; agent alternative for stronger custody requirements. |
| Ambiguous write or crash | Durable intent, deterministic resource identity, conditional adoption/mutation, retained tombstones, no cross-cluster failover. |
| Tenant credential boundary expands during UI migration | Artifact-ID/provenance authorization and scoped content serving; do not grant the central service arbitrary tenant-secret use. |
| Cache/artifact collision | Target/storage scope, trusted provenance, and remote-cache exclusion in MVP. |
| Lost terminal history during outage | Persistence-aware retention, stale/unresolved observation state, operational alerts and recovery documentation. |
| Unsupported old binary handles remote row | Feature-gated full control-plane upgrade; downgrade blocked until drained. |
| A failed target exhausts central resources | Per-cluster QPS, worker/queue/concurrency budgets and independent readiness. |

Before implementation approval, request review from KFP backend/API, frontend,
SDK, deployment, and security owners, including owners of artifact provenance
work. Reviewers and approvers are not assigned by this fork draft.

## Drawbacks

The central control plane becomes responsible for multiple remote failure domains
and credentials. Even the constrained MVP requires authentication, persistence,
reconciliation, runtime configuration and UI work beyond a client factory change.
Operations must preserve enough state to recover safely, adding schema and
operational complexity. Shared storage and static placement policy limit the first
release's flexibility. Multi-cluster capability also expands the supported
deployment/test matrix.

## Alternatives

### Direct clients versus per-cluster execution agents

| Dimension | Direct client bundles | Per-cluster execution agent |
| --- | --- | --- |
| Change to current KFP | Adapt existing synchronous ResourceManager operations and per-cluster observers. | Add command protocol, delivery/acknowledgment semantics, local operation reconciliation and version negotiation. |
| Credentials/security | Central service holds scoped access to each Kubernetes API. | Kubernetes credentials stay local; agent credentials and command authority still need cluster/tenant scoping. |
| Networking | Central-to-Kubernetes connectivity plus runtime-to-central API/storage. | Push requires reachable agents; outbound pull/stream can avoid inbound cluster access. Runtime API access or a scoped proxy is still needed. |
| Watches/reconciliation | Per-cluster central informers or separately authenticated persistence reporters. | Local informers, durable/report resync contract; central live verification must move behind agent operations. |
| Failure modes | Kubernetes timeout after commit, credential expiry, watch outage. | Also duplicate/lost command acknowledgments, stale agents, protocol skew and disconnected reports. |
| Registration/removal | Endpoint/CA/credential references and drain enforcement. | Agent enrollment, identity/epoch/version/capabilities and drain enforcement. |
| Scalability | Central connections/informer memory/QPS grow with targets. | Distributed watch load; central event/command ingestion still needs partitioning and backpressure. |
| Architectural fit | Closest to current execution APIs and live-identity checks. | Reuses local-controller/persistence concepts, but the existing persistence agent cannot execute commands. |

Proposed initial choice: direct clients for a bounded set of reachable clusters.
Choose the agent implementation instead if outbound-only networking or local
Kubernetes credential custody is a hard requirement. This choice follows the
source investigation; extending the existing persistence agent alone does not
satisfy the command/reconciliation contract.

An agent variant would look like:

```text
Central KFP API / DB / execution intent
    |
    +-- authenticated command/report channel --> Agent A --> Kubernetes A
    |
    +-- authenticated command/report channel --> Agent B --> Kubernetes B
```

Agents would need command IDs/generations, at-least-once delivery with idempotent
reconciliation, authenticated cluster origin, live UID-conditional mutation,
resync/freshness reporting, and enrollment/retirement fencing. These semantics
cannot be inferred from a generic RPC success acknowledgment.

### Other alternatives

- **Separate KFP installation per cluster:** strongest immediate isolation, but
  does not meet the one-API/UI/database goal.
- **Only add `Run.cluster_id` and a Workflow client factory:** misses schedules,
  core/pod clients, authentication, cache/storage, reporting and UI dependencies.
- **Treat namespace as a global cluster-qualified string everywhere:** conflates
  central tenant ownership with execution location and breaks Kubernetes namespace
  semantics; explicit target identity is clearer.
- **Generic Kubernetes proxy in the UI:** retains Kubernetes-specific UI contracts
  and caller-directed resource coordinates; prefer authorized resource APIs.
- **Automatically fail over on timeout:** risks duplicate work and cross-cluster
  side effects; requires a separate placement/failover proposal.

## Open questions before implementation

1. Final API field/discovery/operation-status shapes, protobuf tags, and whether a
   future asynchronous operation API should replace retryable legacy responses.
2. Exact operation table/CAS schema and tombstone reclamation proof, including
   late requests, worker replacement, DB restore and disaster recovery.
3. Registered cluster incarnation validation and the approved remote credential
   provisioning/rotation mechanism.
4. Runtime principal authorization details, pod-bound token validation, and
   migration of current SAR behavior without identity collisions.
5. Storage-profile immutability/revision rules and the integration boundary with
   artifact-content/provenance work in #14031.
6. Supported Argo/Kubernetes/runtime version matrix and quantified per-cluster
   scale/latency budgets.
7. Whether deployment requirements demand the agent design before the MVP.

## Implementation history

- Initial author draft prepared from the source investigation in this proposal.
- Revised the MVP to include transparent static policy placement from day one;
  explicit cluster selection is an optional authorized override.
- No upstream issue/KEP number assigned, review approval recorded, or production
  implementation started.

## Source evidence and implementation change map

[source-investigation.md](source-investigation.md) records verified lifecycle
behavior, independent Kubernetes clients, the A-L change map, and prototype
starting points with source links pinned to the investigated commit.
