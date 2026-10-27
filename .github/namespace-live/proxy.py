"""Loopback-only trusted-identity/dashboard fixture; all API data is live."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import json
import threading

lock = threading.Lock()
bridge = b'''window.centraldashboard={CentralDashboardEventHandler:{init:function(callback){window.namespaceFixtureHandler={};callback(window.namespaceFixtureHandler,true);}}};'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/dashboard_lib.bundle.js':
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Content-Length', str(len(bridge)))
            self.end_headers()
            self.wfile.write(bridge)
            return
        headers = {key: value for key, value in self.headers.items() if key.lower() not in ('host', 'connection', 'accept-encoding')}
        headers['kubeflow-userid'] = 'namespace-fixture@example.test'
        try:
            response = urlopen(Request('http://127.0.0.1:3000' + self.path, headers=headers), timeout=60)
        except HTTPError as error:
            response = error
        with response:
            body = response.read()
            self.send_response(response.status)
            for key, value in response.headers.items():
                if key.lower() not in ('content-length', 'connection', 'transfer-encoding'):
                    self.send_header(key, value)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            if 'pipelines' in self.path:
                with lock, open('/tmp/namespace-evidence/requests.jsonl', 'a') as output:
                    output.write(json.dumps({'path': self.path, 'status': response.status}) + '\n')

ThreadingHTTPServer(('127.0.0.1', 3001), Handler).serve_forever()
