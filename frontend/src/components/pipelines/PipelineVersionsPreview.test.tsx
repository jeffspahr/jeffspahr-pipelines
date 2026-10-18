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
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Apis } from 'src/lib/Apis';
import { CommonTestWrapper } from 'src/TestWrapper';
import { PipelineVersionsPreview } from './PipelineVersionsPreview';

afterEach(() => vi.restoreAllMocks());

it('shows only five recent versions with detail links and no management controls', async () => {
  const list = vi.spyOn(Apis.pipelineServiceApiV2, 'listPipelineVersions').mockResolvedValue({
    pipeline_versions: Array.from({ length: 7 }, (_, index) => ({
      pipeline_version_id: `version/${index}`,
      display_name: `Revision ${index}`,
      created_at: '2026-01-01T00:00:00Z',
    })),
  });
  render(<PipelineVersionsPreview pipelineId='pipeline/id' />, { wrapper: CommonTestWrapper });
  expect(await screen.findAllByRole('listitem')).toHaveLength(5);
  expect(list).toHaveBeenCalledWith('pipeline/id', '', 5, 'created_at desc', '');
  expect(screen.getByRole('link', { name: 'Revision 0' })).toHaveAttribute(
    'href',
    '/pipelines/details/pipeline%2Fid/version/version%2F0',
  );
  expect(screen.getByRole('link', { name: 'View all versions' })).toHaveAttribute(
    'href',
    '/pipelines/details/pipeline%2Fid?tab=versions',
  );
  expect(screen.getByRole('link', { name: 'Upload version' })).toHaveAttribute(
    'href',
    '/pipeline_versions/new?pipelineId=pipeline%2Fid',
  );
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByText('Rows per page')).not.toBeInTheDocument();
});

it('ignores responses after the preview is unmounted', async () => {
  let resolve!: (value: { pipeline_versions: [] }) => void;
  vi.spyOn(Apis.pipelineServiceApiV2, 'listPipelineVersions').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<PipelineVersionsPreview pipelineId='pipeline' />, {
    wrapper: CommonTestWrapper,
  });
  view.unmount();
  await act(async () => resolve({ pipeline_versions: [] }));
  expect(screen.queryByRole('region')).not.toBeInTheDocument();
});
