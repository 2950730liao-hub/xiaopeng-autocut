import unittest

import numpy as np

from prepare import FPS, make_clips, map_words, quiet_cuts, retakes
from analyze import normalize


class LocalCuts(unittest.TestCase):
    def test_unaligned_tail_keeps_text_and_retake_requires_quiet(self):
        words, _ = normalize([{"words": [
            {"word":"后","start":0,"end":.2},
            {"word":"补","start":.2,"end":.2},
            {"word":"后句","start":.7,"end":1.4},
        ]}], 1.5)
        self.assertEqual(words[0]["text"],"后补")
        self.assertTrue(words[0]["unaligned"])
        request = [{"from":0,"to":1,"keepFrom":1,"keepTo":2,"reason":"前次错起句"}]
        cuts, held = retakes(words, request,45,np.ones(45))
        self.assertFalse(cuts)
        self.assertEqual(held[0]["words"],[0,1])
        quiet=np.ones(45)
        quiet[8:12]=0
        cuts, held=retakes(words,request,45,quiet)
        self.assertFalse(held)
        clips, _=make_clips(cuts,45)
        self.assertEqual([row["text"] for row in map_words(words,clips,cuts)],["后句"])

    def test_only_longest_quiet_run_is_removed_with_word_padding(self):
        words=[{"start":.2,"end":.8},{"start":1.5,"end":2.0}]
        strength=np.ones(60)
        strength[27:31]=0
        strength[33:40]=0
        result=quiet_cuts(strength,strength,words,2*FPS)
        self.assertEqual([(cut["start"],cut["end"]) for cut in result],[(33,40)])

    def test_retained_replacement_cannot_be_removed_by_another_edit(self):
        words=[{"start":i*.6,"end":i*.6+.3} for i in range(3)]
        with self.assertRaisesRegex(ValueError,"replacement"):
            retakes(words,[
                {"from":0,"to":1,"keepFrom":1,"keepTo":2,"reason":"第一次"},
                {"from":1,"to":2,"keepFrom":2,"keepTo":3,"reason":"第二次"},
            ],60,np.zeros(60))

if __name__=="__main__":
    unittest.main()
