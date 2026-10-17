/*
 * Copyright 2026 The Kubeflow Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useId } from 'react';
import type { ReactNode } from 'react';
import { MoreVertical, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import { useTheme } from '../shell/ThemeProvider';
import { ExpandState } from '../CustomTable';
import type { CustomTableRenderModel, Row } from '../CustomTable';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { CollectionToolbar } from '../tables/CollectionToolbar';
import { TableFooter } from '../tables/TableFooter';
import { useDensity } from '../tables/DensityProvider';
import './Pipelines.css';

function rowName(row: Row): string {
  const value = row.otherFields[0] as { display_name?: string; name?: string };
  return value.display_name || value.name || row.id;
}

export function PipelineCards({
  table,
  hideControls = false,
}: {
  table: CustomTableRenderModel;
  hideControls?: boolean;
}) {
  const id = useId();
  const density = useDensity()?.density ?? 'comfortable';
  const NameRenderer = table.columns[0].customRenderer;
  const DescriptionRenderer = table.columns[1].customRenderer;
  const visibleSelected = table.rows.filter((row) => table.selectedIds.includes(row.id)).length;
  const allSelected = table.rows.length > 0 && visibleSelected === table.rows.length;
  return (
    <div className='kfp-pipeline-cards-view' data-density={density}>
      {!hideControls && <PipelineControls table={table} />}
      <div className='kfp-pipeline-selection'>
        <Checkbox
          aria-label='Select all pipelines on this page'
          checked={allSelected}
          indeterminate={visibleSelected > 0 && !allSelected}
          disabled={!table.rows.length || table.isBusy}
          onCheckedChange={table.onSelectAll}
        />
        <span>Select all on this page</span>
      </div>
      {!table.rows.length && (
        <div className='kfp-pipeline-empty'>
          {table.isBusy ? (
            <p role='status'>Loading pipelines…</p>
          ) : table.errorMessage ? (
            <p>{table.errorMessage}</p>
          ) : table.filter ? (
            <>
              <strong>No pipelines match</strong>
              <p>Try another name or clear the filter.</p>
            </>
          ) : (
            <p>{table.emptyMessage}</p>
          )}
        </div>
      )}
      <ul role='list' className='kfp-pipeline-grid' aria-label='Pipelines' aria-busy={table.isBusy}>
        {table.rows.map((row, index) => {
          const expanded = row.expandState === ExpandState.EXPANDED;
          const name = rowName(row);
          return (
            <li
              key={row.id}
              className='kfp-pipeline-card'
              data-testid='pipeline-card'
              data-row-id={row.id}
              data-selected={table.selectedIds.includes(row.id)}
              data-expanded={expanded}
            >
              <div className='kfp-pipeline-card-main'>
                <header>
                  <Checkbox
                    aria-label={`Select pipeline ${name}`}
                    checked={table.selectedIds.includes(row.id)}
                    disabled={table.isBusy}
                    onCheckedChange={() => table.onSelect(row.id)}
                  />
                  <h2>
                    {NameRenderer ? <NameRenderer value={row.otherFields[0]} id={row.id} /> : name}
                  </h2>
                </header>
                <div className='kfp-pipeline-description'>
                  {DescriptionRenderer ? (
                    <DescriptionRenderer value={row.otherFields[1]} id={row.id} />
                  ) : (
                    row.otherFields[1] || 'No description provided.'
                  )}
                </div>
                {row.error && (
                  <p role='note' className='kfp-pipeline-error'>
                    {row.error}
                  </p>
                )}
                <footer>
                  <span>Uploaded {row.otherFields[2] || '—'}</span>
                  <Button
                    variant='ghost'
                    size='sm'
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} pipeline ${name}`}
                    aria-expanded={expanded}
                    aria-controls={`${id}-versions-${index}`}
                    disabled={table.isBusy}
                    onClick={() => table.onToggleExpansion?.(index)}
                  >
                    Versions{' '}
                    {expanded ? (
                      <ChevronDown size={14} aria-hidden='true' />
                    ) : (
                      <ChevronRight size={14} aria-hidden='true' />
                    )}
                  </Button>
                </footer>
              </div>
              {expanded && (
                <div className='kfp-pipeline-versions' id={`${id}-versions-${index}`}>
                  {table.getExpandedContent?.(index)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <TableFooter table={table} plural='pipelines' />
    </div>
  );
}

export function PipelineControls({
  table,
  children,
  cards = true,
  actions,
  filters,
}: {
  table: CustomTableRenderModel;
  children?: ReactNode;
  cards?: boolean;
  actions?: ReactNode;
  filters?: ReactNode;
}) {
  const { themeClassName } = useTheme();
  const options = [
    { key: 'display_name', order: 'asc', label: 'Name: A–Z' },
    { key: 'display_name', order: 'desc', label: 'Name: Z–A' },
    { key: 'created_at', order: 'desc', label: 'Uploaded: newest first' },
    { key: 'created_at', order: 'asc', label: 'Uploaded: oldest first' },
  ] as const;
  return (
    <CollectionToolbar
      table={{
        ...table,
        filterActions: (
          <Menu.Root>
            <Menu.Trigger render={<Button variant='ghost' size='icon' aria-label='More actions' />}>
              <MoreVertical size={16} aria-hidden='true' />
            </Menu.Trigger>
            <Menu.Portal className={themeClassName}>
              <Menu.Positioner align='end' sideOffset={4} className='kfp-density-positioner'>
                <Menu.Popup className='kfp-density-menu' aria-label='More actions'>
                  {cards && (
                    <>
                      <div className='kfp-density-heading'>Sort by</div>
                      <Menu.RadioGroup
                        value={`${table.sortBy}:${table.sortOrder}`}
                        onValueChange={(value) => {
                          const option = options.find(
                            (option) => `${option.key}:${option.order}` === value,
                          );
                          if (option) table.onSort(option.key, option.order);
                        }}
                      >
                        {options.map(({ key, order, label }) => (
                          <Menu.RadioItem
                            key={`${key}:${order}`}
                            value={`${key}:${order}`}
                            className='kfp-density-option'
                            closeOnClick
                          >
                            {label}
                            <Menu.RadioItemIndicator>
                              <Check size={16} aria-hidden='true' />
                            </Menu.RadioItemIndicator>
                          </Menu.RadioItem>
                        ))}
                      </Menu.RadioGroup>
                      {filters}
                    </>
                  )}
                  {actions}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ),
      }}
      filterLabel='Search pipelines'
    >
      {children}
    </CollectionToolbar>
  );
}
