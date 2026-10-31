#!/usr/bin/env python3
"""Load all seven real archives and record identities for cross-run comparison."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('shared_ci_images', ROOT / '.github/resources/scripts/shared_ci_images.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--kind', choices=('baseline', 'shared'), required=True)
parser.add_argument('--directory', type=Path, default=Path('benchmark-images'))
parser.add_argument('--state', type=Path, default=Path('benchmark-state.json'))
parser.add_argument('--negative', action='store_true')
args = parser.parse_args()
consumer = shared.environment_identity()
api = shared.GitHub(consumer['repository'])
state = json.loads(args.state.read_text()) if args.kind == 'shared' else None
if state:
    assert state['identity']['run_id'] != consumer['run_id'], 'Expected actual cross-run consumption'
    assert state['consumer'] == consumer, 'Changed consumer identity'
    shared.same_source(state['identity'], consumer)

if args.negative:
    assert state is not None
    failures = []
    for name, mutate in [
        ('wrong-source', lambda value: value['identity'].__setitem__('source_sha', '0' * 40)),
        ('wrong-architecture', lambda value: value.__setitem__('architecture', 'arm64')),
        ('stale-attempt', lambda value: value['identity'].__setitem__('run_attempt', value['identity']['run_attempt'] + 1)),
    ]:
        changed = copy.deepcopy(state)
        mutate(changed)
        try:
            shared.verify(api, changed, consumer, args.directory, 'flat', 'images')
        except shared.InvalidEvidence as error:
            failures.append({'case': name, 'rejected': True, 'reason': str(error)})
        else:
            raise AssertionError(f'{name} was incorrectly accepted')
    archive = args.directory / 'apiserver.tar'
    with archive.open('r+b') as stream:
        first = stream.read(1)
        stream.seek(0)
        stream.write(bytes([first[0] ^ 1]))
    try:
        try:
            shared.verify(api, state, consumer, args.directory, 'flat', 'images')
        except shared.InvalidEvidence as error:
            failures.append({'case': 'corrupt-archive', 'rejected': True, 'reason': str(error)})
        else:
            raise AssertionError('Corrupt archive was incorrectly accepted')
    finally:
        with archive.open('r+b') as stream:
            stream.write(first)
    hidden = archive.with_suffix('.hidden')
    archive.rename(hidden)
    try:
        try:
            shared.verify(api, state, consumer, args.directory, 'flat', 'images')
        except shared.InvalidEvidence as error:
            failures.append({'case': 'missing-archive', 'rejected': True, 'reason': str(error)})
        else:
            raise AssertionError('Missing archive was incorrectly accepted')
    finally:
        hidden.rename(archive)
    shared.verify(api, state, consumer, args.directory, 'flat', 'images')
    Path('benchmark-negative-results.json').write_text(json.dumps(failures, indent=2) + '\n')
    print(json.dumps(failures))
    raise SystemExit(0)

started = time.time()
archives = sorted(args.directory.glob('*.tar'))
assert {p.name for p in archives} == {f'{image}.tar' for image in shared.IMAGES}
if state:
    artifact_ids = {record['image']: record['artifact_id'] for record in state['sets']['images']}
else:
    artifacts = api.artifacts(consumer['run_id'])
    artifact_ids = {artifact['name']: artifact['id'] for artifact in artifacts if artifact['name'] in shared.IMAGES}
    assert set(artifact_ids) == set(shared.IMAGES)
records = []
for image in shared.IMAGES:
    archive = args.directory / f'{image}.tar'
    digest = shared.checksum(archive)
    subprocess.run(['docker', 'load', '--input', str(archive)], check=True)
    tag = f'kind-registry:5000/{image}:ci'
    data = json.loads(subprocess.check_output(['docker', 'image', 'inspect', tag], text=True))[0]
    assert data['Architecture'] == 'amd64' and data['Os'] == 'linux', data
    records.append({'image': image, 'artifact_id': artifact_ids[image], 'archive_sha256': digest,
                    'archive_bytes': archive.stat().st_size, 'image_id': data['Id'], 'tag': tag,
                    'architecture': data['Architecture'], 'os': data['Os']})
subprocess.run(['docker', 'run', '--rm', '--entrypoint', 'node', 'kind-registry:5000/frontend:ci',
                '-e', "require('fs').accessSync('/client/index.html'); require('fs').accessSync('/server/dist/server.js')"], check=True)
report = {'kind': args.kind, 'consumer': consumer,
          'producer': state['identity'] if state else consumer, 'images': records,
          'load_and_inspect_seconds': round(time.time() - started, 3), 'ready_at_epoch': time.time()}
Path('benchmark-images.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
