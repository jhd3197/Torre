import unittest

from torre.tools import changelog

TEXT = """# Changelog

Intro.

## Unreleased

### Added

- A thing.

## 0.3.0 - 2026-09-01

- An old thing.
"""


class StampTests(unittest.TestCase):
    def test_moves_unreleased_notes_under_the_version(self):
        text = changelog.stamp(TEXT, '0.4.0', '2026-10-13')
        self.assertIn('## Unreleased\n\n## 0.4.0 - 2026-10-13\n\n### Added\n\n- A thing.\n\n## 0.3.0', text)
        self.assertEqual(changelog.unreleased(text)[1], '')
        self.assertEqual(changelog.section(text, '0.3.0'), '- An old thing.')

    def test_a_rerun_keeps_newer_unreleased_notes(self):
        text = changelog.stamp(TEXT, '0.4.0', '2026-10-13').replace('## Unreleased\n', '## Unreleased\n\n- Newer.\n')
        self.assertEqual(changelog.stamp(text, '0.4.0', '2026-10-14'), text)

    def test_empty_notes_say_so(self):
        text = changelog.stamp(changelog.stamp(TEXT, '0.4.0', '2026-10-13'), '0.4.1', '2026-10-14')
        self.assertEqual(changelog.section(text, '0.4.1'), changelog.EMPTY)

    def test_needs_an_unreleased_section(self):
        with self.assertRaises(ValueError):
            changelog.stamp('# Changelog\n', '0.4.0', '2026-10-13')


class NotesTests(unittest.TestCase):
    def test_lists_downloads_by_system(self):
        text = changelog.stamp(TEXT, '0.4.0', '2026-10-13')
        assets = [{'name': 'Torre_0.4.0_x64-setup.exe', 'size': 3 << 20}, {'name': 'Torre_0.4.0_amd64.deb', 'size': 2 << 20},
                  {'name': 'torre-0.4.0-py3-none-any.whl', 'size': 1 << 20}]
        notes = changelog.notes(text, '0.4.0', assets, 'jhd3197/Torre', 'v0.3.0')
        self.assertTrue(notes.startswith('### Added\n\n- A thing.\n'))
        self.assertIn('[`Torre_0.4.0_x64-setup.exe`](https://github.com/jhd3197/Torre/releases/download/v0.4.0/'
                      'Torre_0.4.0_x64-setup.exe) | 3 MB |', notes)
        self.assertIn('**Linux**', notes)
        self.assertNotIn('**macOS**', notes)  # no disk image was built
        self.assertIn('pip install torre==0.4.0', notes)
        self.assertIn('compare/v0.3.0...v0.4.0', notes)

    def test_needs_the_stamped_section(self):
        with self.assertRaises(ValueError):
            changelog.notes(TEXT, '0.4.0', [], 'jhd3197/Torre')


if __name__ == '__main__':
    unittest.main()
