// Copyright 2026 The Kubeflow Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0

import { describe, expect, it } from 'vitest';
import { V2beta1Run, V2beta1RuntimeState } from '../src/apisv2beta1/run';
import { sampleRunPipelineSpec, sampleRunTasks } from '../mock-backend/sample-run-tasks';
import { getRunTaskTiming } from '../src/lib/v2/RunTaskTiming';

const samples: V2beta1Run[] = Object.values(V2beta1RuntimeState)
  .filter((state) =>
    ['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'CANCELING', 'PENDING'].includes(state),
  )
  .map((state) => ({
    run_id: `sample-run-${state.toLowerCase()}`,
    display_name: state,
    state,
    created_at: new Date('2026-01-01T00:00:00Z'),
    finished_at: ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(state)
      ? new Date('2026-01-01T00:12:00Z')
      : undefined,
  }));
describe('review sample timelines', () => {
  it.each(samples)('$display_name has consistent graph nodes, states and timestamps', (run) => {
    const tasks = sampleRunTasks(run);
    if (run.state === 'PENDING') {
      expect(tasks).toEqual([]);
      return;
    }
    expect(tasks.length).toBeGreaterThan(3);
    expect(new Set(tasks.map((task) => task.task_id)).size).toBe(tasks.length);
    const root = tasks.find((task) => task.type === 'ROOT')!;
    const children = tasks.filter((task) => task.type === 'RUNTIME');
    for (const task of children) {
      expect(task.run_id).toBe(run.run_id);
      expect(task.parent_task_id).toBe(root.task_id);
      expect(sampleRunPipelineSpec.root.dag.tasks).toHaveProperty(task.name!);
      expect(task.scope_path).toBe(`root.${task.name}`);
      expect(task.create_time!.getTime()).toBeGreaterThanOrEqual(run.created_at!.getTime());
      if (task.end_time) {
        expect(task.end_time.getTime()).toBeGreaterThanOrEqual(task.create_time!.getTime());
        if (run.finished_at)
          expect(task.end_time.getTime()).toBeLessThanOrEqual(run.finished_at.getTime());
      }
    }
    const training = children.find((task) => task.name === 'train-model')!;
    const validation = children.find((task) => task.name === 'validate-data')!;
    expect(training.create_time).toEqual(validation.create_time);
    if (run.state === 'RUNNING' || run.state === 'CANCELING') {
      expect(training.state).toBe('RUNNING');
      expect(training.end_time).toBeUndefined();
      expect(children.some((task) => task.name === 'evaluate-model')).toBe(false);
    } else if (run.state === 'SUCCEEDED') {
      expect(children.every((task) => task.state === 'SUCCEEDED')).toBe(true);
      const evaluation = children.find((task) => task.name === 'evaluate-model')!;
      expect(evaluation.create_time!.getTime()).toBeGreaterThan(training.end_time!.getTime());
    } else {
      expect(training.state).toBe('FAILED');
      expect(training.state_history?.at(-1)?.error?.code).toBe(run.state === 'CANCELED' ? 1 : 3);
      expect(children.find((task) => task.name === 'evaluate-model')?.state).toBe('SKIPPED');
    }
    const timing = getRunTaskTiming(run, tasks, Date.now());
    expect(timing.rows).toHaveLength(children.length);
    expect(timing.rows.every((row) => row.elapsed !== undefined && row.elapsed >= 0)).toBe(true);
  });
  it('does not invent tasks for other runs', () => {
    expect(sampleRunTasks({ run_id: 'unknown' })).toEqual([]);
  });
});
