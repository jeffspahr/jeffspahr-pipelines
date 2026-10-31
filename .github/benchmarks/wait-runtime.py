#!/usr/bin/env python3
"""Benchmark-only gate: keep common runtime production outside app-image work."""
import json
import os
import subprocess
import time

repo = os.environ['GITHUB_REPOSITORY']
sha = os.environ['GITHUB_SHA']
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == sha
deadline = time.monotonic() + 1200
while time.monotonic() < deadline:
    runs = json.loads(subprocess.check_output([
        'gh', 'api', f'repos/{repo}/actions/workflows/runtime-base-images.yml/runs?head_sha={sha}&per_page=100',
    ], text=True))['workflow_runs']
    matches = [run for run in runs if run['event'] == 'push' and run['head_sha'] == sha
               and run['path'] == '.github/workflows/runtime-base-images.yml'
               and run['head_repository']['full_name'] == repo]
    if matches:
        run = max(matches, key=lambda value: value['id'])
        if run['status'] == 'completed':
            if run['conclusion'] != 'success':
                raise SystemExit(f'Runtime producer {run["id"]} failed: {run["conclusion"]}')
            print(json.dumps({'runtime_run_id': run['id'], 'runtime_attempt': run['run_attempt'],
                              'source_sha': sha, 'gate_released_at_epoch': time.time()}))
            break
    print('Waiting for successful same-revision runtime producer', flush=True)
    time.sleep(15)
else:
    raise SystemExit('Timed out waiting for runtime producer')
