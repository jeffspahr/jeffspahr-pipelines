// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

import type { RunRuntimeTask } from 'src/lib/Apis';
import { Artifact } from 'src/third_party/mlmd';
import type { PipelineFlowElement } from './FlowTypes';
import { getArtifactNodeKey, getTaskNodeKey, isNode } from './StaticFlow';

/** An IR task key is unique only within its enclosing DAG instance. */
export function indexRunRuntimeTasks(tasks: RunRuntimeTask[]) {
  const children = new Map<string, Map<string, RunRuntimeTask | undefined>>();
  for (const task of tasks) {
    const parent = task.parentNodeId || '';
    const siblings = children.get(parent) ?? new Map<string, RunRuntimeTask | undefined>();
    // Loops and retries can report more than one instance. A static graph node
    // cannot identify which instance to show.
    siblings.set(task.taskName, siblings.has(task.taskName) ? undefined : task);
    children.set(parent, siblings);
  }
  return children;
}

export function applyRunRuntime(
  elements: PipelineFlowElement[],
  layers: string[],
  children: ReturnType<typeof indexRunRuntimeTasks>,
): PipelineFlowElement[] {
  let siblings = children.get('');
  for (const layer of layers.slice(1)) {
    const parent = siblings?.get(layer);
    if (!parent) return elements;
    siblings = children.get(parent.nodeId);
  }
  if (!siblings) return elements;
  const states = new Map<
    string,
    { state: RunRuntimeTask['state'] | Artifact.State; reportedTask?: RunRuntimeTask }
  >();
  for (const [name, task] of siblings) {
    if (!task) continue;
    states.set(getTaskNodeKey(name), { state: task.state, reportedTask: task });
    for (const output of task.outputArtifactNames || []) {
      states.set(getArtifactNodeKey(name, output), { state: Artifact.State.LIVE });
    }
  }
  return elements.map((element) => {
    const runtime = states.get(element.id);
    return runtime && isNode(element)
      ? { ...element, data: { ...element.data, ...runtime } }
      : element;
  });
}
