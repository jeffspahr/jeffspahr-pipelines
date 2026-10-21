/*
 * Copyright 2021 The Kubeflow Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Box,
  CircleCheck,
  CircleX,
  LoaderCircle,
  SkipForward,
  Database,
  CircleHelp,
} from 'lucide-react';
import { PipelineTaskTaskState } from 'src/apisv2/run';
import { ExecutionFlowElementData, GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH } from './Constants';
import { ReadOnlyNodeHandles } from './ReadOnlyNodeHandles';
import { getTaskStatus } from 'src/lib/StatusUtils';
import './Graph.css';

export interface ExecutionNodeProps {
  id: string;
  data: ExecutionFlowElementData;
}

export function TaskStateIndicator({ state }: { state?: PipelineTaskTaskState }) {
  if (state === undefined) return null;
  const Icon =
    {
      SUCCEEDED: CircleCheck,
      FAILED: CircleX,
      RUNNING: LoaderCircle,
      SKIPPED: SkipForward,
      CACHED: Database,
      RUNTIME_STATE_UNSPECIFIED: CircleHelp,
    }[state] || CircleHelp;
  return <Icon className='kfp-graph-state-icon' data-state={state} size={12} aria-hidden='true' />;
}

export default function ExecutionNode({ id, data }: ExecutionNodeProps) {
  const status = getTaskStatus(data.state);
  return (
    <>
      <button
        type='button'
        className='kfp-graph-node'
        style={{ width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT }}
        data-tone={status.tone}
        title={data.label}
        aria-label={data.label}
        aria-describedby={`${id}-status`}
      >
        <Box className='kfp-graph-type-icon' size={16} role='img' aria-label='Task' />
        <span className='kfp-graph-node-copy'>
          <span className='kfp-graph-node-name' id={id}>
            {data.label}
          </span>
          <span className='kfp-graph-node-meta' id={`${id}-status`} aria-hidden='true'>
            <TaskStateIndicator state={data.state} />
            {status.label}
          </span>
        </span>
      </button>
      <ReadOnlyNodeHandles />
    </>
  );
}
