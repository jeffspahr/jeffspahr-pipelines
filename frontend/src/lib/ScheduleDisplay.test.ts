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

import { scheduleDescription } from './ScheduleDisplay';

describe('scheduleDescription', () => {
  it.each([
    ['1', 'Every second'],
    ['60', 'Every minute'],
    ['3600', 'Every hour'],
    ['86400', 'Every day'],
    ['900', 'Every 15 minutes'],
    ['7200', 'Every 2 hours'],
    ['0', '-'],
    ['invalid', '-'],
    ['-1', '-'],
  ])('formats interval %s', (interval_second, expected) => {
    expect(scheduleDescription({ periodic_schedule: { interval_second } })).toBe(expected);
  });
  it.each([
    ['0 0 9 * * *', 'At 09:00 (scheduler time)'],
    ['0 30 8 * * MON-FRI', 'At 08:30, Monday through Friday (scheduler time)'],
    ['*/15 * * * *', 'Every 15 minutes (scheduler time)'],
    ['CRON_TZ=America/New_York 0 0 9 * * *', 'At 09:00 (America/New_York)'],
    ['bad cron', 'Cron: bad cron'],
  ])('describes cron %s', (cron, expected) => {
    expect(scheduleDescription({ cron_schedule: { cron } })).toBe(expected);
  });
  it('handles missing schedules', () => expect(scheduleDescription()).toBe('-'));
});
