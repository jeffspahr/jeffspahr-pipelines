// Copyright 2026 The Kubeflow Authors
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0

import fs from 'fs';
import YAML from 'yaml';
import { V2beta1Experiment } from '../src/apisv2beta1/experiment';
import { V2beta1Pipeline, V2beta1PipelineVersion } from '../src/apisv2beta1/pipeline';
import { V2beta1Run, V2beta1RuntimeState } from '../src/apisv2beta1/run';
import { V2beta1RecurringRun } from '../src/apisv2beta1/recurringrun';

const examples = [
  [
    '8fbe3bd6-a01f-11e8-98d0-529269fb1460',
    'Python two steps',
    'lightweight_python_functions_v2_pipeline.json',
  ],
  [
    '8fbe3bd6-a01f-11e8-98d0-529269fb1461',
    'Loops and conditions',
    'pipeline_with_loops_and_conditions.yaml',
  ],
  ['8fbe3bd6-a01f-11e8-98d0-529269fb1462', 'XGBoost', 'xgboost_sample_pipeline.yaml'],
  [
    '8fbe3bd6-a01f-11e8-98d0-529269fb2222',
    'Various IO types',
    'pipeline_with_various_io_types.yaml',
  ],
];
const pipelines: V2beta1Pipeline[] = examples.map(([id, name]) => ({
  pipeline_id: id,
  name,
  display_name: name,
  created_at: new Date('2026-01-01'),
}));
const versions: V2beta1PipelineVersion[] = examples.map(([id, , file]) => ({
  pipeline_id: id,
  pipeline_version_id: id,
  display_name: 'default version',
  created_at: new Date('2026-01-01'),
  pipeline_spec: YAML.parse(
    fs.readFileSync(new URL(`./data/v2/pipeline/${file}`, import.meta.url), 'utf8'),
  ),
}));
versions.push({
  pipeline_id: examples[0][0],
  pipeline_version_id: '9fbe3bd6-a01f-11e8-98d0-529269fb1460',
  display_name: 'revision',
  created_at: new Date('2026-02-01'),
  pipeline_spec: YAML.parse(
    fs.readFileSync(
      new URL(
        './data/v2/pipeline/lightweight_python_functions_v2_pipeline_rev.yaml',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
});
const experiments: V2beta1Experiment[] = [
  {
    experiment_id: '275ea11d-ac63-4ce3-bc33-ec81981ed56b',
    display_name: 'Default',
    storage_state: 'AVAILABLE',
  },
  {
    experiment_id: '275ea11d-ac63-4ce3-bc33-ec81981ed56a',
    display_name: 'Recurring',
    storage_state: 'AVAILABLE',
  },
  { experiment_id: 'empty-experiment', display_name: 'No runs', storage_state: 'AVAILABLE' },
  { experiment_id: 'archived-experiment', display_name: 'Archived', storage_state: 'ARCHIVED' },
];
const runs: V2beta1Run[] = examples.map(([, name], i) => ({
  run_id: i === 2 ? 'e0115ac1-0479-4194-a22d-01e65e09a32b' : `mock-run-${i}`,
  display_name: i === 2 ? 'v2-xgboost-ilbo' : name,
  pipeline_spec: versions[i].pipeline_spec,
  experiment_id: experiments[0].experiment_id,
  created_at: new Date('2026-01-01T00:00:00Z'),
  finished_at: new Date('2026-01-01T00:03:00Z'),
  state: 'SUCCEEDED',
  storage_state: 'AVAILABLE',
}));
const recurringRuns: V2beta1RecurringRun[] = [0, 1].map((i) => ({
  recurring_run_id: `mock-recurring-${i}`,
  created_at: new Date('2026-01-01T00:00:00Z'),
  display_name: `Scheduled ${examples[i][1]}`,
  experiment_id: experiments[1].experiment_id,
  pipeline_spec: versions[i].pipeline_spec,
  status: 'ENABLED',
  trigger: { periodic_schedule: { interval_second: '3600' } },
}));
const sampleRuns: {
  id: string;
  name: string;
  state: V2beta1RuntimeState;
  daysAgo: number;
  archived?: boolean;
}[] = [
  { id: 'training-running', name: 'Taxi fare training', state: 'RUNNING', daysAgo: 0 },
  { id: 'validation-pending', name: 'Validation queued', state: 'PENDING', daysAgo: 0 },
  { id: 'daily-success', name: 'Daily taxi data refresh', state: 'SUCCEEDED', daysAgo: 1 },
  { id: 'training-failed', name: 'Training with invalid features', state: 'FAILED', daysAgo: 2 },
  { id: 'sweep-canceled', name: 'Hyperparameter sweep', state: 'CANCELED', daysAgo: 4 },
  { id: 'refresh-canceling', name: 'Superseded data refresh', state: 'CANCELING', daysAgo: 0 },
  { id: 'weekly-success', name: 'Weekly model evaluation', state: 'SUCCEEDED', daysAgo: 6 },
  { id: 'import-failed', name: 'Dataset import retry', state: 'FAILED', daysAgo: 12 },
  { id: 'monthly-success', name: 'Monthly baseline comparison', state: 'SUCCEEDED', daysAgo: 24 },
  { id: 'backfill-canceled', name: 'Historical taxi backfill', state: 'CANCELED', daysAgo: 45 },
  { id: 'evaluation-failed', name: 'Previous model evaluation', state: 'FAILED', daysAgo: 75 },
  { id: 'baseline-success', name: 'Original fare baseline', state: 'SUCCEEDED', daysAgo: 120 },
  {
    id: 'archived-success',
    name: 'Archived weekly training',
    state: 'SUCCEEDED',
    daysAgo: 3,
    archived: true,
  },
  {
    id: 'archived-failed',
    name: 'Archived import failure',
    state: 'FAILED',
    daysAgo: 40,
    archived: true,
  },
];

// Roll review samples forward daily so the relative-date filters remain useful.
// The original fixed runs above retain their IDs, dates, and task relationships.
function reviewRuns(): V2beta1Run[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return sampleRuns.map((sample, index) => {
    const createdAt = new Date(today.getTime() - sample.daysAgo * 86_400_000 - 3_600_000);
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(sample.state);
    return {
      run_id: `sample-run-${sample.id}`,
      display_name: sample.name,
      experiment_id: experiments[0].experiment_id,
      pipeline_spec: versions[index % examples.length].pipeline_spec,
      created_at: createdAt,
      finished_at: terminal ? new Date(createdAt.getTime() + (index + 1) * 60_000) : undefined,
      state: sample.state,
      storage_state: sample.archived ? 'ARCHIVED' : 'AVAILABLE',
    };
  });
}

export const data = {
  experiments,
  pipelines,
  versions,
  get runs() {
    return [...runs, ...reviewRuns()];
  },
  recurringRuns,
};
