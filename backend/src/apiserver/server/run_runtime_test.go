// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	wf "github.com/argoproj/argo-workflows/v4/pkg/apis/workflow/v1alpha1"
	"github.com/gorilla/mux"
	"github.com/kubeflow/pipelines/backend/src/apiserver/client"
	"github.com/kubeflow/pipelines/backend/src/apiserver/common"
	"github.com/kubeflow/pipelines/backend/src/apiserver/model"
	"github.com/kubeflow/pipelines/backend/src/apiserver/resource"
	"github.com/kubeflow/pipelines/backend/src/common/util"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

func TestWorkflowRuntimeTasks(t *testing.T) {
	workflow := &wf.Workflow{}
	workflow.Spec.Templates = []wf.Template{{Name: "impl", Metadata: wf.Metadata{Annotations: map[string]string{util.AnnotationKeyRuntimeRole: "launcher"}}}}
	workflow.Status.Nodes = wf.Nodes{
		"driver": {ID: "driver", Name: "run.root.component1-driver", TemplateName: "system-container-driver",
			Inputs: &wf.Inputs{Parameters: []wf.Parameter{{Name: "task-name", Value: wf.AnyStringPtr("component1")}}}, Phase: wf.NodeSucceeded},
		"component": {ID: "component", Name: "run.root.component1", BoundaryID: "root", Phase: wf.NodeSucceeded},
		"impl": {ID: "impl", TemplateName: "impl", Type: wf.NodeTypePod, BoundaryID: "component", Phase: wf.NodeSucceeded, Outputs: &wf.Outputs{Parameters: []wf.Parameter{
			{Name: "kfp-published-artifacts", Value: wf.AnyStringPtr(`["output_gcs"]`)},
			{Name: "pod-spec-patch", Value: wf.AnyStringPtr("private")},
		}}},
	}
	want := runtimeTask{TaskName: "component1", NodeID: "component", State: model.RuntimeStateSucceeded, OutputArtifactNames: []string{"output_gcs"}}
	require.Equal(t, []runtimeTask{want}, workflowRuntimeTasks(workflow))
	// Older launchers stored the task phase but did not report publications.
	delete(workflow.Status.Nodes, "impl")
	want.OutputArtifactNames = []string{}
	require.Equal(t, []runtimeTask{want}, workflowRuntimeTasks(workflow))
}

