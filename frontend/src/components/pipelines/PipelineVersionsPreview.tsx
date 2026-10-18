/*
 * Copyright 2018 The Kubeflow Authors
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

import * as React from 'react';
import { Link } from 'react-router';
import { V2beta1PipelineVersion } from 'src/apisv2beta1/pipeline';
import { QUERY_PARAMS, RoutePage, RoutePageFactory } from 'src/components/Router';
import { Apis, PipelineVersionSortKeys } from 'src/lib/Apis';
import { formatDateString } from 'src/lib/Utils';
import '../tables/CollectionPreview.css';
import './PipelineVersionsPreview.css';

export function PipelineVersionsPreview({ pipelineId }: { pipelineId: string }): React.JSX.Element {
  const [versions, setVersions] = React.useState<V2beta1PipelineVersion[]>([]);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = React.useState(0);

  // Synchronize the preview with the pipeline API; ignore responses after collapse/unmount.
  React.useEffect(() => {
    let active = true;
    Apis.pipelineServiceApiV2
      .listPipelineVersions(pipelineId, '', 5, `${PipelineVersionSortKeys.CREATED_AT} desc`, '')
      .then((response) => {
        if (!active) return;
        setVersions((response.pipeline_versions || []).slice(0, 5));
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [pipelineId, attempt]);

  const uploadSearch = new URLSearchParams({ [QUERY_PARAMS.pipelineId]: pipelineId });
  return (
    <section
      className='kfp-collection-preview kfp-version-preview'
      aria-label='Recent pipeline versions'
    >
      <div className='kfp-collection-preview-heading'>
        <span>Recent versions</span>
        <div className='kfp-version-preview-actions'>
          <Link to={`${RoutePageFactory.pipelineDetails(pipelineId)}?tab=versions`}>
            View all versions
          </Link>
          <Link to={`${RoutePage.NEW_PIPELINE_VERSION}?${uploadSearch}`}>Upload version</Link>
        </div>
      </div>
      {status === 'loading' && <p role='status'>Loading versions…</p>}
      {status === 'error' && (
        <p role='alert'>
          Unable to load versions.{' '}
          <button
            type='button'
            onClick={() => {
              setStatus('loading');
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </p>
      )}
      {status === 'ready' && versions.length === 0 && <p>No versions yet.</p>}
      {status === 'ready' && versions.length > 0 && (
        <ul>
          {versions.map((version) => (
            <li key={version.pipeline_version_id}>
              <Link
                to={RoutePageFactory.pipelineVersionDetails(
                  pipelineId,
                  version.pipeline_version_id!,
                )}
              >
                {version.display_name || version.name || version.pipeline_version_id}
              </Link>
              <span title='Uploaded on'>{formatDateString(version.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
