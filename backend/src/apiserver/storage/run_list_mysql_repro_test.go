// Copyright 2018 The Kubeflow Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package storage

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	mysqldriver "github.com/go-sql-driver/mysql"
	api "github.com/kubeflow/pipelines/backend/api/v2beta1/go_client"
	"github.com/kubeflow/pipelines/backend/src/apiserver/filter"
	"github.com/kubeflow/pipelines/backend/src/apiserver/list"
	"github.com/kubeflow/pipelines/backend/src/apiserver/model"
	"github.com/kubeflow/pipelines/backend/src/common/util"
	"github.com/stretchr/testify/require"
)

func TestMySQLRunListLargeManifests(t *testing.T) {
	dbs, d := recurringIntegrationDatabases(t, "mysql")
	db := dbs[0]
	var version string
	var sortBuffer int
	require.NoError(t, db.QueryRow("SELECT VERSION(), @@sort_buffer_size").Scan(&version, &sortBuffer))
	t.Logf("MySQL %s sort_buffer_size=%d", version, sortBuffer)
	store := NewRunStore(db, util.NewFakeTimeForEpoch(), d)
	for _, size := range []int{1024, 100 * 1024, 512 * 1024} {
		t.Run(fmt.Sprintf("manifest_bytes_%d", size), func(t *testing.T) {
			ns := fmt.Sprintf("ns-%d", size)
			jobID := "schedule-" + ns
			_, err := NewJobStore(db, util.NewFakeTimeForEpoch(), nil, d).CreateJob(&model.Job{UUID: jobID, DisplayName: jobID, Namespace: ns, Enabled: true, MaxConcurrency: 1})
			require.NoError(t, err)
			payload := model.LargeText(`{"padding":"` + strings.Repeat("x", size) + `"}`)
			for i := 0; i < 50; i++ {
				_, err := store.CreateRun(&model.Run{UUID: fmt.Sprintf("%d-%03d", size, i), Namespace: ns, RecurringRunId: jobID, StorageState: model.StorageStateAvailable, RunDetails: model.RunDetails{CreatedAtInSec: int64(i + 1), State: model.RuntimeStateSucceeded, WorkflowRuntimeManifest: payload, PipelineRuntimeManifest: payload}})
				require.NoError(t, err)
			}
			f, err := filter.New(&api.Filter{Predicates: []*api.Predicate{{Key: "recurring_run_id", Operation: api.Predicate_EQUALS, Value: &api.Predicate_StringValue{StringValue: jobID}}}})
			require.NoError(t, err)
			opts, err := list.NewOptions(&model.Run{}, 100, "", f)
			require.NoError(t, err)
			ctx := &model.FilterContext{ReferenceKey: &model.ReferenceKey{Type: model.NamespaceResourceType, ID: ns}}
			query, args, err := store.buildSelectRunsQuery(false, opts, ctx)
			require.NoError(t, err)
			rows, queryErr := db.Query(query, args...)
			count := 0
			if queryErr == nil {
				for rows.Next() {
					count++
				}
				queryErr = rows.Err()
				rows.Close()
			}
			var e *mysqldriver.MySQLError
			code := uint16(0)
			if errors.As(queryErr, &e) {
				code = e.Number
			}
			t.Logf("raw rows=%d error=%t mysql_code=%d", count, queryErr != nil, code)
			runs, total, token, listErr := store.ListRuns(ctx, opts)
			t.Logf("ListRuns rows=%d total=%d next=%t error=%t", len(runs), total, token != "", listErr != nil)
			got, err := store.GetRun(fmt.Sprintf("%d-000", size))
			require.NoError(t, err)
			require.Equal(t, len(payload), len(got.WorkflowRuntimeManifest))
			require.NoError(t, listErr)
			require.Equal(t, 50, total)
			require.Len(t, runs, 50)
			require.Empty(t, token)

		})
	}
}
