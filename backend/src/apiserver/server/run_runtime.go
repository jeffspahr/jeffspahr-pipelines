// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"encoding/json"
	"net/http"
	"slices"
	"sort"
	"strings"

	wf "github.com/argoproj/argo-workflows/v4/pkg/apis/workflow/v1alpha1"
	"github.com/gorilla/mux"
	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"github.com/kubeflow/pipelines/backend/src/apiserver/common"
	"github.com/kubeflow/pipelines/backend/src/apiserver/model"
	"github.com/kubeflow/pipelines/backend/src/common/util"
	authorizationv1 "k8s.io/api/authorization/v1"
)

type runtimeTask struct {
	TaskName            string             `json:"taskName"`
	NodeID              string             `json:"nodeId"`
	ParentNodeID        string             `json:"parentNodeId,omitempty"`
	State               model.RuntimeState `json:"state"`
	OutputArtifactNames []string           `json:"outputArtifactNames"`
}

func (s *RunArtifactServer) ReadRunRuntime(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	runID := mux.Vars(r)[RunKey]
	// Shared read mode may allow cluster-wide run GETs. Runtime publication
	// evidence requires a namespace-scoped artifact read permission.
	ctx := httpRequestContext(r)
	attrs := &authorizationv1.ResourceAttributes{Verb: common.RbacResourceVerbGet}
	err := s.canAccessRun(ctx, runID, attrs)
	if err == nil {
		// canAccessRun resolves the authoritative namespace and resource name.
		attrs.Verb = common.RbacResourceVerbReadArtifact
		err = s.resourceManager.IsAuthorized(ctx, attrs)
	}
	if err != nil {
		code := runtime.HTTPStatusFromCode(util.ToGRPCStatus(err).Code())
		http.Error(w, http.StatusText(code), code)
		return
	}
	run, err := s.resourceManager.GetRun(runID)
	if err != nil {
		code := runtime.HTTPStatusFromCode(util.ToGRPCStatus(err).Code())
		http.Error(w, http.StatusText(code), code)
		return
	}
	tasks := []runtimeTask{}
	if run.WorkflowRuntimeManifest != "" {
		workflow, err := util.NewWorkflowFromBytesJSON([]byte(run.WorkflowRuntimeManifest))
		if err != nil || workflow.Decompress() != nil {
			http.Error(w, "Cannot read recorded workflow status", http.StatusInternalServerError)
			return
		}
		if workflow.Status.IsOffloadNodeStatus() && len(workflow.Status.Nodes) == 0 {
			http.Error(w, "Run task status is stored in the Argo offload database", http.StatusNotImplemented)
			return
		}
		tasks = workflowRuntimeTasks(workflow.Workflow)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Tasks []runtimeTask `json:"tasks"`
	}{tasks})
}

// Each KFP driver carries the IR task name. Its sibling DAG carries the overall
// executor state, and the launcher pod inside that DAG carries publication receipts.
func workflowRuntimeTasks(workflow *wf.Workflow) []runtimeTask {
	nodes := logicalRuntimeNodes(workflow.Status.Nodes)
	byName := make(map[string]wf.NodeStatus, len(nodes))
	for _, node := range nodes {
		byName[node.Name] = node
	}
	tasks := make(map[string]*runtimeTask)
	for _, driver := range nodes {
		if driver.TemplateName == "system-importer" || driver.TemplateName == "system-importer-workspace" {
			tasks[driver.ID] = &runtimeTask{TaskName: driver.DisplayName, NodeID: driver.ID, ParentNodeID: driver.BoundaryID,
				State: model.RuntimeState(driver.Phase).ToV2(), OutputArtifactNames: liveOutputs(driver)}
			continue
		}
		if (driver.TemplateName != "system-container-driver" && driver.TemplateName != "system-dag-driver") || driver.Inputs == nil {
			continue
		}
		name := driver.Inputs.GetParameterByName("task-name")
		if name == nil || name.Value == nil || name.Value.String() == "" {
			continue
		}
		node := driver
		state := model.RuntimeState(driver.Phase).ToV2()
		if sibling, ok := byName[strings.TrimSuffix(driver.Name, "-driver")]; ok && sibling.ID != driver.ID && driver.DisplayName != name.Value.String() {
			node = sibling
			if driver.Phase != wf.NodeFailed && driver.Phase != wf.NodeError {
				state = model.RuntimeState(node.Phase).ToV2()
				if node.Phase == wf.NodeOmitted {
					state = model.RuntimeStateSkipped
				}
			}
		} else if strings.HasSuffix(driver.Name, "-driver") && driver.Phase == wf.NodeSucceeded && driver.DisplayName != name.Value.String() {
			// The executor has not appeared in this snapshot yet.
			state = model.RuntimeStatePending
		}
		task := &runtimeTask{TaskName: name.Value.String(), NodeID: node.ID, ParentNodeID: node.BoundaryID, State: state, OutputArtifactNames: []string{}}
		if driver.TemplateName == "system-container-driver" && driver.Outputs != nil {
			if outputValue(driver.Outputs, "cached-decision") == "true" {
				task.OutputArtifactNames = liveOutputs(driver)
			}
		}
		tasks[node.ID] = task
	}
	launchers := map[string]bool{}
	for _, template := range workflow.Spec.Templates {
		launchers[template.Name] = template.Metadata.Annotations[util.AnnotationKeyRuntimeRole] == string(util.ExecutionRuntimeRoleLauncher)
	}
	for _, node := range nodes {
		if node.Type != wf.NodeTypePod || node.Phase != wf.NodeSucceeded || !launchers[node.TemplateName] || node.Outputs == nil {
			continue
		}
		task := tasks[node.BoundaryID]
		if task == nil {
			continue
		}
		task.OutputArtifactNames = append(task.OutputArtifactNames, liveOutputs(node)...)
	}
	result := make([]runtimeTask, 0, len(tasks))
	for _, task := range tasks {
		// Generated root and iteration wrappers need not correspond to an IR task.
		for parent, hops := task.ParentNodeID, 0; tasks[parent] == nil && parent != ""; hops++ {
			if hops >= len(nodes) {
				task.ParentNodeID = ""
				break
			}
			parent = nodes[parent].BoundaryID
			task.ParentNodeID = parent
		}
		sort.Strings(task.OutputArtifactNames)
		task.OutputArtifactNames = slices.Compact(task.OutputArtifactNames)
		result = append(result, *task)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].NodeID < result[j].NodeID })
	return result
}

