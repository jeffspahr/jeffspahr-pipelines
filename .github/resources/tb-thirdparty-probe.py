import importlib.metadata as m
import json, os, subprocess, sys
packages={d.metadata.get('Name', '').lower():d.version for d in m.distributions()}
report={'uid':os.getuid(),'packages':packages,'probes':{}}
def probe(name, cmd):
 try:
  r=subprocess.run(cmd,capture_output=True,text=True,timeout=90)
  report['probes'][name]={'returncode':r.returncode,'stdout':r.stdout[-6000:],'stderr':r.stderr[-6000:]}
 except Exception as e: report['probes'][name]={'error':repr(e)}
probe('cli', ['tensorboard','--version'])
for scheme in ['s3','gs']:
 probe(scheme,[sys.executable,'-c',f"from tensorboard.compat import tf; print('reader', tf.io.gfile.__name__); f=tf.io.gfile.GFile('{scheme}://tb-probe/logs/probe.txt','rb'); data=f.read(); print(repr(data)); assert data == b'kfp-storage-probe'; f.close()"])
print(json.dumps(report,indent=2))
