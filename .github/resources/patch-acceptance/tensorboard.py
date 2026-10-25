import importlib.metadata
import json
import pathlib
import subprocess
import time
import urllib.request

import tensorflow as tf
from tensorboard.compat.proto import event_pb2, graph_pb2, node_def_pb2, summary_pb2
from tensorboard.summary.writer.event_file_writer import EventFileWriter

root = pathlib.Path('/tmp/tensorboard-acceptance')
root.mkdir(exist_ok=True)
# Both current scalars and legacy event formats must remain readable.
with tf.summary.create_file_writer(str(root / 'current')).as_default():
    tf.summary.scalar('loss', 0.25, step=1)
    tf.summary.image('preview', tf.ones((1, 2, 2, 3)), step=1)
writer = EventFileWriter(str(root / 'legacy'))
graph = graph_pb2.GraphDef(node=[node_def_pb2.NodeDef(name='input', op='Placeholder')])
writer.add_event(event_pb2.Event(wall_time=time.time(), step=1, graph_def=graph.SerializeToString()))
writer.add_event(event_pb2.Event(wall_time=time.time(), step=1, summary=summary_pb2.Summary(value=[summary_pb2.Summary.Value(tag='accuracy', simple_value=0.75)])))
writer.flush()
writer.close()
schemes = sorted(tf.io.gfile.get_registered_schemes())
print(json.dumps({'versions': {name: importlib.metadata.version(name) for name in ['tensorflow', 'tensorboard', 'protobuf', 'Werkzeug']}, 'filesystem_schemes': schemes}), flush=True)
prefix = '/tensorboard/viewer-acceptance'
process = subprocess.Popen(['tensorboard', '--logdir='+str(root), '--path_prefix='+prefix+'/', '--bind_all', '--port=6006', '--reload_interval=1'])
try:
    base = 'http://127.0.0.1:6006'+prefix
    def get(path):
        with urllib.request.urlopen(base+path, timeout=5) as response:
            return response.read()
    for attempt in range(90):
        try:
            plugins = json.loads(get('/data/plugins_listing'))
            if plugins['scalars']['enabled'] and plugins['images']['enabled'] and plugins['graphs']['enabled']:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        raise AssertionError('TensorBoard did not ingest scalar, image and graph fixtures')
    assert 'legacy' in json.loads(get('/data/plugin/scalars/tags'))
    assert 'legacy' in json.loads(get('/data/plugin/graphs/info'))
    assert b'input' in get('/data/plugin/graphs/graph?run=legacy')
    assert get('/')
    print('Event ingestion and prefixed endpoints passed', flush=True)
    pathlib.Path('/tmp/tensorboard-ready').write_text(json.dumps(schemes))
    # Keep server alive for an external browser test of the historical prefix bug.
    process.wait()
finally:
    process.terminate()
