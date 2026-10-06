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

import { useId, useState } from 'react';
import { V2beta1RecurringRunStatus } from 'src/apisv2beta1/recurringrun';
import { Apis } from 'src/lib/Apis';
import { errorToMessage } from 'src/lib/Utils';
import { ScheduleSwitch } from './ScheduleSwitch';
import './ExperimentWorkflows.css';

export function RecurringRunSwitch({
  id,
  name,
  status,
  onUpdated,
}: {
  id: string;
  name: string;
  status?: V2beta1RecurringRunStatus;
  onUpdated: () => Promise<void>;
}) {
  const errorId = useId();
  const [error, setError] = useState('');
  const knownStatus =
    status === V2beta1RecurringRunStatus.ENABLED || status === V2beta1RecurringRunStatus.DISABLED;
  const changeEnabled = async (enabled: boolean) => {
    setError('');
    try {
      await (enabled
        ? Apis.recurringRunServiceApi.enableRecurringRun(id)
        : Apis.recurringRunServiceApi.disableRecurringRun(id));
      await onUpdated();
    } catch (cause) {
      setError(`Unable to update schedule: ${await errorToMessage(cause)}`);
    }
  };
  return (
    <div className='kfp-schedule-control' onClick={(event) => event.stopPropagation()}>
      <ScheduleSwitch
        name={name}
        checked={status === V2beta1RecurringRunStatus.ENABLED}
        disabled={!knownStatus || !id}
        errorId={error ? errorId : undefined}
        status={status || '-'}
        onChange={changeEnabled}
      />
      {error && (
        <p role='alert' id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
