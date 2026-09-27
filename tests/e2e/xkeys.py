"""Send real keystrokes to the X display (XTEST), e.g. `python3 xkeys.py ctrl+t`.

Used by the e2e suite on Linux: Playwright's synthetic key events bypass
Electron's before-input-event hook, so shortcuts need genuine input.
"""
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

NAMES = {'ctrl': 'Control_L', 'shift': 'Shift_L', 'alt': 'Alt_L', 'meta': 'Super_L', 'esc': 'Escape', 'enter': 'Return', 'tab': 'Tab'}


def press(d, combo):
    keys = [NAMES.get(k.lower(), k) for k in combo.split('+')]
    codes = [d.keysym_to_keycode(XK.string_to_keysym(k)) for k in keys]
    for c in codes:
        xtest.fake_input(d, X.KeyPress, c)
    for c in reversed(codes):
        xtest.fake_input(d, X.KeyRelease, c)
    d.sync()


if __name__ == '__main__':
    d = display.Display()
    for combo in sys.argv[1:]:
        press(d, combo)
        time.sleep(0.15)
