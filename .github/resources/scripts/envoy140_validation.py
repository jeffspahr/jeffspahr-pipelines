#!/usr/bin/env python3
"""Focused real-MLMD/Envoy grpc-web qualification; run from exact PR checkout."""
import json
import os
from pathlib import Path
import ssl
import struct
import subprocess
import tempfile
import time
import traceback
import urllib.request
import urllib.error
import uuid
import yaml

ROOT = Path.cwd()
OUT = ROOT / 'evidence'
OUT.mkdir(exist_ok=True)
TMP = Path(tempfile.mkdtemp(prefix='envoy140-'))
TMP.chmod(0o755)
TOKEN = uuid.uuid4().hex[:10]
NETWORK = 'envoy140-' + TOKEN
IMAGE = 'kfp-envoy140-validation:' + TOKEN
CONTAINERS = []
REPORT = {'checks': [], 'scope': 'Real MLMD 1.14 SQLite backend, exact source plaintext/TLS Envoy configs; not a Kubernetes rolling-upgrade or production-database qualification.'}


def run(*args, check=True):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if check and result.returncode:
        raise RuntimeError(f'{args!r} failed ({result.returncode}):\n{result.stdout}')
    return result.stdout.strip()


def record(name, detail=True):
    REPORT['checks'].append({'name': name, 'passed': True, 'detail': detail})
    print('PASS:', name, flush=True)


def wait_for(fn, timeout=90):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            return fn()
        except Exception as exc:
            last = exc
            time.sleep(2)
    raise RuntimeError(f'Timed out: {last}') from last


def http(url, data=None, context=None):
    req = urllib.request.Request(url, data=data)
    try:
        with urllib.request.urlopen(req, context=context, timeout=10) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


def grpc_web(url, method, payload=b'', context=None):
    frame = b'\x00' + struct.pack('!I', len(payload)) + payload
    request = urllib.request.Request(url + '/ml_metadata.MetadataStoreService/' + method,
        data=frame, headers={'Content-Type': 'application/grpc-web+proto', 'X-Grpc-Web': '1'})
    with urllib.request.urlopen(request, context=context, timeout=15) as response:
        assert response.status == 200
        raw = response.read()
        header_status = response.headers.get('grpc-status')
    frames, trailers, cursor = [], {}, 0
    while cursor < len(raw):
        assert len(raw) - cursor >= 5, 'Truncated grpc-web header'
        flag, size = raw[cursor], struct.unpack('!I', raw[cursor+1:cursor+5])[0]
        cursor += 5
        value = raw[cursor:cursor+size]
        assert len(value) == size, 'Truncated grpc-web frame'
        cursor += size
        if flag == 128:
            for line in value.decode().split('\r\n'):
                if ':' in line:
                    key, val = line.split(':', 1)
                    trailers[key.lower()] = val.strip()
        else:
            assert flag == 0, f'Unexpected frame flag {flag}'
            frames.append(value)
    status = trailers.get('grpc-status', header_status)
    assert status == '0', f'grpc-status={status}, trailers={trailers}, raw={raw!r}'
    assert len(frames) == 1, f'Expected unary response, got {len(frames)} frames'
    return frames[0]


def port(name, target):
    return run('docker', 'port', name, str(target) + '/tcp').splitlines()[0].rsplit(':', 1)[1]


def container(name, image, options, command):
    CONTAINERS.append(name)
    run('docker', 'run', '-d', '--name', name, '--network', NETWORK,
        '--user', '1000:0', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        *options, image, *command)


def certs():
    run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
        '-subj', '/CN=Envoy test CA', '-keyout', str(TMP/'ca.key'), '-out', str(TMP/'ca.crt'))
    run('openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost',
        '-keyout', str(TMP/'tls.key'), '-out', str(TMP/'tls.csr'))
    (TMP/'ext.cnf').write_text('subjectAltName=DNS:localhost,DNS:metadata-grpc-service,DNS:metadata-grpc-service.kubeflow.svc,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n')
    run('openssl', 'x509', '-req', '-in', str(TMP/'tls.csr'), '-CA', str(TMP/'ca.crt'),
        '-CAkey', str(TMP/'ca.key'), '-CAcreateserial', '-days', '2', '-extfile', str(TMP/'ext.cnf'), '-out', str(TMP/'tls.crt'))
    run('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
        '-subj', '/CN=Untrusted test CA', '-keyout', str(TMP/'wrong.key'), '-out', str(TMP/'wrong.crt'))
    for path in TMP.iterdir():
        path.chmod(0o644)


