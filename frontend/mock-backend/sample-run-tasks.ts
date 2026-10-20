// Copyright 2026 The Kubeflow Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0

import { complexRunTasks } from './complex-run-samples';
import { PipelineTaskTaskState, V2beta1PipelineTask, V2beta1Run } from '../src/apisv2beta1/run';

const steps = [
  { name: 'prepare-data', label: 'Prepare taxi data', dependencies: [], start: 10, end: 120 },
  {
    name: 'train-model',
    label: 'Train fare model',
    dependencies: ['prepare-data'],
    start: 130,
    end: 540,
  },
  {
    name: 'validate-data',
    label: 'Validate features',
    dependencies: ['prepare-data'],
    start: 130,
    end: 300,
  },
  {
    name: 'evaluate-model',
    label: 'Evaluate model',
    dependencies: ['train-model', 'validate-data'],
    start: 550,
    end: 710,
  },
];

// Use one definition for the graph and its runtime tasks so task links resolve.
export const sampleRunPipelineSpec = {
  pipelineInfo: {
    name: 'taxi-fare-training',
    description: 'Synthetic taxi training workflow with parallel training and validation.',
  },
  schemaVersion: '2.1.0',
  sdkVersion: 'kfp-2.0.0',
  root: {
    dag: {
      tasks: Object.fromEntries(
        steps.map((step) => [
          step.name,
          {
            taskInfo: { name: step.name },
            componentRef: { name: `comp-${step.name}` },
            dependentTasks: step.dependencies,
          },
        ]),
      ),
    },
  },
  components: Object.fromEntries(
    steps.map((step) => [`comp-${step.name}`, { executorLabel: `exec-${step.name}` }]),
  ),
  deploymentSpec: {
    executors: Object.fromEntries(
      steps.map((step) => [
        `exec-${step.name}`,
        {
          container: {
            image: 'python:3.11-slim',
            command: ['python', '-c'],
            args: [`print("${step.label}")`],
          },
        },
      ]),
    ),
  },
};

export function sampleRunTasks(run: V2beta1Run): V2beta1PipelineTask[] {
  const complex = complexRunTasks(run);
  if (complex) return complex;
  if (!run.run_id?.startsWith('sample-run-') || run.state === 'PENDING') return [];
  const origin = run.created_at!.getTime();
  const at = (seconds: number) => new Date(origin + seconds * 1000);
  const active = run.state === 'RUNNING' || run.state === 'CANCELING';
  const interrupted = run.state === 'FAILED' || run.state === 'CANCELED';
  const rootId = `${run.run_id}-root`;
  const rootState = active ? 'RUNNING' : interrupted ? 'FAILED' : 'SUCCEEDED';
  const tasks: V2beta1PipelineTask[] = [
    {
      run_id: run.run_id,
      task_id: rootId,
      name: 'root',
      display_name: 'Taxi fare training',
      scope_path: 'root',
      type: 'ROOT',
      state: rootState,
      create_time: run.created_at,
      end_time: run.finished_at,
    },
  ];
  for (const [index, step] of steps.entries()) {
    // Tasks have no CANCELED enum: an interrupted executor reports FAILED with
    // a cancellation error, while components that never ran report SKIPPED.
    const state: PipelineTaskTaskState =
      index === 1
        ? active
          ? 'RUNNING'
          : interrupted
            ? 'FAILED'
            : 'SUCCEEDED'
        : index === 3 && (active || interrupted)
          ? 'SKIPPED'
          : 'SUCCEEDED';
    // A downstream task is not created until its dependencies settle.
    if (index === 3 && active) continue;
    const skipped = state === 'SKIPPED';
    const created = skipped ? at(540) : at(step.start);
    const ended = state === 'RUNNING' ? undefined : skipped ? created : at(step.end);
    const taskId = `${run.run_id}-${step.name}`;
    tasks.push({
      run_id: run.run_id,
      task_id: taskId,
      parent_task_id: rootId,
      name: step.name,
      display_name: step.label,
      scope_path: `root.${step.name}`,
      type: 'RUNTIME',
      state,
      create_time: created,
      end_time: ended,
      ...(!skipped
        ? {
            status_metadata: {
              custom_properties: {
                // OpenAPI models protobuf Value as object; its JSON representation is scalar.
                driver_logs_uri:
                  `s3://mlpipeline/review-driver-logs/${taskId}` as unknown as object,
              },
            },
          }
        : {}),
      state_history: [
        ...(!skipped ? [{ state: 'RUNNING' as const, update_time: created }] : []),
        ...(ended
          ? [
              {
                state,
                update_time: ended,
                ...(state === 'FAILED'
                  ? {
                      error: {
                        code: run.state === 'CANCELED' ? 1 : 3,
                        message:
                          run.state === 'CANCELED'
                            ? 'Execution stopped after the run was canceled.'
                            : 'Training data contains invalid feature values.',
                      },
                    }
                  : {}),
              },
            ]
          : []),
      ],
      pods: skipped ? [] : [{ name: `${taskId}-executor`, uid: `${taskId}-pod`, type: 'EXECUTOR' }],
    });
  }
  return tasks;
}

// Verbatim INFO message templates from backend/src/v2/driver/container.go.
// These fixtures model cache-disabled driver setup, not component execution:
// a component may fail later even though its driver completed successfully.
export function sampleDriverLogs(task: V2beta1PipelineTask, namespace: string): string {
  const time = task.create_time!.toISOString();
  return [
    `time="${time}" level=info msg="Cache disabled globally at the server level."`,
    `time="${time}" level=info msg="Creating task ${task.name} in pod ${namespace}"`,
    '',
  ].join('\n');
}