func TestReadRunRuntimeRequiresArtifactAccessInSharedReadMode(t *testing.T) {
	viper.Set(common.MultiUserMode, "true")
	defer viper.Set(common.MultiUserMode, "false")
	viper.Set(common.MultiUserModeSharedReadAccess, "true")
	defer viper.Set(common.MultiUserModeSharedReadAccess, "false")
	cm, _, run := initWithOneTimeRun(t)

	s := NewRunArtifactServer(resource.NewResourceManager(cm, &resource.ResourceManagerOptions{}))
	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/", nil), map[string]string{RunKey: run.UUID})
	req.Header.Set(common.GoogleIAPUserIdentityHeader, common.GoogleIAPUserIdentityPrefix+"user@google.com")
	rec := httptest.NewRecorder()
	s.ReadRunRuntime(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	require.JSONEq(t, `{"tasks":[]}`, rec.Body.String())
	cm.SubjectAccessReviewClientFake = client.NewFakeSubjectAccessReviewClientUnauthorized()
	s = NewRunArtifactServer(resource.NewResourceManager(cm, &resource.ResourceManagerOptions{}))
	rec = httptest.NewRecorder()
	s.ReadRunRuntime(rec, req)
	require.Equal(t, http.StatusForbidden, rec.Code)
	require.NotContains(t, rec.Body.String(), "tasks")
}

func TestRuntimePublicationsForCacheAndImporter(t *testing.T) {
	outputs := &wf.Outputs{Parameters: []wf.Parameter{
		{Name: util.PublishedArtifactsParameter, Value: wf.AnyStringPtr(`["dataset"]`)},
		{Name: "cached-decision", Value: wf.AnyStringPtr("true")},
	}}
	workflow := &wf.Workflow{}
	workflow.Status.Nodes = wf.Nodes{
		"import": {ID: "import", DisplayName: "import-data", TemplateName: "system-importer", Outputs: outputs, Phase: wf.NodeSucceeded},
		"driver": {ID: "driver", DisplayName: "produce-driver", Name: "wf.produce-driver", TemplateName: "system-container-driver", Outputs: outputs, Phase: wf.NodeSucceeded,
			Inputs: &wf.Inputs{Parameters: []wf.Parameter{{Name: "task-name", Value: wf.AnyStringPtr("produce")}}}},
		"pod": {ID: "pod", Name: "wf.produce", Phase: wf.NodeSucceeded},
	}
	tasks := workflowRuntimeTasks(workflow)
	require.Len(t, tasks, 2)
	for _, task := range tasks {
		require.Equal(t, []string{"dataset"}, task.OutputArtifactNames)
	}
}

func TestWorkflowRuntimeTasksGlobalRetries(t *testing.T) {
	// Global retries wrap the driver, the executor DAG, and the launcher.
	// The launcher's boundary is the DAG attempt, not the logical task.
	base := "workflow(0).root(0).component1"
	workflow := &wf.Workflow{}
	workflow.Spec.Templates = []wf.Template{{Name: "impl", Metadata: wf.Metadata{Annotations: map[string]string{util.AnnotationKeyRuntimeRole: "launcher"}}}}
	workflow.Status.Nodes = wf.Nodes{
		"driver":       {ID: "driver", Type: wf.NodeTypeRetry, Name: base + "-driver", DisplayName: "component1-driver", Phase: wf.NodeSucceeded, Children: []string{"driver-0"}},
		"driver-0":     {ID: "driver-0", Type: wf.NodeTypePod, Name: base + "-driver(0)", TemplateName: "system-container-driver", Phase: wf.NodeSucceeded, Inputs: &wf.Inputs{Parameters: []wf.Parameter{{Name: "task-name", Value: wf.AnyStringPtr("component1")}}}},
		"executor":     {ID: "executor", Type: wf.NodeTypeRetry, Name: base, DisplayName: "component1", Phase: wf.NodeSucceeded, Children: []string{"executor-0", "executor-1", "hook"}},
		"hook":         {ID: "hook", NodeFlag: &wf.NodeFlag{Hooked: true}},
		"executor-0":   {ID: "executor-0", Name: base + "(0)", Type: wf.NodeTypeDAG, Phase: wf.NodeFailed},
		"executor-1":   {ID: "executor-1", Name: base + "(1)", Type: wf.NodeTypeDAG, Phase: wf.NodeSucceeded},
		"old-launcher": {ID: "old-launcher", BoundaryID: "executor-0", Type: wf.NodeTypePod, TemplateName: "impl", Phase: wf.NodeSucceeded, Outputs: &wf.Outputs{Parameters: []wf.Parameter{{Name: util.PublishedArtifactsParameter, Value: wf.AnyStringPtr(`["obsolete"]`)}}}},
		"launcher":     {ID: "launcher", BoundaryID: "executor-1", Type: wf.NodeTypeRetry, Children: []string{"launcher-0"}, Phase: wf.NodeSucceeded},
		"launcher-0":   {ID: "launcher-0", BoundaryID: "executor-1", Type: wf.NodeTypePod, TemplateName: "impl", Phase: wf.NodeSucceeded, Outputs: &wf.Outputs{Parameters: []wf.Parameter{{Name: util.PublishedArtifactsParameter, Value: wf.AnyStringPtr(`["output_gcs"]`)}}}},
	}
	require.Equal(t, []runtimeTask{{TaskName: "component1", NodeID: "executor", State: model.RuntimeStateSucceeded, OutputArtifactNames: []string{"output_gcs"}}}, workflowRuntimeTasks(workflow))
}
