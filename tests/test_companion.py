import pathlib
import sys
import time
import unittest
from unittest.mock import Mock
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'companion'))
from input_windows import valid_input
from host import Companion

class CompanionTests(unittest.TestCase):
    def make_host(self):
        h = Companion.__new__(Companion)
        h.connected = True
        h.allowed_until = 0
        h.approved = None
        h.native = Mock()
        h.status = Mock()
        return h

    def test_unsolicited_grant_never_enables_input(self):
        h = self.make_host()
        h.handle({'type': 'grant', 'request': 'fake', 'until': (time.time() + 600) * 1000})
        h.handle({'type': 'input', 'kind': 'key', 'key': 'Space'})
        h.native.execute.assert_not_called()

    def test_matching_local_approval_required_and_time_bounded(self):
        h = self.make_host()
        h.approved = ('approved-id', 'Alice', time.time() + 30)
        h.handle({'type': 'grant', 'request': 'wrong', 'until': (time.time() + 6000) * 1000})
        self.assertEqual(h.allowed_until, 0)
        h.handle({'type': 'grant', 'request': 'approved-id', 'until': (time.time() + 6000) * 1000})
        self.assertLessEqual(h.allowed_until, time.time() + 600)
        h.handle({'type': 'input', 'kind': 'key', 'key': 'Space'})
        h.native.execute.assert_called_once()

    def test_expired_or_disconnected_host_ignores_input(self):
        h = self.make_host()
        h.allowed_until = time.time() - 1
        h.handle({'type': 'input', 'kind': 'key', 'key': 'Space'})
        h.allowed_until = time.time() + 100
        h.connected = False
        h.handle({'type': 'input', 'kind': 'key', 'key': 'Space'})
        h.native.execute.assert_not_called()

    def test_host_revalidates_inputs(self):
        self.assertFalse(valid_input({'kind': 'click', 'x': float('nan'), 'y': 0, 'button': 'left'}))
        self.assertFalse(valid_input({'kind': 'open', 'url': 'https://youtube.com.evil.com/'}))
        self.assertFalse(valid_input({'kind': 'auto', 'seconds': True}))
        self.assertFalse(valid_input({'kind': 'text', 'text': 'bad\x00text'}))
        self.assertTrue(valid_input({'kind': 'open', 'url': 'https://instagram.com/reel/test/'}))

if __name__ == '__main__':
    unittest.main()
