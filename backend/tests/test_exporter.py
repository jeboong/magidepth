import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import DEFAULTS, Cancelled, Decoder, Job, probe
from exporter import paths_for_output, publish, render_project, preview_project
from maps import fast_maps


class LocalEngine:
    """The source/material path must not need a depth model or a GPU."""
    pass


class MapTests(unittest.TestCase):
    def test_fast_map_formats(self):
        rgb = np.full((32, 48, 3), [70, 150, 220], dtype=np.uint8)
        depth = np.full((32, 48), 127, dtype=np.uint8)
        maps = fast_maps(rgb, depth, ['source', 'depth', 'normal', 'basecolor', 'metallic', 'roughness', 'specular'], DEFAULTS)
        for key, image in maps.items():
            self.assertEqual(image.dtype, np.uint8)
            self.assertEqual(image.shape[:2], rgb.shape[:2])
        np.testing.assert_array_equal(maps['normal'][0, 0], [128, 128, 255])
        self.assertEqual(maps['specular'].max(), 0)

    def test_cancel_progress_fraction(self):
        events = []
        job = Job('x', events.append)
        job.progress('test', 35, 'test')
        self.assertEqual(events[0]['progress'], 0.35)

    def test_atomic_publication_refuses_collision(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            a, b = root / 'a.png', root / 'b.png'
            temp_a, temp_b = root / 'temp_a.png', root / 'temp_b.png'
            temp_a.write_bytes(b'new a')
            temp_b.write_bytes(b'new b')
            b.write_bytes(b'existing')
            with self.assertRaises(FileExistsError):
                publish({'a': temp_a, 'b': temp_b}, {'a': a, 'b': b})
            self.assertFalse(a.exists())
            self.assertEqual(b.read_bytes(), b'existing')

    def test_unicode_image_multimap(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / '테스트 영상 이미지.png'
            rgb = np.zeros((63, 95, 3), np.uint8)
            rgb[:, :, 0] = np.arange(95) * 2
            rgb[:, :, 1] = np.arange(63)[:, None] * 3
            rgb[:, :, 2] = 128
            Image.fromarray(rgb).save(source)
            info = probe(str(source))
            self.assertEqual(info['kind'], 'image')
            kinds = ['source', 'basecolor', 'metallic', 'roughness', 'specular']
            options = {**DEFAULTS, 'maps': kinds, 'previewMap': 'basecolor'}
            result = render_project(LocalEngine(), dict(path=str(source), outputPath=str(root / '결과.png'), options=options), Job('x'))
            self.assertEqual(result['frames'], 1)
            self.assertEqual(set(result['outputPaths']), set(kinds))
            for kind, path in result['outputPaths'].items():
                with Image.open(path) as output:
                    self.assertEqual(output.size, (95, 63))
                    if kind == 'source':
                        np.testing.assert_array_equal(np.asarray(output), rgb)
            with self.assertRaises(FileExistsError):
                render_project(LocalEngine(), dict(path=str(source), outputPath=str(root / '결과.png'), options=options), Job('x'))
            preview = preview_project(LocalEngine(), dict(path=str(source), options=options, time=0), Job('x'))
            self.assertTrue(preview['image'].startswith('data:image/png;base64,'))
            self.assertEqual(set(preview['images']), set(kinds))
            self.assertFalse(any(path.name.startswith('.depthdesk') for path in root.iterdir()))

    def test_cancel_cleans_scratch(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'source.png'
            Image.new('RGB', (16, 16), (40, 120, 200)).save(source)
            job = Job('cancelled')
            job.cancel()
            with self.assertRaises(Cancelled):
                render_project(LocalEngine(), dict(path=str(source), outputPath=str(root / 'out.png'),
                                                   options={**DEFAULTS, 'maps': ['source']}), job)
            self.assertEqual([path.name for path in root.iterdir()], ['source.png'])


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg unavailable')
class VideoTests(unittest.TestCase):
    def test_real_ffmpeg_trim_maps(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / '합성 영상.mp4'
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
                            '-i', 'testsrc2=size=320x180:rate=30', '-frames:v', '30', '-c:v', 'libx264',
                            '-pix_fmt', 'yuv420p', str(source)], check=True, capture_output=True,
                           creationflags=0x08000000 if os.name == 'nt' else 0)
            options = {**DEFAULTS, 'maps': ['source', 'basecolor', 'roughness'], 'previewMap': 'source'}
            exact = Decoder(source, 10, 11, (320, 180), Job('exact'))
            seek = Decoder(source, 10, 11, (320, 180), Job('seek'), seek_fps=30)
            try:
                np.testing.assert_array_equal(exact.read(), seek.read())
            finally:
                exact.close()
                seek.close()
            result = render_project(LocalEngine(), dict(path=str(source), trimStart=5 / 30, trimEnd=15 / 30,
                                                        outputPath=str(root / '맵 출력.mp4'), options=options), Job('x'))
            self.assertEqual(result['frames'], 10)
            for path in result['outputPaths'].values():
                info = probe(path)
                self.assertEqual(info['frames'], 10)
                self.assertEqual((info['width'], info['height'], info['fps']), (320, 180, 30))
            self.assertFalse(any(path.name.startswith('.depthdesk') for path in root.iterdir()))


if __name__ == '__main__':
    unittest.main()