def lane(tls):
    label = 'tls' if tls else 'plaintext'
    name = NETWORK + '-' + label
    backend = name + '-mlmd'
    config_path = ('manifests/kustomize/env/cert-manager/platform-agnostic-standalone-tls/patches/metadata-envoy-configmap.yaml'
        if tls else 'manifests/kustomize/base/metadata/base/metadata-envoy-configmap.yaml')
    config = yaml.safe_load((ROOT/config_path).read_text())['data']['envoy-config.yaml']
    config_file = TMP/(label+'-envoy.yaml')
    config_file.write_text(config)
    config_file.chmod(0o644)
    mlmd = 'connection_config { sqlite { filename_uri: "/tmp/mlmd.db" connection_mode: READWRITE_OPENCREATE } }\n'
    if tls:
        mlmd += 'ssl_config {\n'
        for field, filename in [('server_key','tls.key'), ('server_cert','tls.crt'), ('custom_ca','ca.crt')]:
            mlmd += field + ': ' + json.dumps((TMP/filename).read_text()) + '\n'
        mlmd += 'client_verify: false\n}\n'
    mlmd_file = TMP/(label+'-mlmd.proto')
    mlmd_file.write_text(mlmd)
    mlmd_file.chmod(0o644)
    container(backend, REPORT['mlmd_image'], ['--entrypoint', '/bin/metadata_store_server', '--network-alias', 'metadata-grpc-service',
        '--tmpfs', '/tmp:rw,mode=1777', '-v', f'{mlmd_file}:/etc/grpc/config.proto:ro'],
        ['--grpc_port=8080', '--metadata_store_server_config_file=/etc/grpc/config.proto',
         '--enable_database_upgrade=true', '--grpc_channel_arguments=grpc.max_metadata_size=16384,grpc.max_receive_message_length=104857600,grpc.max_send_message_length=104857600'])
    container(name, IMAGE, ['-p','127.0.0.1:19090:9090','-p','127.0.0.1:19901:9901',
        '-v', f'{config_file}:/etc/envoy/envoy-config.yaml:ro', '-v', f'{TMP}:/etc/envoy/tls:ro'], ['/etc/envoy/envoy-config.yaml'])
    admin = 'http://127.0.0.1:' + port(name, 9901)
    url = ('https' if tls else 'http') + '://127.0.0.1:' + port(name, 9090)
    context = ssl.create_default_context(cafile=str(TMP/'ca.crt')) if tls else None
    def ready():
        code, body, _ = http(admin+'/ready')
        assert code == 200 and b'LIVE' in body, (code, body)
    wait_for(ready)
    record(label + ': /ready LIVE')
    wait_for(lambda: grpc_web(url, 'GetArtifactTypes', context=context))
    # These protobuf field numbers are from the repository's generated MLMD bindings:
    # ArtifactType.name=2, PutArtifactTypeRequest.artifact_type=1.
    typename = ('Envoy140Qualification_' + label).encode()
    artifact_type = b'\x12' + bytes([len(typename)]) + typename
    request = b'\x0a' + bytes([len(artifact_type)]) + artifact_type
    grpc_web(url, 'PutArtifactType', request, context)
    def readback():
        value = grpc_web(url, 'GetArtifactTypes', context=context)
        assert typename in value, value
        return value
    readback()
    record(label + ': real MLMD PutArtifactType/GetArtifactTypes grpc-web roundtrip')
    if tls:
        wrong = ssl.create_default_context(cafile=str(TMP/'wrong.crt'))
        try:
            grpc_web(url, 'GetArtifactTypes', context=wrong)
        except urllib.error.URLError as exc:
            assert isinstance(exc.reason, ssl.SSLCertVerificationError), repr(exc)
        else:
            raise AssertionError('Untrusted downstream CA was accepted')
        record('tls: untrusted downstream certificate rejected')
        trusted_ca = (TMP/'ca.crt').read_text()
        (TMP/'ca.crt').write_text((TMP/'wrong.crt').read_text())
        run('docker', 'restart', name)
        wait_for(ready)
        try:
            grpc_web(url, 'GetArtifactTypes', context=context)
        except urllib.error.HTTPError as exc:
            assert exc.code == 503, exc.code
        except AssertionError as exc:
            assert 'grpc-status=14' in str(exc), str(exc)
        else:
            raise AssertionError('Untrusted upstream CA was accepted')
        _, counters, _ = http(admin + '/stats?filter=ssl.fail_verify_error')
        assert any(int(line.rsplit(b':', 1)[1]) > 0 for line in counters.splitlines() if b':' in line), counters
        record('tls: untrusted upstream certificate rejected', counters.decode())
        (TMP/'ca.crt').write_text(trusted_ca)
        run('docker', 'restart', name)
        wait_for(ready)
        wait_for(readback)
        record('tls: trusted upstream restored after rejection')

    assert http(admin+'/healthcheck/fail', b'')[0] == 200
    assert http(admin+'/ready')[0] == 503
    assert http(admin+'/server_info')[0] == 200
    record(label + ': unhealthy readiness 503 while server_info stays 200')
    assert http(admin+'/healthcheck/ok', b'')[0] == 200
    ready()
    run('docker','restart',name)
    wait_for(ready)
    wait_for(readback)
    record(label + ': Envoy restart recovers persisted MLMD grpc-web access')
    info = json.loads(run('docker','inspect',name))[0]
    assert info['Config']['User'] == '1000:0'
    assert 'ALL' in info['HostConfig']['CapDrop']
    assert 'no-new-privileges' in info['HostConfig']['SecurityOpt']
    record(label + ': non-root user, dropped capabilities, no-new-privileges')
    # Remove this backend before the next lane so DNS has only one matching alias.
    for item in [name, backend]:
        (OUT/(item+'.log')).write_text(run('docker','logs',item,check=False))
        run('docker','rm','-f',item)
        CONTAINERS.remove(item)


