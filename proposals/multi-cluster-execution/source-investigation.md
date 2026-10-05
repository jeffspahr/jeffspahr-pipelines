# Source investigation and implementation change map

This appendix distinguishes **verified behavior** from **proposed changes**. The
primary source snapshot is upstream master at
`cfdb6b0a0f56bf140b5b67d5572f562d6317d945`. Links below are immutable permalinks,
not claims about a moving master. The draft was prepared against the user's updated
fork master, `e3c93651a44fa718ab079010bb332318854e0491`; [S12](#s12-updated-fork-base)
records relevant changes inspected between those snapshots. Neither snapshot has
a first-class execution cluster on Run. This is a source analysis, not a tested
multi-cluster implementation or an exhaustive inventory of test-only clients.

## S1 Client construction and routing

**Verified.** [ExecutionClient](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/common/util/execution_client.go#L35)
selects `Execution(namespace)`, with CRUD/list/patch operations in
`ExecutionInterface` at line 65. It abstracts an execution engine, not a cluster.
[NewExecutionClientOrFatal](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/common/util/execution_client.go#L82) and
[NewExecutionInformerOrFatal](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/common/util/execution_client.go#L110)
construct clients using [GetKubernetesConfig](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/common/util/service.go#L64):
in-cluster configuration first, then a kubeconfig fallback. An informer constructs
its own client rather than receiving an already selected target bundle.

[ClientManager initialization](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/client_manager/client_manager.go#L238)
constructs separate execution, ScheduledWorkflow, core Kubernetes and authorization
clients (around lines 341–364). [getWorkflowClient](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L333)
selects only a namespace on that shared execution client.
[KubernetesCoreInterface](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/client/kubernetes_core.go#L11)
exposes pods and the broader clientset; its constructor at line 48 uses the
[API server configuration helper](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/client/util.go#L25).
[ScheduledWorkflow client construction](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/client/swf.go#L42) and
[Argo client construction](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/client/argo.go#L43) are independent
factories, including kubeconfig support. Controller-runtime clients used for
central pipeline catalog storage are another client family.

**Required change.** A target registry must construct a bundle from an explicit
`rest.Config`: Workflow, core, discovery, authorization and schedule clients plus
informers. `executionClient.ForCluster(id)` could route Workflow CRUD, but would
not cover pods, TokenReview, secrets, schedules, UI clients or runtime helpers.
Keep central catalog clients and local runtime clients explicit rather than
silently routing every Kubernetes access to the Run target.

## S2 Persistence

**Verified.** [Run](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/model/run.go#L192) has namespace,
Kubernetes name and logical UUID; saved execution manifests carry further
Kubernetes identity. [Job](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/model/job.go#L73) also persists
namespace and Kubernetes identity. [Task](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/model/task.go#L133)
references RunUUID and holds namespace, pod and cache-related state.
[Artifact](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/model/artifact.go#L23) contains namespace, URI and
identity key; [ArtifactTask](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/model/artifact_task.go#L31)
links artifacts to tasks. None supplies a general execution-target identity.

SQL changes must cover [Run columns](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L32),
[Run scanning](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L638),
[CreateRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L792),
[DeleteRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L1229) and retry state, plus
[Job persistence](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/job_store.go#L364). Migration entry
points include [autoMigrate](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/client_manager/client_manager.go#L776)
and [AllModels](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/model/common.go#L76). See S12 for the newer
recurring claim table.

**Required change.** Persist immutable target on Runs and Jobs; add a registry
identity/lifecycle record and durable operation/tombstone state. Task location
can derive from Run; denormalization is justified only for queries and must be
consistent. Artifact storage provenance is separate from execution location:
shared artifacts may be consumed by many clusters. ArtifactTask, experiments and
central catalog objects do not all need independently mutable cluster columns.
Use additive migrations, an immutable legacy-cluster mapping for null rows,
indexes scoped by target where Kubernetes identity is queried, and a controlled
rollout before any remote submission is accepted.

## S3 Public Run API

**Verified.** [Run protobuf](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/api/v2beta1/run.proto#L204) and
[RecurringRun protobuf](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/api/v2beta1/recurring_run.proto#L81) contain no
execution target. [base CreateRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/server/run_server.go#L111)
resolves namespace/experiment and authorizes; the public handler is around line
265. [toModelRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/server/api_converter.go#L592) and
[toApiRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/server/api_converter.go#L752) translate persistence;
Job conversion is around line 938.
[getNamespaceFromRunId](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L3701),
`ReplaceNamespace` at 3743 and `GetValidExperimentNamespacePair` at 3777 couple
central ownership to namespace handling.

**Required change.** Add optional execution target fields to v2 requests/responses
and recurring-run representations; regenerate Go, OpenAPI and Python clients.
Resolve omitted targets with administrator-defined static policy (the existing
default for single-cluster installs), return resolved identity/provenance, reject target mutation,
and distinguish tenant authorization from placement authorization. Older clients
may omit fields; old backend binaries are not safe writers after remote runs
exist. If v1beta1 remains enabled, its conversion path must pin legacy submissions
and reject unsupported mutations rather than lose remote identity.

## S4 Run lifecycle and failure ordering

The following is **verified at the primary snapshot**. All ResourceManager links
are in `backend/src/apiserver/resource/resource_manager.go`. Kubernetes clients
come from S1 unless stated otherwise. A missing cluster ID cannot be recovered
from namespace/name when multiple clusters contain those names.

| Stage | Source and current behavior | Available identity / proposed change |
| --- | --- | --- |
| Submit | [CreateRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L736) prepares execution, creates Workflow, then writes Run | Request/compiled namespace, generated Run ID, returned Workflow name/UID; persist target and submission intent before dispatch, reconcile ambiguous outcomes |
| Get/List | [GetRunWithHydration](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L981) and List at 997 hydrate database state | Run identity and saved manifests; expose target/freshness, keep historical reads available during target outage; auth may still use Kubernetes |
| Archive | [ArchiveRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1006) and Unarchive at 1017 change storage state | Logical Run ID; no execution move or new placement |
| Retry | [RetryRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1229) claims retry state, removes failed pods and updates/recreates execution | Stored namespace/name/manifest and retry generation; target immutable, all core and Workflow calls use same bundle |
| Retry replacement | [updateOrCreateRetryWorkflow](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1443) and task reset at 1519 | Preserve UID/version/generation fencing across replacement; do not accept old reports |
| Terminate | [TerminateRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1203) records cancellation then [TerminateWorkflow](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1185) patches execution | Stored location; durable target-bound intent and idempotent reconciliation required |
| Delete | [DeleteRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1055) attempts Kubernetes delete, logs Kubernetes failure, then removes database record | Stored namespace/name; retain target and cleanup identity through confirmed deletion, including late creates |
| Live logs | [ReadLog](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1569) / [readPod](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1609) use core pod APIs, validate Run label, stream main container | Run namespace plus pod name; select target from authorized Run and verify pod ownership |
| Archived logs | [ReadArchivedLog](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1648) uses the backend object store | Workflow archive metadata; resolve approved storage profile, not only cluster |

[Pod cleanup helper](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager_util.go#L28)
uses the core client separately from execution-client routing.
[Retry claim storage](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L1295) and
[Cancellation state update](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L1755)
are persistence coordination, not proof a Kubernetes operation has completed.

**Architectural inference.** Cluster routing makes the existing create-before-DB
and delete-after-Kubernetes-error windows more consequential. Durable operation
intent, deterministic execution identity, authenticated UID binding and cleanup
tombstones are needed for safe remote lifecycle behavior. Kubernetes and SQL do
not share a transaction. A lease alone cannot cancel an already in-flight create.
Do not promise exactly-once execution or delete completion merely on HTTP accept.

## S5 Observation reporting and cleanup

**Verified.** [Persistence-agent startup](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/agent/persistence/main.go#L90)
constructs ScheduledWorkflow clients using `BuildConfigFromFlags`; its execution
informer is separately constructed through the utility factory. The
[agent](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/agent/persistence/persistence_agent.go#L51)
runs Workflow/ScheduledWorkflow workers. Its
[work queue](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/agent/persistence/worker/persistence_worker.go#L110)
uses namespace/name keys, split at line 221.
[WorkflowSaver.Save](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/agent/persistence/worker/workflow_saver.go#L45)
reports state and participates in final-state/TTL handling.
[ReportWorkflow](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/agent/persistence/client/pipeline_client.go#L109)
sends a serialized Workflow through the KFP report API.
[Report request](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/api/v2beta1/report.proto#L41) has no trusted cluster
identity. [Report authorization](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/server/report_server.go#L43)
does not introduce a cluster-qualified execution principal.

[reportWorkflowResource](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1961)
loads/updates Run and Task state, can create Run state for direct scheduled
execution, and handles persisted labels/cleanup. Existing protection is material:
[validateLiveWorkflowReportIdentity](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L2583)
reads live execution;
[stored identity validation](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L2653)
checks saved identity;
[deleteLiveWorkflow](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L2746)
uses UID/resource-version preconditions;
[workflowStillMatchesReportedVersion](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L3014)
and [addWorkflowLabelIfWorkflowUnchanged](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L3081)
guard stale observations.

**Required change.** Introduce one observation context per cluster, target-qualified
queue keys and identity checks, independent reconnect/backoff and relists. Bind
reports to the observer's registered target; never trust an arbitrary request
cluster ID. Preserve all existing generation/UID/resource-version checks. The
current persistence agent is an observer/reporter, not an authenticated remote
create/terminate/delete command executor. An agent design requires that protocol.

## S6 Database retention and health

**Verified.** [Run GC leadership lease](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/gc/run_gc.go#L196)
is acquired in the control-plane cluster. Its
[retention loop](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/gc/run_gc.go#L328)
calls database archive/delete functions, including
[ArchiveExpiredRuns](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L1431) and
[DeleteExpiredRuns](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/run_store.go#L1537).
[Health response](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/main.go#L537)
is not a per-target availability contract. Workflow compilation includes TTL
configuration in [compiler options](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/compiler/argocompiler/argo.go#L143).

**Required change.** Keep central leases central. Prevent retention from removing
pending cleanup identity; bound cleanup work by target and preserve tombstones.
Expose target freshness/reachability without marking every Run failed during an
outage. Execution TTL must leave enough time to persist final state; missing
history is not proof of success or failure. Object/PVC retention needs its own
policy, separate from deleting the Workflow and its owned pods.

## S7 Recurring runs

**Verified at the primary snapshot.**
[CreateJob](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L1730) creates a
ScheduledWorkflow before persisting a Job; Job identity comes from its Kubernetes
UID. Enable/disable and delete are around lines 1857 and 1909.
[ReconcileSwfCrs](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L897)
uses the configured pod namespace. The
[controller entry point](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/crd/controller/scheduledworkflow/main.go#L76)
builds core/ScheduledWorkflow clients from flags while execution utilities build
another client. The controller supports
[direct embedded Workflow creation](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/crd/controller/scheduledworkflow/controller.go#L605)
and [API CreateRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/crd/controller/scheduledworkflow/controller.go#L703).
Ownership/concurrency are Kubernetes-local. Updated multi-user scheduling
protections are described in S12.

**Required change.** Persist Job target, propagate it to every tick/Run and route
schedule CRUD, owner lookup, report and startup reconciliation. Do not move
existing schedules when the default ad hoc target changes. Keep owner references
within one cluster. MVP remote scheduling is rejected; legacy schedules continue
on their pinned target. New ad hoc Runs use the proposed static placement policy;
remote schedule placement and dynamic capacity-aware scheduling remain deferred.

## S8 Cache and metadata

**Verified.** The v2
[runtime ClientManager](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/client_manager/client_manager.go#L13)
has Kubernetes and KFP API clients. This path does not use an active runtime MLMD
client. Legacy metadata context fields and optional compiler metadata configuration
remain; this is not a claim that MLMD-related code is absent from the repository.
[Cache fingerprinting](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/driver/cache.go#L39)
includes execution inputs such as PVC names and supports custom keys; lookup uses
namespace. [Cached Task lookup](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/task_store.go#L912)
uses fingerprint/success and namespace conditions, without cluster scope.
[FindCachedTask authorization](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/server/run_server.go#L735)
binds runtime access to Run metadata.
[Artifact identity](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/artifact_store.go#L484)
and [URI lookup](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/storage/artifact_store.go#L722)
use namespace-based boundaries.

**Required change.** Disable remote cache reuse at compilation and server lookup
for MVP. Later scope cache compatibility by target/storage/runtime configuration,
including custom keys: equal PVC names do not mean equal volumes. Keep one central
metadata service and authenticate runtime writes against the persisted target.
For legacy MLMD deployments separately qualify execution/context identity and
service connectivity; do not prescribe an MLMD schema migration as though MLMD
were the current v2 task store. Shared artifacts need storage provenance rather
than a blanket cluster partition that breaks legitimate sharing.

## S9 Authentication and service accounts

**Verified.** [TokenReview authenticator](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/auth/authenticator_token_review.go#L47)
holds a single reviewer and invokes it around line 84.
[canAccessRun](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/server/run_server.go#L830)
binds access to Run identity.
[IsAuthorized](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L3586)
uses a single SubjectAccessReview client. Service-account policy begins around
[service-account authorization](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L3821);
exec checks around line 3983 use Kubernetes authorization too.
[Run token audience](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/compiler/argocompiler/common.go#L57),
[projected token volume](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/compiler/argocompiler/container.go#L280) and
[runtime token reader](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/apiclient/auth.go#L40)
form the runtime-to-KFP authentication path.

**Required change.** Separate central user ownership, target-placement permission
and remote runtime authentication. Choose TokenReview from the stored Run target,
verify Run audience and method scope, and qualify service-account identity by
cluster. Never forward an unqualified remote service-account username to the
central cluster's SAR as though it were a local principal. Credential rotation,
revocation, TLS trust and target draining must preserve immutable identity.

## S10 Runtime configuration storage and plugins

**Verified.** [Runtime client construction](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/client_manager/client_manager.go#L79)
and [getCurrentWorkflowMetadata](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/cmd/driver/main.go#L220)
build local Kubernetes clients independently. This is often correct: driver and
launcher execute in the target cluster.
[LoadLauncherConfig](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/config/env.go#L217)
reads mounted configuration or uses Kubernetes fallback; root construction around
line 284 adds pipeline/run information. Endpoint discovery around line 339 assumes
service naming. [Compiled driver arguments](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/compiler/argocompiler/container.go#L212)
carry API endpoint settings;
[API client construction](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/apiclient/client.go#L69)
uses explicit endpoint configuration. Local service DNS cannot identify a remote
central API without configuration.

[OpenBucket](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/objectstore/object_store.go#L41)
uses target-local secret/config access, including GCS and S3 paths around lines
279 and 389. [Storage defaults](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/objectstore/config.go#L35)
include cluster-local service naming. Driver
[PVC creation](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/driver/k8s.go#L1064),
[PVC deletion](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/driver/k8s.go#L1341) and image secret handling around
line 628 use local core clients. Compiler workspace options are in
[workspace configuration](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/v2/compiler/argocompiler/argo.go#L703).

[Plugin dispatcher](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/plugins/dispatcher.go#L123)
holds configuration/core clients and reads ConfigMaps around line 305.
[MLflow plugin configuration](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/plugins/mlflow/config.go#L238)
resolves settings/secrets (secret lookup around 485), while
[MLflow common configuration](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/common/plugins/mlflow/config.go#L240)
can independently construct a Kubernetes client.
[ReadArtifact](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/apiserver/resource/resource_manager.go#L3357)
uses the backend object store; URI resolution is around 3334.

**Required change.** Supply explicit central API/storage endpoints to remote
runtime pods, install local service accounts/RBAC/config/secrets, and bind a
versioned target configuration at submission. Preserve local PVC operations;
do not route them into the control-plane cluster. Require approved shared storage
for MVP. Disable unsupported remote plugins. Server-side artifact content access
must authorize artifact identity and trusted storage provenance, not accept an
arbitrary user URI as authority to use central credentials.

## S11 Frontend and independent Kubernetes access

**Verified.** [Frontend Kubernetes client](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/frontend/server/k8s-helper.ts#L53)
loads default configuration. The same helper supplies viewers (128), pod logs
(279), pods (305), events (355), Workflows (376) and Secrets (402).
[Pod-log handler](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/frontend/server/handlers/pod-logs.ts#L41) and
[Workflow helper](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/frontend/server/workflow-helper.ts#L112)
therefore bypass the backend's execution abstraction.
[Pod-info handler](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/frontend/server/handlers/pod-info.ts#L26) does likewise.
[Artifact handler](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/frontend/server/handlers/artifacts.ts#L530)
also has Kubernetes secret access around line 1653.
[Server-info discovery](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/frontend/server/helpers/server-info.ts#L17) and
[TensorBoard signing bootstrap](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/frontend/server/initialize-tensorboard-signing-key.ts#L85)
use local Kubernetes independently. The
[Viewer controller](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/crd/controller/viewer/main.go#L60)
builds its own Kubernetes/controller clients.

[SDK endpoint configuration](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/sdk/python/kfp/client/client.py#L307)
uses Kubernetes discovery; submission entry points include `run_pipeline` around
716, recurring runs around 834 and convenience submitters around 1031/1098.
[SDK task configuration](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/sdk/python/kfp/dsl/task_config.py#L43)
has local Kubernetes access. The
[Kubernetes pipeline upload client](https://github.com/kubeflow/pipelines/blob/cfdb6b0a0f56bf140b5b67d5572f562d6317d945/backend/src/common/client/api_server/v2/pipeline_upload_client_kubernetes.go#L112)
uses a separate central catalog client.

**Required change.** Move execution-resource UI access behind authorized KFP
resource-ID APIs; never infer cluster from the frontend pod. Preserve events and
logs where supported, guard unsupported remote viewers, and replace local UI
bootstrap/discovery with explicit configuration separately. Keep submission
transparent; add optional authorized target overrides and resolved-placement
display to UI/SDK without baking a cluster into portable pipeline IR.
Catalog discovery and local development clients are not execution routing.

Related issues have narrower scope: [#10740](https://github.com/kubeflow/pipelines/issues/10740)
requests pod-event visibility; it is a capability to preserve.
[#14046](https://github.com/kubeflow/pipelines/issues/14046) defines artifact-provider
query trust, not multi-cluster orchestration.
[#14031](https://github.com/kubeflow/pipelines/issues/14031) addresses the broader
authorized artifact-content/storage-provenance contract needed by backend artifact
access. None is an existing implementation of this proposal.

## S12 Updated fork base

The following **additional behavior was verified at the updated fork base**,
`e3c93651a44fa718ab079010bb332318854e0491`. These links use that commit. Earlier
sections deliberately retain their original line anchors for reproducibility.

- [RecurringRunState](https://github.com/kubeflow/pipelines/blob/e3c93651a44fa718ab079010bb332318854e0491/backend/src/apiserver/model/recurring_run_state.go#L17)
  adds `recurring_run_states`, keyed by `JobUUID`, containing pending tick/index,
  request key, timestamps and pipeline version. Placement can derive from the
  immutable Job target; a Run-only migration is insufficient.
- [prepareRecurringRunTick](https://github.com/kubeflow/pipelines/blob/e3c93651a44fa718ab079010bb332318854e0491/backend/src/apiserver/resource/recurring_run_tick.go#L40)
  and [claimRecurringRunTick](https://github.com/kubeflow/pipelines/blob/e3c93651a44fa718ab079010bb332318854e0491/backend/src/apiserver/resource/recurring_run_tick.go#L144)
  validate and claim ticks before execution creation.
  [ClaimRecurringRun](https://github.com/kubeflow/pipelines/blob/e3c93651a44fa718ab079010bb332318854e0491/backend/src/apiserver/storage/recurring_run_state.go#L65)
  persists scheduling claims;
  [completeRecurringRunWithInsert](https://github.com/kubeflow/pipelines/blob/e3c93651a44fa718ab079010bb332318854e0491/backend/src/apiserver/storage/recurring_run_state.go#L168)
  completes them with Run insertion transactionally.
- [createRunExecution](https://github.com/kubeflow/pipelines/blob/e3c93651a44fa718ab079010bb332318854e0491/backend/src/apiserver/resource/recurring_run_execution.go#L30)
  assigns deterministic names for recurring Runs, retrieves on AlreadyExists,
  and [sameRecurringRunExecution](https://github.com/kubeflow/pipelines/blob/e3c93651a44fa718ab079010bb332318854e0491/backend/src/apiserver/resource/recurring_run_execution.go#L54)
  validates namespace, service account, schedule owner and Run labels. It still
  selects `getWorkflowClient(namespace)` and does not supply cluster identity.
  These protections must survive routing; ad hoc CreateRun still has the
  Kubernetes-before-Run-insert window.
- The updated ResourceManager enforces API-driven generic scheduling for
  multi-user execution and tightens replay/report authorization. The controller
  still contains direct and API paths, so routing work must not assume one path
  was removed. Preserve API-owned progress rather than introducing an independent
  scheduler in a remote agent.
- Frontend artifact HTTP base/path validation is tighter in this base. It does
  not eliminate frontend Kubernetes clients or establish target provenance.

## Concrete change map

All entries below are **proposed**, with verified starting points cited above.
Generated files and tests must accompany implementation; this draft edits neither.

| Area | Proposed change | Source anchors |
| --- | --- | --- |
| A. Data model / persistence | Run and Job immutable targets; Run placement provenance; registry identity, operations/tombstones; legacy mapping and indexes; claims inherit Job target; artifacts record storage provenance | [S2](#s2-persistence), [S12](#s12-updated-fork-base): Run/Job models, RunStore, JobStore, RecurringRunState, migrations |
| B. Public API / protobuf | Policy resolution for omitted targets, optional authorized overrides, resolved target/provenance, target discovery, target-aware recurring messages; compatibility conversions; authenticated observer protocol if needed | [S3](#s3-public-run-api), [S5](#s5-observation-reporting-and-cleanup): run.proto, recurring_run.proto, report.proto, converters |
| C. Run lifecycle | Static policy resolution before durable submit; durable cancel/delete; target-bound Get/List/logs; identity-safe retries; no deletion of unresolved cleanup identity | [S4](#s4-run-lifecycle-and-failure-ordering): CreateRun, TerminateRun, DeleteRun, RetryRun, ReadLog |
| D. Kubernetes abstraction | Explicit-config target bundles and semantic execution backend, no namespace-only routing; retain central/local clients intentionally | [S1](#s1-client-construction-and-routing): ExecutionClient, ClientManager, getWorkflowClient, core/SWF constructors |
| E. Observation | Per-cluster watches, target-qualified queues, trusted report origin, UID/version/generation validation, bounded reconnects | [S5](#s5-observation-reporting-and-cleanup): persistence agent, WorkflowSaver, report handlers and cleanup guards |
| F. Scheduled runs | Pin Job target, target-bound ticks/claims, route both submission paths, same-cluster ownership; defer remote schedules in MVP | [S7](#s7-recurring-runs), [S12](#s12-updated-fork-base): CreateJob, ReconcileSwfCrs, controller, recurring state |
| G. Cache | Disable remote reuse initially; later explicit target/storage compatibility scope even with custom keys | [S8](#s8-cache-and-metadata): driver/cache.go, FindCachedTask, TaskStore |
| H. Metadata | Central metadata API with target-bound runtime identity; Task derives target, legacy MLMD investigated separately | [S8](#s8-cache-and-metadata), [S9](#s9-authentication-and-service-accounts): runtime ClientManager, Task/Artifact stores, Run authorization |
| I. Artifacts / storage / logs | Explicit shared-storage profile, remote endpoint configuration, backend logs/events/content authorization, local PVC semantics | [S4](#s4-run-lifecycle-and-failure-ordering), [S10](#s10-runtime-configuration-storage-and-plugins), [S11](#s11-frontend-and-independent-kubernetes-access) |
| J. Security | Separate tenant and placement checks, per-target TokenReview, cluster-qualified runtime principals, protected credential refs and RBAC | [S9](#s9-authentication-and-service-accounts): authenticator, IsAuthorized, projected token; [S10](#s10-runtime-configuration-storage-and-plugins): plugin/secret readers |
| K. Deployment | Default standalone cell without fleet dependencies; optional HA serving/database topology, worker partition/takeover and bounded connections/queues with load/failure validation; static target registry and versioned tenant/experiment placement mappings for MVP, remote Argo/RBAC/config installation, explicit central endpoints, per-target health/budgets, retention protections | [S1](#s1-client-construction-and-routing), [S6](#s6-database-retention-and-health), [S10](#s10-runtime-configuration-storage-and-plugins): constructors, GC lease, launcher config |
| L. UI / SDK | Transparent submission, optional authorized override, resolved target/provenance/freshness display, regenerated clients, execution UI through backend, explicit unsupported remote capability guards | [S3](#s3-public-run-api), [S11](#s11-frontend-and-independent-kubernetes-access): protobuf, Python client, frontend helpers/handlers |

Central availability/capacity mitigations are proposed requirements, not verified
HA or throughput guarantees of the current source. See the
[control-plane requirements](README.md#control-plane-availability-and-capacity)
for optional serving/worker redundancy, database failover/recovery, failure
isolation and runtime outage limits. The [cell deployment model](README.md#deployment-profiles-and-cell-boundary)
is a proposed architectural boundary, not an existing source implementation.
Standalone use requires no fleet gateway/registry; provider extensions require
separate routing, ownership and isolation validation. Relevant evidence is the shared clients in S1, observation
and cleanup ordering in S5, central leases/health in S6, and runtime API dependencies
in S8/S10; those paths need load and failure validation before production support.

## Ten prototype starting points

1. [Run persistence and migrations](#s2-persistence): establish durable immutable identity first.
2. [Run protobuf and conversion](#s3-public-run-api): optional selection and resolved responses.
3. [ExecutionClient and ClientManager](#s1-client-construction-and-routing): explicit target bundles.
4. [ResourceManager lifecycle](#s4-run-lifecycle-and-failure-ordering): submit/delete failure ordering.
5. [Persistence reporting and UID guards](#s5-observation-reporting-and-cleanup): target-aware observation.
6. [TokenReview and Run authorization](#s9-authentication-and-service-accounts): secure remote runtime access.
7. [Runtime endpoint/storage configuration](#s10-runtime-configuration-storage-and-plugins): make remote pods operational.
8. [Frontend Kubernetes helper and log handlers](#s11-frontend-and-independent-kubernetes-access): prevent wrong-cluster UI access.
9. [Recurring-run claims and controller paths](#s12-updated-fork-base): preserve legacy scheduling during rollout.
10. [Cache lookup and artifact identity](#s8-cache-and-metadata): close silent cross-cluster reuse boundaries.
