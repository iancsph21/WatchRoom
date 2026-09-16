"""Windows input adapter. No shell commands, clipboard access, or elevated process."""
import ctypes
from ctypes import wintypes
from urllib.parse import urlparse
import os
import webbrowser

KEYS = {'Space': 0x20, 'ArrowDown': 0x28, 'ArrowUp': 0x26, 'ArrowLeft': 0x25,
        'ArrowRight': 0x27, 'Enter': 0x0D, 'Escape': 0x1B, 'Backspace': 0x08,
        'Tab': 0x09, 'Home': 0x24, 'End': 0x23}

def valid_input(m):
    kind = m.get('kind')
    if kind == 'click':
        return all(type(m.get(k)) in (int, float) and 0 <= m[k] <= 1 for k in ('x', 'y')) and m.get('button') in ('left', 'right')
    if kind == 'scroll':
        return type(m.get('amount')) is int and abs(m['amount']) <= 5
    if kind == 'key':
        return m.get('key') in KEYS
    if kind == 'text':
        t = m.get('text')
        return isinstance(t, str) and 0 < len(t) <= 200 and all(ord(c) >= 32 and ord(c) != 127 for c in t)
    if kind == 'auto':
        n = m.get('seconds')
        return type(n) is int and (n == 0 or 5 <= n <= 60)
    if kind == 'open':
        try:
            u = urlparse(m.get('url', ''))
            return u.scheme == 'https' and not u.username and not u.password and not u.port and u.hostname in ('youtube.com', 'www.youtube.com', 'youtu.be', 'instagram.com', 'www.instagram.com')
        except (ValueError, TypeError):
            return False
    return False

class NativeInput:
    def __init__(self):
        if os.name != 'nt':
            raise RuntimeError('The companion currently supports Windows only.')
        self.user = ctypes.WinDLL('user32', use_last_error=True)
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.user.GetForegroundWindow.restype = wintypes.HWND
        self.user.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
        self.kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
        self.kernel.CloseHandle.argtypes = (wintypes.HANDLE,)

    def emergency_pressed(self):
        return bool(self.user.GetAsyncKeyState(0x77) & 0x8000)  # F8

    def browser_in_front(self):
        pid = wintypes.DWORD()
        self.user.GetWindowThreadProcessId(self.user.GetForegroundWindow(), ctypes.byref(pid))
        handle = self.kernel.OpenProcess(0x1000, False, pid.value)
        if not handle:
            return False
        try:
            size = wintypes.DWORD(32768)
            buf = ctypes.create_unicode_buffer(size.value)
            return bool(self.kernel.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size))) and os.path.basename(buf.value).lower() in ('chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe')
        finally:
            self.kernel.CloseHandle(handle)

    def key(self, code):
        self.user.keybd_event(code, 0, 0, 0)
        self.user.keybd_event(code, 0, 2, 0)

    def text(self, text):
        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [('wVk', wintypes.WORD), ('wScan', wintypes.WORD), ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [('dx', wintypes.LONG), ('dy', wintypes.LONG), ('mouseData', wintypes.DWORD), ('dwFlags', wintypes.DWORD), ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
        class INPUTUNION(ctypes.Union):
            _fields_ = [('ki', KEYBDINPUT), ('mi', MOUSEINPUT)]
        class INPUT(ctypes.Structure):
            _fields_ = [('type', wintypes.DWORD), ('u', INPUTUNION)]
        encoded = text.encode('utf-16-le', errors='replace')
        for i in range(0, len(encoded), 2):
            scan = int.from_bytes(encoded[i:i+2], 'little')
            events = (INPUT * 2)(INPUT(1, INPUTUNION(ki=KEYBDINPUT(0, scan, 4, 0, 0))), INPUT(1, INPUTUNION(ki=KEYBDINPUT(0, scan, 6, 0, 0))))
            self.user.SendInput(2, events, ctypes.sizeof(INPUT))

    def execute(self, m):
        if not valid_input(m):
            return
        kind = m['kind']
        if kind == 'click':
            width, height = self.user.GetSystemMetrics(0), self.user.GetSystemMetrics(1)
            self.user.SetCursorPos(round(m['x'] * (width - 1)), round(m['y'] * (height - 1)))
            down, up = (2, 4) if m['button'] == 'left' else (8, 16)
            self.user.mouse_event(down, 0, 0, 0, 0)
            self.user.mouse_event(up, 0, 0, 0, 0)
        elif kind == 'scroll':
            self.user.mouse_event(0x0800, 0, 0, m['amount'] * 120, 0)
        elif kind == 'key':
            self.key(KEYS[m['key']])
        elif kind == 'text':
            self.text(m['text'])
        elif kind == 'open':
            webbrowser.open(m['url'], new=2)
