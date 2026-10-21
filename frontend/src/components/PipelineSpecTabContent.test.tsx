/*
 * Copyright 2026 The Kubeflow Authors
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

import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { PipelineSpecTabContent } from './PipelineSpecTabContent';

const editorMock = vi.hoisted(() => ({ useAce: false }));

// Mock Editor to capture the value prop passed to it, unless a test needs Ace's
// own textbox semantics.
vi.mock('./Editor', async (importOriginal) => {
  const { default: AceEditor } = await importOriginal<typeof import('./Editor')>();
  return {
    __esModule: true,
    default: (props: { value: string; mode: string; readOnly: boolean }) =>
      editorMock.useAce ? (
        <AceEditor {...props} />
      ) : (
        <pre data-testid='editor-mock' data-mode={props.mode} data-readonly={props.readOnly}>
          {props.value}
        </pre>
      ),
  };
});

describe('PipelineSpecTabContent', () => {
  afterEach(() => {
    editorMock.useAce = false;
  });

  it('converts JSON template to YAML and passes to editor', async () => {
    const jsonTemplate = JSON.stringify({ key: 'value', nested: { a: 1 } });
    const { findByTestId } = render(<PipelineSpecTabContent templateString={jsonTemplate} />);
    const editor = await findByTestId('editor-mock');
    expect(editor.textContent).toContain('key: value');
    expect(editor.textContent).toContain('nested:');
    expect(editor.textContent).toContain('a: 1');
  });

  it('preserves YAML template format through round-trip', async () => {
    const yamlTemplate = 'key: value\nnested:\n  a: 1\n';
    const { findByTestId } = render(<PipelineSpecTabContent templateString={yamlTemplate} />);
    const editor = await findByTestId('editor-mock');
    expect(editor.textContent).toContain('key: value');
    expect(editor.textContent).toContain('nested:');
  });

  it('renders an empty editor when no template is provided', async () => {
    // js-yaml 5 throws on input holding no document, so an absent template
    // would otherwise fail during render rather than showing an empty editor.
    const { findByTestId } = render(<PipelineSpecTabContent templateString={undefined as any} />);
    expect((await findByTestId('editor-mock')).textContent).toBe('');
  });

  it('renders an empty editor for an empty template string', async () => {
    const { findByTestId } = render(<PipelineSpecTabContent templateString='' />);
    expect((await findByTestId('editor-mock')).textContent).toBe('');
  });

  it('passes yaml mode and readOnly to the editor', async () => {
    const { findByTestId } = render(<PipelineSpecTabContent templateString='name: test' />);
    const editor = await findByTestId('editor-mock');
    expect(editor).toHaveAttribute('data-mode', 'yaml');
    expect(editor).toHaveAttribute('data-readonly', 'true');
  });

  it('exposes the spec as a named textbox in the tab order', async () => {
    editorMock.useAce = true;
    const { container } = render(<PipelineSpecTabContent templateString='name: test' />);
    const textbox = await screen.findByRole('textbox', { name: /^Pipeline spec YAML/ });
    expect(textbox).not.toHaveAttribute('tabindex', '-1');
    expect(container.querySelector('.ace_content')).not.toHaveAttribute('aria-hidden');
  });
});
