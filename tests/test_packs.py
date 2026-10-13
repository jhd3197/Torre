"""Voice packs: build, list, install from a local source, serve, remove."""
import hashlib
import json
import os
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from torre.voice import narrate
from torre.learning import packs
class VoiceKeyTests(unittest.TestCase):
    def test_matches_the_app(self):
        # The same vectors as web/src/lib/voice.test.ts: both sides must name a line identically.
        self.assertEqual(narrate.voice_key('Nice find!'), '6ce42dc40718a532')
        self.assertEqual(narrate.voice_key('  ¡Muy bien!  '), 'cbe9f098cd2180c4')


class CommentaryLineTests(unittest.TestCase):
    """The review commentary is spoken from recorded parts, so every value a template can take is recorded."""

    def test_templates_expand_over_their_domains(self):
        for lang, examples in {
            'en': ['knight takes on f5', 'pawn to a8', '82 percent accuracy.', 'There was mate in 7 here.',
                   '45 seconds', 'on move 80', 'This is the Sicilian Defense.', 'Free knight! Thanks for that.'],
            'es': ['caballo captura en f5', '82 por ciento de precisión.', 'Apertura: Sicilian Defense.'],
        }.items():
            lines = set(narrate.commentary_lines(lang))
            for example in examples:
                self.assertIn(example, lines)
            self.assertFalse([line for line in lines if '{{' in line])
        self.assertIn('knight takes on f5', narrate.all_lines('en'))

    def test_openings_are_named_by_family(self):
        families = narrate.opening_families()
        self.assertIn('French Defense', families)
        self.assertFalse([name for name in families if ':' in name or ',' in name])


class CoachVoiceTests(unittest.TestCase):
    """A female and a male coach per language, each its own pack and audio folder."""

    def test_each_language_has_both_voices_in_their_own_folders(self):
        for lang in ('en', 'es'):
            self.assertEqual(set(narrate.VOICES[lang]), {'female', 'male'})
            self.assertNotEqual(narrate.VOICES[lang]['female'], narrate.VOICES[lang]['male'])
        self.assertEqual((narrate.pack_folder('en', 'female'), narrate.pack_folder('es', 'male')), ('en', 'es-male'))

    def test_the_male_voice_is_served_from_its_own_pack(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'packs' / 'voice-en-male'
            folder.mkdir(parents=True)
            (folder / 'abc.mp3').write_bytes(b'ID3male')
            self.assertEqual(packs.audio_file(tmp, 'en-male', 'abc.mp3').read_bytes(), b'ID3male')
            self.assertIsNone(packs.audio_file(tmp, 'en', 'abc.mp3'))
            self.assertIsNone(packs.audio_file(tmp, 'en-robot', 'abc.mp3'))


class PackInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.source, self.data = root / 'release', root / 'data'
        self.source.mkdir()
        zip_path = self.source / 'voice-es.zip'
        with zipfile.ZipFile(zip_path, 'w') as archive:
            archive.writestr('manifest.json', json.dumps({'lang': 'es', 'lines': {'abc': {'text': 'Hola'}}}))
            archive.writestr('abc.mp3', b'ID3fake')
        data = zip_path.read_bytes()
        (self.source / 'packs.json').write_text(json.dumps({'packs': [
            {'id': 'voice-es', 'lang': 'es', 'file': 'voice-es.zip', 'bytes': len(data), 'version': '1',
             'sha256': hashlib.sha256(data).hexdigest()}]}), encoding='utf-8')
        os.environ['CHESS_PACKS_URL'] = str(self.source)
        packs._catalog.update(at=0.0, url=None)

    def tearDown(self):
        os.environ.pop('CHESS_PACKS_URL', None)
        self.tmp.cleanup()

    def install(self):
        job = packs.PackJob()
        job.start(self.data, 'voice-es')
        job.thread.join(10)
        return job.status()

    def test_install_serve_and_remove(self):
        self.assertEqual([p['id'] for p in packs.available()], ['voice-es'])
        status = self.install()
        self.assertIsNone(status['error'])
        self.assertIn('voice-es', packs.installed(self.data))
        self.assertEqual(packs.audio_file(self.data, 'es', 'abc.mp3').read_bytes(), b'ID3fake')
        self.assertIsNone(packs.audio_file(self.data, 'es', '../settings.json'))
        packs.remove(self.data, 'voice-es')
        self.assertEqual(packs.installed(self.data), {})

    def test_a_republished_pack_shows_as_outdated(self):
        from torre.server import studio
        self.install()
        studio.use_data_dir(self.data)
        self.assertTrue(packs.view(self.data)['packs'][0]['current'])
        # The same release tag, a new zip (one line re-recorded): same date, different sha256.
        listing = json.loads((self.source / 'packs.json').read_text(encoding='utf-8'))
        listing['packs'][0]['sha256'] = '0' * 64
        (self.source / 'packs.json').write_text(json.dumps(listing), encoding='utf-8')
        packs._catalog.update(at=0.0, url=None)
        view = packs.view(self.data)['packs'][0]
        self.assertTrue(view['installed'])
        self.assertFalse(view['current'])

    def test_a_damaged_download_is_refused(self):
        (self.source / 'voice-es.zip').write_bytes(b'not the published zip')
        with self.assertLogs('torre.learning.packs', 'WARNING'):
            status = self.install()
        self.assertIn('damaged', status['error'])
        self.assertEqual(packs.installed(self.data), {})

    def test_install_missing_installs_once(self):
        # torre.sh fills one shared folder this way when it starts.
        self.assertEqual(packs.install_missing(self.data), ['voice-es'])
        self.assertEqual(packs.audio_file(self.data, 'es', 'abc.mp3').read_bytes(), b'ID3fake')
        self.assertEqual(packs.install_missing(self.data), [])

    def test_install_missing_skips_a_damaged_pack(self):
        (self.source / 'voice-es.zip').write_bytes(b'not the published zip')
        with self.assertLogs('torre.learning.packs', 'WARNING'):
            self.assertEqual(packs.install_missing(self.data), [])
        self.assertEqual(packs.installed(self.data), {})


if __name__ == '__main__':
    unittest.main()
