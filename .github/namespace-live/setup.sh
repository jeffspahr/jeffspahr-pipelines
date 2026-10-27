#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/namespace-evidence
chmod 777 /tmp/namespace-evidence
for ns in fixture-a fixture-b; do
 kubectl create namespace "$ns"
 kubectl -n "$ns" apply -f - <<YAML
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: fixture-pipelines
rules:
- apiGroups: [pipelines.kubeflow.org]
  resources: [pipelines, pipelineversions]
  verbs: [get, list, create]
YAML
 kubectl -n "$ns" create rolebinding fixture-pipelines --role=fixture-pipelines --user=namespace-fixture@example.test
done
kubectl create clusterrole fixture-subject-access --verb=create --resource=subjectaccessreviews.authorization.k8s.io
kubectl create clusterrolebinding fixture-subject-access --clusterrole=fixture-subject-access --serviceaccount=kubeflow:ml-pipeline
kubectl -n kubeflow set env deployment/ml-pipeline MULTIUSER=true KUBEFLOW_USERID_HEADER=kubeflow-userid KUBEFLOW_USERID_PREFIX=
kubectl -n kubeflow set env deployment/ml-pipeline-ui DEPLOYMENT=KUBEFLOW KUBEFLOW_USERID_HEADER=kubeflow-userid KUBEFLOW_USERID_PREFIX=
kubectl -n kubeflow rollout status deployment/ml-pipeline --timeout=300s
kubectl -n kubeflow rollout status deployment/ml-pipeline-ui --timeout=300s
bash .github/resources/scripts/forward-port.sh kubeflow ml-pipeline 18888 8888
bash .github/resources/scripts/forward-port.sh kubeflow ml-pipeline-ui 3000 3000
python3 fixture/.github/namespace-live/proxy.py > /tmp/namespace-evidence/proxy.log 2>&1 &
for attempt in $(seq 1 30); do
 if curl --fail --silent --max-time 2 http://127.0.0.1:18888/apis/v1beta1/healthz >/dev/null; then
  python3 fixture/.github/namespace-live/seed.py
  exit 0
 fi
 sleep 1
done
echo 'Fixture API forward never became healthy' >&2
exit 1
