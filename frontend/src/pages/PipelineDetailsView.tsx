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
import 'src/pages/DetailLayouts.css';
import { useLocation, useNavigate } from 'react-router';
import { useCallback, useMemo, useState } from 'react';
import { V2beta1Pipeline, V2beta1PipelineVersion } from 'src/apisv2beta1/pipeline';
import { InspectionTabs } from 'src/components/inspection/InspectionTabs';
import { PipelineVersionCard } from 'src/components/navigators/PipelineVersionCard';
import { PipelineSpecTabContent } from 'src/components/PipelineSpecTabContent';
import { InspectionPanel } from 'src/components/inspection/InspectionPanel';
import { StaticNodeDetails } from 'src/components/tabs/StaticNodeDetails';
import { convertSubDagToFlowElements, getNodeName } from 'src/lib/v2/StaticFlow';
import { tryConvertYamlToV2PipelineSpec } from 'src/lib/v2/WorkflowUtils';
import type {
  LayerElementsResolver,
  LayerFlowElement,
  PipelineFlowElement,
} from 'src/lib/v2/FlowTypes';

import 'src/components/pipelines/Pipelines.css';
import DagCanvas from './v2/DagCanvas';
import {
  PipelineDefinitionDetails,
  PipelineDefinitionSource,
} from 'src/components/pipelines/PipelineDefinitionDetails';

const ROOT_LAYERS = ['root'];
const TAB_NAMES = ['Graph', 'Details', 'Pipeline spec'];

interface PipelineDetailsViewProps {
  templateString?: string;
  manageVersionsHref?: string;
  definitionSource?: PipelineDefinitionSource;
  pipelineFlowElements: PipelineFlowElement[];
  pipeline: V2beta1Pipeline | null;
  selectedVersion: V2beta1PipelineVersion | undefined;
  versions: V2beta1PipelineVersion[];
  handleVersionSelected: (versionId: string) => Promise<void>;
}

function PipelineDetailsView({
  templateString,
  manageVersionsHref,
  definitionSource,
  pipelineFlowElements,
  pipeline,
  selectedVersion,
}: PipelineDetailsViewProps) {
  const navigate = useNavigate();
  const layers = ROOT_LAYERS;
  const location = useLocation();
  const initialTab = new URLSearchParams(location.search).get('tab');
  const [selectedTab, setSelectedTab] = useState(
    initialTab === 'details' ? 1 : initialTab === 'spec' ? 2 : 0,
  );
  const [selection, setSelection] = useState<LayerFlowElement | null>(null);
  const pipelineSpec = useMemo(
    () => (templateString ? tryConvertYamlToV2PipelineSpec(templateString) : undefined),
    [templateString],
  );
  const getSubDagElements = useCallback<LayerElementsResolver>(
    (layers) => (pipelineSpec ? convertSubDagToFlowElements(pipelineSpec, layers) : []),
    [pipelineSpec],
  );

  return (
    <div className='kfp-detail-page kfp-pipeline-detail' data-testid='pipeline-detail-v2'>
      <InspectionTabs
        selectedTab={selectedTab}
        onSwitch={(index) => {
          if (index === 3 && manageVersionsHref) navigate(manageVersionsHref);
          else setSelectedTab(index);
        }}
        tabs={manageVersionsHref ? [...TAB_NAMES, 'Versions'] : TAB_NAMES}
        ariaLabel='Pipeline details'
      >
        {selectedTab === 0 && (
          <div className='kfp-pipeline-graph'>
            <DagCanvas
              layers={layers}
              elements={pipelineFlowElements}
              graphId={
                selectedVersion?.pipeline_version_id &&
                `pipeline-version:${selectedVersion.pipeline_version_id}`
              }
              getSubDagElements={pipelineSpec ? getSubDagElements : undefined}
              selectedElement={selection}
              onElementClick={(_event, selection) => setSelection(selection)}
            ></DagCanvas>
            {templateString && (
              <InspectionPanel
                isOpen={!!selection}
                title={getNodeName(selection?.element ?? null)}
                onClose={() => setSelection(null)}
              >
                <div className='kfp-pipeline-node-details'>
                  <div>
                    <StaticNodeDetails
                      templateString={templateString}
                      layers={selection?.layers ?? layers}
                      element={selection?.element ?? null}
                    />
                  </div>
                </div>
              </InspectionPanel>
            )}
          </div>
        )}
        {selectedTab === 2 && (
          <div className='kfp-pipeline-spec' data-testid='spec-ir'>
            <PipelineSpecTabContent templateString={templateString || ''} />
          </div>
        )}
        {selectedTab === 1 && (
          <div className='kfp-inspection-scroll'>
            {pipeline ? (
              <PipelineVersionCard pipeline={pipeline} selectedVersion={selectedVersion} />
            ) : (
              <PipelineDefinitionDetails spec={pipelineSpec} source={definitionSource} />
            )}
          </div>
        )}
      </InspectionTabs>
    </div>
  );
}

export default PipelineDetailsView;
