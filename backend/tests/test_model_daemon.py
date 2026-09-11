"""Cold-process catalog IPC checks: stdin stays open, no native imports/network."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import unittest


BACKEND = Path(__file__).resolve().parents[1]


class ModelDaemonTests(unittest.TestCase):
    def test_cold_catalog_replies_without_numpy_or_inference_imports(self):
        with tempfile.TemporaryDirectory(prefix='magimagic-cold-catalog-') as folder:
            # A fresh process is essential: the rest of the suite imports NumPy.
            # Block native/inference modules instead of preloading them, which
            # would hide the Windows first-import-on-a-worker-thread failure.
            code = f'''
import sys, pathlib, runpy
class NoInferenceImports:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {{'advanced_maps', 'numpy', 'torch', 'cv2', 'PIL', 'transformers', 'diffusers', 'safetensors'}}:
            raise ImportError('Catalog must not import ' + fullname)
sys.meta_path.insert(0, NoInferenceImports())
def offline(event, args):
    if event == 'socket.connect':
        raise RuntimeError('Catalog must not access the network')
sys.addaudithook(offline)
pathlib.Path.home = classmethod(lambda cls: pathlib.Path({folder!r}))
runpy.run_path({str(BACKEND / 'model_daemon.py')!r}, run_name='__main__')
'''
            env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUTF8': '1',
                   'PYTHONIOENCODING': 'utf-8', 'DEPTHDESK_MODELS_DIR': folder,
                   'HF_HOME': folder, 'HF_HUB_CACHE': str(Path(folder) / 'hub'),
                   'HUGGINGFACE_HUB_CACHE': str(Path(folder) / 'hub'),
                   'XDG_CACHE_HOME': folder, 'HF_HUB_OFFLINE': '1'}
            proc = subprocess.Popen([sys.executable, '-B', '-u', '-c', code],
                                    cwd=BACKEND, env=env, stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding='utf-8', bufsize=1)
            replies, errors = queue.Queue(), []
            def read_replies():
                for line in proc.stdout:
                    replies.put(line)
            def read_errors():
                for line in proc.stderr:
                    errors.append(line)
            readers = [threading.Thread(target=read_replies, daemon=True),
                       threading.Thread(target=read_errors, daemon=True)]
            for reader in readers:
                reader.start()
            def request(identifier, command, payload=None):
                proc.stdin.write(json.dumps({'id': identifier, 'command': command,
                                             'payload': payload or {}}) + '\n')
                proc.stdin.flush()
                try:
                    response = json.loads(replies.get(timeout=15))
                except queue.Empty:
                    self.fail('Cold catalog worker did not reply with stdin open: ' + ''.join(errors))
                self.assertEqual(response['id'], identifier)
                return response
            try:
                for identifier in ['cold', 'warm']:
                    response = request(identifier, 'catalog')
                    self.assertEqual(response['type'], 'result', response)
                    self.assertEqual({m['id'] for m in response['data']['models']},
                                     {'image-small', 'video-small', 'alpha-fast',
                                      'alpha-advanced', 'normal', 'appearance'})
                    self.assertFalse(response['data']['basicReady'])
                    self.assertTrue(all(not m['ready'] for m in response['data']['models']))
                self.assertEqual(request('bad', 'download', {'modelId': 'unknown'})['type'], 'error')
                self.assertEqual(request('after-error', 'catalog')['type'], 'result')
                self.assertEqual(request('cancel', 'cancel', {'jobId': 'missing'})['type'], 'result')
                proc.stdin.close()
                self.assertEqual(proc.wait(timeout=5), 0, ''.join(errors))
                self.assertEqual(list(Path(folder).iterdir()), [], 'Status must not write or download cache files')
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=5)
                if not proc.stdin.closed:
                    proc.stdin.close()
                for reader in readers:
                    reader.join(timeout=2)
                proc.stdout.close()
                proc.stderr.close()


if __name__ == '__main__':
    unittest.main()
