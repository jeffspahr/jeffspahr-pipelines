#!/usr/bin/env bash
# Copyright 2026 The Kubeflow Authors
# SPDX-License-Identifier: Apache-2.0

# Seed the disposable multi-user CI cluster through the same UI proxy the browser uses.
set -euo pipefail

: "${GITHUB_OUTPUT:?set GITHUB_OUTPUT to the fixture output file}"
api="${PROFILE_UI_URL:-http://127.0.0.1:3000}/apis/v2beta1"
namespace="${USER_NAMESPACE:-kubeflow-user-example-com}"
owner=$(kubectl get profile "$namespace" -o jsonpath='{.spec.owner.name}')
kubectl create rolebinding profile-run-owner -n "$namespace" --clusterrole=kubeflow-pipelines-edit --user="$owner"

prepare_run() {
  local namespace=$1 owner=$2 run state attempt spec
  spec=test_data/sdk_compiled_pipelines/valid/critical/two_step_pipeline_containerized.yaml
  # A unique input forces a fresh producer execution even on cache-enabled clusters.
  local name="profile-run-details-$(date +%s)-$RANDOM"
  prepared_run_id=$(
    yq -o=json '.' "$spec" |
      jq --arg namespace "$namespace" --arg name "$name" \
        '{namespace: $namespace, display_name: $name, pipeline_spec: .,
          service_account: "default-editor", runtime_config: {parameters: {text: $name}}}' |
      curl --fail-with-body -sS -H "kubeflow-userid: $owner" -H 'Content-Type: application/json' \
        --data-binary @- "$api/runs" |
      jq -er '.run_id | select(type == "string" and length > 0)'
  )

  for attempt in {1..120}; do
    run=$(curl --fail-with-body -sS -H "kubeflow-userid: $owner" "$api/runs/$prepared_run_id")
    state=$(jq -er '.state // "RUNTIME_STATE_UNSPECIFIED"' <<<"$run")
    case "$state" in
      SUCCEEDED) break ;;
      FAILED|CANCELED|CANCELING|SKIPPED|PAUSED)
        echo "Fixture run $prepared_run_id in $namespace reached $state" >&2
        kubectl -n "$namespace" get workflows -l "pipeline/runid=$prepared_run_id" -o json |
          jq '[.items[].status.nodes[]? | select(.phase == "Failed" or .phase == "Error") |
            {displayName, phase, message}]' >&2
        exit 1 ;;
    esac
    if [[ $attempt == 120 ]]; then
      echo "Fixture run $prepared_run_id timed out in $state" >&2
      exit 1
    fi
    sleep 5
  done
}

prepare_run "$namespace" "$owner"
{
  echo "run_id=$prepared_run_id"
  echo "owner=$owner"
} >> "$GITHUB_OUTPUT"
