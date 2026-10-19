// Copyright 2026 The Kubeflow Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import cronstrue from 'cronstrue';
import { TriggerSchedule } from './TriggerUtils';

/** Describe the schedule without converting scheduler wall-clock times to browser time. */
export function scheduleDescription(trigger?: TriggerSchedule): string {
  const cron = trigger?.cron_schedule?.cron;
  if (cron) {
    const match = cron.match(/^(?:CRON_TZ|TZ)=([^ ]+)\s+(.+)$/);
    try {
      return `${cronstrue.toString(match ? match[2] : cron, { use24HourTimeFormat: true })} (${match ? match[1] : 'scheduler time'})`;
    } catch {
      return `Cron: ${cron}`;
    }
  }
  const seconds = Number(trigger?.periodic_schedule?.interval_second);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return '-';
  for (const [size, unit] of [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ] as const) {
    if (seconds % size === 0) {
      const count = seconds / size;
      return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
    }
  }
  return '-';
}
