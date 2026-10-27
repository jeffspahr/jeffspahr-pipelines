import json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode
payload = Path('test/frontend-integration-test/helloworld.yaml').read_bytes()
results = []
for ns in ('fixture-a', 'fixture-b'):
    boundary = 'namespace-fixture-boundary'
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="uploadfile"; filename="pipeline.yaml"\r\nContent-Type: application/yaml\r\n\r\n'.encode() + payload + f'\r\n--{boundary}--\r\n'.encode())
    req = Request('http://localhost:18888/apis/v2beta1/pipelines/upload?' + urlencode({'name': ns + '-only', 'namespace': ns}), data=body, headers={'kubeflow-userid': 'namespace-fixture@example.test', 'Content-Type': f'multipart/form-data; boundary={boundary}'})
    try:
        with urlopen(req, timeout=60) as response:
            results.append({'namespace': ns, 'pipeline': json.load(response)})
    except HTTPError as error:
        Path('/tmp/namespace-evidence/seed-error.txt').write_bytes(error.read())
        raise
Path('/tmp/namespace-evidence/seed.json').write_text(json.dumps(results, indent=2))
