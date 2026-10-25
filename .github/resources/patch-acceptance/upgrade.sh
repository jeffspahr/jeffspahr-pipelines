#!/usr/bin/env bash
set -euo pipefail
# Run from the candidate pipelines checkout. Hosted Linux Docker required.
# Compile kfp-schema.go from this directory first; KFP_SCHEMA points to its binary.
lane=${1:?18 or 14}
case "$lane" in
 18) old=docker.io/postgres:18.3-alpine3.22
     new=docker.io/postgres:18.6-alpine3.23@sha256:dec395d8c09c45609d6deb5c2388a07882d64fa59b1d98c1895792e085f57888
     version=180006; security=(--user 999:999 --cap-drop ALL --security-opt no-new-privileges);;
 14) old=docker.io/postgres:14.7-alpine3.17
     new=docker.io/postgres:14.24-alpine3.23@sha256:836ff0855bffedade962df0e09ddcb897cc398d2283f1f45d0776cc40f203f37
     version=140024; security=();;
 *) exit 2;;
esac
fixture_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
name="pg-acceptance-${lane}-${GITHUB_RUN_ID:-$$}"
volume="$name-data"
mlmd="$name-mlmd"
cleanup() { docker logs "$name" || true; docker logs "$mlmd" || true; docker rm -f "$mlmd" "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker pull "$old"
docker pull "$new"
docker image inspect "$old" "$new" --format '{{.Id}} {{json .RepoDigests}}'
docker volume create "$volume"
# Model kubelet fsGroup ownership for the default non-root pod. Legacy entrypoint owns its own directory.
if [[ "$lane" == 18 ]]; then
 docker run --rm --user 0:0 -v "$volume:/var/lib/postgresql/data" --entrypoint sh "$old" -c 'chown 999:999 /var/lib/postgresql/data; chmod 2770 /var/lib/postgresql/data'
fi
if [[ "$lane" == 14 ]]; then
 docker build -t "$name-client" - <<'DOCKERFILE'
FROM python:3.10-slim
RUN pip install --no-cache-dir ml-metadata==1.14.0 'numpy<2'
DOCKERFILE
fi
mlmd_client() {
 docker run --rm --network "container:$name" -v "$fixture_dir/mlmd-client.py:/client.py:ro" "$name-client" python /client.py "$1"
}
psql() { docker exec -i "$name" psql -v ON_ERROR_STOP=1 -U user -d postgres "$@"; }
start() {
 docker run -d --name "$name" "${security[@]}" -p 127.0.0.1:15432:5432 \
   -e POSTGRES_USER=user -e POSTGRES_PASSWORD=acceptance-only -e POSTGRES_DB=postgres \
   -e PGDATA=/var/lib/postgresql/data/pgdata -v "$volume:/var/lib/postgresql/data" "$1"
 for i in $(seq 1 90); do
   if psql -Atc 'SELECT 1' >/dev/null 2>&1; then return; fi
   sleep 2
 done
 echo 'PostgreSQL readiness timed out' >&2; return 1
}
mlmd_start() {
 docker run -d --name "$mlmd" --network "container:$name" --entrypoint /bin/metadata_store_server --user 1000:0 --cap-drop ALL --security-opt no-new-privileges \
 gcr.io/tfx-oss-public/ml_metadata_store_server:1.14.0 \
 --grpc_port=8080 --metadata_source_config_type=postgresql --postgres_config_host=127.0.0.1 \
 --postgres_config_port=5432 --postgres_config_dbname=mlmdpostgres --postgres_config_user=user \
 --postgres_config_password=acceptance-only --enable_database_upgrade=true
 for i in $(seq 1 90); do
  if docker exec "$name" psql -U user -d mlmdpostgres -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND lower(table_name)='mlmdenv'" 2>/dev/null | grep -qx 1; then
   [[ $(docker inspect -f '{{.State.Running}}' "$mlmd") == true ]] || return 1
   return
  fi
  sleep 2
 done
 echo 'MLMD initialization timed out' >&2; return 1
}
start "$old"
psql <<'SQL'
CREATE SCHEMA patch_acceptance;
CREATE TABLE patch_acceptance.records (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE NOT NULL, payload jsonb NOT NULL, created timestamptz NOT NULL);
CREATE INDEX records_payload ON patch_acceptance.records USING gin(payload);
INSERT INTO patch_acceptance.records(name,payload,created) SELECT 'record-'||i,jsonb_build_object('value',i),TIMESTAMPTZ '2026-01-01 12:00:00+00' FROM generate_series(1,1000) i;
SQL
if [[ "$lane" == 18 ]]; then
 "${KFP_SCHEMA:?set KFP_SCHEMA to compiled helper}" seed
else
 psql -c 'CREATE DATABASE mlmdpostgres'
 mlmd_start
 mlmd_client seed
 docker rm -f "$mlmd"
fi
before=$(psql -Atc "SELECT md5(string_agg(id||name||payload::text||created::text,',' ORDER BY id)) FROM patch_acceptance.records")
system_before=$(psql -Atc 'SELECT system_identifier FROM pg_control_system()')
docker stop -t 60 "$name"
docker rm "$name"
start "$new"
[[ $(psql -Atc 'SHOW server_version_num') == "$version" ]]
[[ $(psql -Atc 'SELECT system_identifier FROM pg_control_system()') == "$system_before" ]]
[[ $(psql -Atc "SELECT md5(string_agg(id||name||payload::text||created::text,',' ORDER BY id)) FROM patch_acceptance.records") == "$before" ]]
psql <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM patch_acceptance.records WHERE payload @> '{"value":500}'::jsonb) <> 1 THEN RAISE EXCEPTION 'JSONB lookup failed'; END IF;
 IF (SELECT count(*) FROM pg_index WHERE indrelid='patch_acceptance.records'::regclass AND indisvalid) <> 3 THEN RAISE EXCEPTION 'index lost'; END IF;
END $$;
INSERT INTO patch_acceptance.records(name,payload,created) VALUES ('after-upgrade','{"value":1001}',now());
SET timezone='America/New_York';
SELECT to_char(created,'YYYY-MM-DD TZ') FROM patch_acceptance.records LIMIT 1;
SQL
if [[ "$lane" == 18 ]]; then "$KFP_SCHEMA" verify; else mlmd_start; mlmd_client upgraded; docker rm -f "$mlmd"; fi
docker restart -t 60 "$name"
for i in $(seq 1 90); do if psql -Atc 'SELECT 1' >/dev/null 2>&1; then break; fi; sleep 2; done
[[ $(psql -Atc 'SELECT count(*) FROM patch_acceptance.records') == 1001 ]]
if [[ "$lane" == 18 ]]; then "$KFP_SCHEMA" verify; else mlmd_start; mlmd_client restarted; fi
echo "PASS PostgreSQL $lane same-volume upgrade to $version, persisted reads/writes/indexes/restart and application schema initialization"
