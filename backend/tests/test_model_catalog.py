"""Offline catalog/download contract tests using isolated synthetic files only."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import model_catalog as models


class Response(io.BytesIO):
    def __init__(self, body):
        super().__init__(body)
        self.headers = {'Content-Length': str(len(body))}


class ModelCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.body = b'test-weights-not-a-real-model'
        self.spec = {'repo': 'fixture/model', 'revision': 'pinned',
                     'files': {'weights.bin': hashlib.sha256(self.body).hexdigest(), 'config.json': None}}
        self.patches = [patch.object(models, 'NAMES', {'image-small': 'Fixture'}),
                        patch.object(models, 'DEPTH_SPECS', {'image-small': self.spec}),
                        patch.object(models, 'specs', return_value={'image-small': self.spec}),
                        patch.object(models, 'destination', return_value=self.folder)]
        for item in self.patches:
            item.start()
        models._verified.clear()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def populate(self):
        (self.folder / 'weights.bin').write_bytes(self.body)
        (self.folder / 'config.json').write_text('{}')

    def test_status_and_missing_inference_never_access_network(self):
        with patch.object(models.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')) as network:
            self.assertFalse(models.catalog()['basicReady'])
            with self.assertRaisesRegex(RuntimeError, 'MODEL_DOWNLOAD_REQUIRED:image-small'):
                models.require_model('image-small')
            self.assertEqual(network.call_count, 0)

    def test_verified_cache_reuse_and_removed_file_detection(self):
        self.populate()
        with patch.object(models.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
            self.assertTrue(models.catalog()['basicReady'])
            models.download_model('image-small', lambda *args: None, lambda: None)
            self.assertTrue(models.require_model('image-small').samefile(self.folder))
            (self.folder / 'weights.bin').unlink()
            self.assertFalse(models.catalog()['basicReady'])

    def test_explicit_download_checks_pin_progress_and_atomic_completion(self):
        events, urls = [], []
        def open_url(request, **kwargs):
            urls.append(request.full_url)
            return Response(b'{}' if request.full_url.endswith('.json') else self.body)
        with patch.object(models.urllib.request, 'urlopen', side_effect=open_url):
            result = models.download_model('image-small', lambda *event: events.append(event), lambda: None)
        self.assertTrue(result['basicReady'])
        self.assertTrue(all('/resolve/pinned/' in url for url in urls))
        self.assertTrue(all(0 <= event[1] <= 1 for event in events))
        self.assertEqual(events[-1][0:2], ('done', 1))
        self.assertFalse(list(self.folder.glob('*.magimagic-download')))

    def test_failed_checksum_keeps_previous_file_and_allows_retry(self):
        target = self.folder / 'weights.bin'
        target.write_bytes(b'old-corrupt-cache')
        with patch.object(models.urllib.request, 'urlopen', return_value=Response(b'wrong-download')):
            with self.assertRaisesRegex(RuntimeError, 'SHA-256'):
                models.download_model('image-small', lambda *args: None, lambda: None)
        self.assertEqual(target.read_bytes(), b'old-corrupt-cache')
        self.assertFalse(list(self.folder.glob('*.magimagic-download')))
        def open_url(request, **kwargs):
            return Response(b'{}' if request.full_url.endswith('.json') else self.body)
        with patch.object(models.urllib.request, 'urlopen', side_effect=open_url):
            self.assertTrue(models.download_model('image-small', lambda *args: None, lambda: None)['basicReady'])

    def test_cancel_cleans_only_partial_download(self):
        cancelled = False
        def progress(stage, value, message):
            nonlocal cancelled
            if stage == 'download':
                cancelled = True
        def check():
            if cancelled:
                raise RuntimeError('fixture cancelled')
        with patch.object(models.urllib.request, 'urlopen', return_value=Response(self.body)):
            with self.assertRaisesRegex(RuntimeError, 'fixture cancelled'):
                models.download_model('image-small', progress, check)
        self.assertFalse((self.folder / 'weights.bin').exists())
        self.assertFalse(list(self.folder.glob('*.magimagic-download')))

    def test_changed_file_invalidates_integrity_cache(self):
        self.populate()
        self.assertTrue(models.catalog()['basicReady'])
        (self.folder / 'weights.bin').write_bytes(b'changed-different-size')
        self.assertFalse(models.catalog()['basicReady'])

    def test_unknown_id_cannot_select_arbitrary_download_destination(self):
        with self.assertRaises(ValueError):
            models.download_model('../../outside', lambda *args: None, lambda: None)

    def test_exact_revision_existing_hf_cache_reused_without_copy_or_network(self):
        self.populate()
        primary = self.folder / 'new-app-cache'
        # Temporarily restore the real resolver; all candidate paths remain fake.
        self.patches[3].stop()
        try:
            with patch.object(models, 'primary_destination', return_value=primary), \
                 patch.object(models, 'candidate_destinations', return_value=[primary, self.folder]), \
                 patch.object(models.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
                self.assertTrue(models.destination('image-small').samefile(self.folder))
                self.assertTrue(models.download_model('image-small', lambda *args: None, lambda: None)['basicReady'])
                self.assertFalse(primary.exists(), 'reusing complete external cache does not copy weights')
                (self.folder / 'config.json').unlink()
                self.assertEqual(models.destination('image-small'), primary,
                                 'partial fallback cache cannot make a model ready or become a download destination')
        finally:
            self.patches[3].start()


if __name__ == '__main__':
    unittest.main()
