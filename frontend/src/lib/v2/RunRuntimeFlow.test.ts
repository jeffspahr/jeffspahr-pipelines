// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

import { V2beta1RuntimeState as State } from 'src/apisv2beta1/run';
import type { RunRuntimeTask } from 'src/lib/Apis';
import type { PipelineFlowElement } from './FlowTypes';
import { applyRunRuntime, indexRunRuntimeTasks } from './RunRuntimeFlow';

const read: PipelineFlowElement = {
  id: 'task.read',
  data: { label: 'read' },
  position: { x: 0, y: 0 },
};

function task(
  nodeId: string,
  taskName: string,
  state: State,
  parentNodeId?: string,
): RunRuntimeTask {
  return { nodeId, taskName, state, parentNodeId, outputArtifactNames: [] };
}

it('matches repeated IR task keys within the selected DAG and leaves ambiguous iterations unresolved', () => {
  const tasks = indexRunRuntimeTasks([
    task('group-1', 'first', State.SUCCEEDED),
    task('group-2', 'second', State.RUNNING),
    task('read-1', 'read', State.SUCCEEDED, 'group-1'),
    task('read-2', 'read', State.RUNNING, 'group-2'),
    task('read-3', 'read', State.FAILED, 'group-2'),
  ]);
  expect(applyRunRuntime([read], ['root', 'first'], tasks)[0].data?.state).toBe(State.SUCCEEDED);
  expect(applyRunRuntime([read], ['root', 'second'], tasks)[0]).toBe(read);
  expect(applyRunRuntime([read], ['root', 'missing'], tasks)[0]).toBe(read);
  expect(applyRunRuntime([read], ['root'], tasks)[0]).toBe(read);
});
