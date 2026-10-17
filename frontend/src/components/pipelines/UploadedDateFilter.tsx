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

import { Menu } from '@base-ui/react/menu';
import { Check, Filter } from 'lucide-react';
import { Button } from '../ui/button';
import { useTheme } from '../shell/ThemeProvider';
import { V2beta1PredicateOperation, type V2beta1Predicate } from '../../apisv2beta1/filter';

export type UploadedPeriod = 'all' | '7' | '30' | '90';
type Props = { value: UploadedPeriod; onChange: (value: UploadedPeriod) => void };

export function uploadedDatePredicates(since?: Date): V2beta1Predicate[] {
  return since
    ? [
        {
          key: 'created_at',
          operation: V2beta1PredicateOperation.GREATER_THAN_EQUALS,
          timestamp_value: since,
        },
      ]
    : [];
}

export function UploadedDateOptions({ value, onChange }: Props) {
  return (
    <Menu.RadioGroup
      aria-label='Uploaded date'
      value={value}
      onValueChange={(value) => {
        if (value === 'all' || value === '7' || value === '30' || value === '90') onChange(value);
      }}
    >
      <div className='kfp-density-heading'>Uploaded</div>
      {(['all', '7', '30', '90'] as const).map((period) => (
        <Menu.RadioItem key={period} value={period} className='kfp-density-option' closeOnClick>
          {period === 'all' ? 'Any time' : `Last ${period} days`}
          <Menu.RadioItemIndicator>
            <Check size={16} aria-hidden='true' />
          </Menu.RadioItemIndicator>
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}

export function UploadedDateFilter(props: Props) {
  const { themeClassName } = useTheme();
  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button variant='ghost' size='icon' aria-label='Filter uploaded date' />}
        data-active={props.value !== 'all'}
      >
        <Filter size={14} aria-hidden='true' />
      </Menu.Trigger>
      <Menu.Portal className={themeClassName}>
        <Menu.Positioner align='end' sideOffset={4} className='kfp-density-positioner'>
          <Menu.Popup className='kfp-density-menu' aria-label='Filter uploaded date'>
            <UploadedDateOptions {...props} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
