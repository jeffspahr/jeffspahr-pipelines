// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

import { render, screen } from '@testing-library/react';
import type { PipelineSpec } from 'src/generated/pipeline_spec';
import { PipelineDefinitionDetails } from './PipelineDefinitionDetails';

it('titles definition sections as level 2 headings below the page title', () => {
  const spec = {
    pipelineInfo: { name: 'inline-pipeline' },
    root: { inputDefinitions: { parameters: { learning_rate: { defaultValue: 0.1 } } } },
  } as unknown as PipelineSpec;
  render(<PipelineDefinitionDetails spec={spec} />);
  expect(screen.getAllByRole('heading').map((heading) => heading.tagName)).toEqual(['H2', 'H2']);
  expect(screen.getByRole('heading', { name: 'Pipeline definition' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Input parameter defaults' })).toBeVisible();
  expect(screen.getByText('0.1')).toBeVisible();
});