def main():
    REPORT['source_sha'] = run('git','rev-parse','HEAD')
    dockerfile = (ROOT/'third_party/metadata_envoy/Dockerfile').read_text()
    assert 'FROM envoyproxy/envoy:v1.40.1' in dockerfile, 'Expected PR Envoy 1.40.1 source'
    deployment = yaml.safe_load((ROOT/'manifests/kustomize/base/metadata/base/metadata-grpc-deployment.yaml').read_text())
    REPORT['mlmd_image'] = deployment['spec']['template']['spec']['containers'][0]['image']
    assert REPORT['mlmd_image'].endswith(':1.14.0')
    build = run('docker','build','-f','third_party/metadata_envoy/Dockerfile','-t',IMAGE,'.')
    (OUT/'image-build.log').write_text(build)
    REPORT['envoy_version'] = run('docker','run','--rm','--entrypoint','/usr/local/bin/envoy',IMAGE,'--version')
    REPORT['envoy_image_id'] = run('docker','image','inspect',IMAGE,'--format','{{.Id}}')
    run('docker','network','create',NETWORK)
    certs()
    lane(False)
    lane(True)
    REPORT['passed'] = True


if __name__ == '__main__':
    try:
        main()
    except Exception:
        REPORT['passed'] = False
        REPORT['error'] = traceback.format_exc()
        raise
    finally:
        for name in CONTAINERS:
            (OUT/(name+'.log')).write_text(run('docker','logs',name,check=False))
            (OUT/(name+'.inspect.json')).write_text(run('docker','inspect',name,check=False))
            run('docker','rm','-f',name,check=False)
        run('docker','network','rm',NETWORK,check=False)
        (OUT/'results.json').write_text(json.dumps(REPORT,indent=2)+'\n')
        print(json.dumps(REPORT,indent=2),flush=True)
