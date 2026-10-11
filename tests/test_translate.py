"""The translation checks and clean-ups (translate_content.py) that stand between a model and the app."""
import unittest

from scripts import translate_content as tc


class CheckTests(unittest.TestCase):
    def test_a_translation_must_keep_cues_squares_moves_and_placeholders(self):
        english = 'Knight to d4 attacks the queen. [move] Then Nxc2+ wins {{count}} <strong>pawns</strong>.'
        good = 'El caballo a d4 ataca a la dama. [move] Luego Nxc2+ gana {{count}} <strong>peones</strong>.'
        self.assertEqual(tc.problems(english, good), [])
        self.assertIn('[move] cues', tc.problems(english, good.replace(' [move]', '')))
        self.assertIn('square names', tc.problems(english, good.replace('d4', 'd5')))
        self.assertIn('move notation', tc.problems(english, good.replace('Nxc2+', 'Cxc2+')))
        self.assertIn('{{placeholders}}', tc.problems(english, good.replace('{{count}}', '{{n}}')))
        self.assertIn('em dash', tc.problems(english, good.replace('. ', ' — ', 1)))

    def test_tidy_fixes_what_models_often_get_wrong(self):
        self.assertEqual(tc.tidy('¡Cápturalo con tu torre. Bien  hecho — sí.'), '¡Captúralo con tu torre! Bien hecho, sí.')

    def test_prompt_shaped_leftovers_are_removed(self):
        self.assertEqual(tc.strip_artifacts('Meet the king.', '4. "Conoce *al* rey."'), 'Conoce al rey.')
        self.assertEqual(tc.strip_artifacts('1. e4 is popular.', '1. e4 es popular.'), '1. e4 es popular.')


if __name__ == '__main__':
    unittest.main()


class VoiceLineTests(unittest.TestCase):
    def test_every_voice_json_line_is_recorded_in_both_languages(self):
        from scripts import narrate
        # voice.json is written natively per language; each language's file is recorded in full.
        self.assertIn('Another one bites the dust!', narrate.all_lines('en'))
        self.assertIn('¡Otro que muerde el polvo!', narrate.all_lines('es'))
        self.assertIn('¡Gambito Botez en vivo!', narrate.all_lines('es'))
