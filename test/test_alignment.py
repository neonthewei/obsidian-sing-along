import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from alignment_utils import estimate_lines, normalize


class AlignmentTests(unittest.TestCase):
    def test_repeated_choruses_remain_in_order_and_ignore_intro_outro(self):
        words = [
            {'word': '前奏', 'start': 0, 'end': 2},
            {'word': '甲乙', 'start': 10, 'end': 12},
            {'word': '丙丁', 'start': 14, 'end': 16},
            {'word': '甲乙', 'start': 30, 'end': 32},
            {'word': '片尾', 'start': 40, 'end': 42},
        ]
        result = estimate_lines(['甲乙', '丙丁', '甲乙'], [{'words': words}])
        self.assertEqual([r['start'] for r in result], [10, 14, 30])
        self.assertEqual([r['end'] for r in result], [12, 16, 32])

    def test_missing_first_words_do_not_anchor_to_unrelated_intro(self):
        line = 'あの日のことは忘れてね幼すぎて知らなかった'
        segments = [{'words': [
            {'word': '作詞作曲編曲初音ミク', 'start': 7.4, 'end': 7.6},
            {'word': '忘れてね幼すぎて知らなかった', 'start': 30.28, 'end': 38.08},
        ]}]
        result = estimate_lines([line], segments)[0]
        self.assertEqual(result['start'], 30.28)
        self.assertEqual(result['prefix'], len('あの日のことは'))
        self.assertEqual(result['end'], 38.08)

    def test_normalizes_width_and_punctuation(self):
        self.assertEqual(normalize('４００ 円、'), '400円')

    def test_refuses_unrelated_audio(self):
        with self.assertRaises(ValueError):
            estimate_lines(['甲乙丙丁'], [{'words': [{'word': '完全不同', 'start': 1, 'end': 3}]}])

    def test_caps_work_before_allocating_trace_matrix(self):
        with self.assertRaises(ValueError):
            estimate_lines(['甲' * 4000], [{'words': [{'word': '甲' * 4000, 'start': 0, 'end': 10}]}])


if __name__ == '__main__':
    unittest.main()