// Argo records the retry wrapper and each concrete attempt separately. Use
// the wrapper's logical identity and the latest attempt's resolved inputs and
// outputs. A nested launcher points to the concrete executor DAG as its boundary.
func logicalRuntimeNodes(nodes wf.Nodes) wf.Nodes {
	logicalID := map[string]string{}
	replaced := map[string]bool{}
	discarded := map[string]bool{}
	boundaryChildren := map[string][]string{}
	for id, node := range nodes {
		boundaryChildren[node.BoundaryID] = append(boundaryChildren[node.BoundaryID], id)
		if node.Type != wf.NodeTypeRetry {
			continue
		}
		latest := ""
		for _, childID := range node.Children {
			child, ok := nodes[childID]
			if ok && child.NodeFlag != nil && child.NodeFlag.Hooked {
				continue
			}
			if latest != "" {
				discarded[latest] = true
			}
			latest = ""
			if ok {
				latest = childID
			}
		}
		if latest != "" {
			logicalID[latest] = id
			replaced[id] = true
		}
	}
	// Child tasks of an abandoned DAG attempt must not contribute states or
	// publications to the final attempt.
	var pending []string
	for id := range discarded {
		pending = append(pending, id)
	}
	for len(pending) > 0 {
		id := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for _, child := range boundaryChildren[id] {
			if !discarded[child] {
				discarded[child] = true
				pending = append(pending, child)
			}
		}
	}
	result := make(wf.Nodes, len(nodes))
	for id, node := range nodes {
		if discarded[id] || replaced[id] {
			continue
		}
		if wrapperID, ok := logicalID[id]; ok {
			wrapper := nodes[wrapperID]
			node.ID, node.Name, node.DisplayName = wrapper.ID, wrapper.Name, wrapper.DisplayName
			if node.Phase != wf.NodeSucceeded {
				node.Outputs = nil
			}
			node.Phase = wrapper.Phase
		}
		if boundaryID, ok := logicalID[node.BoundaryID]; ok {
			node.BoundaryID = boundaryID
		}
		result[node.ID] = node
	}
	return result
}

func liveOutputs(node wf.NodeStatus) []string {
	names := []string{}
	if node.Phase != wf.NodeSucceeded || node.Outputs == nil {
		return names
	}
	value := outputValue(node.Outputs, util.PublishedArtifactsParameter)
	if value != "" && len(value) <= util.MaxPublishedArtifactNamesBytes {
		var published []string
		if json.Unmarshal([]byte(value), &published) == nil {
			names = append(names, published...)
		}
	}
	return names
}

func outputValue(outputs *wf.Outputs, name string) string {
	for _, p := range outputs.Parameters {
		if p.Name == name && p.Value != nil {
			return p.Value.String()
		}
	}
	return ""
}
