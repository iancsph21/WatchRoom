"""Explicitly paired, foreground-only Windows companion for WATCH TALIM."""
import base64
import ctypes
import io
import json
import queue
import threading
import time
import tkinter as tk
from tkinter import messagebox, filedialog
from pathlib import Path
from urllib.parse import urlparse

import websocket
from PIL import ImageGrab
from input_windows import NativeInput, valid_input

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

class Companion:
    def __init__(self, root):
        self.root = root
        self.native = NativeInput()
        self.events = queue.Queue(maxsize=300)
        self.socket = None
        self.generation = 0
        self.connected = False
        self.allowed_until = 0
        self.approved = None
        self.auto_seconds = 0
        self.next_scroll = 0
        self.last_heartbeat = 0
        self.last_ping = 0
        self.dialog = None
        self.dialog_expires = 0
        root.title('WATCH TALIM · Host companion')
        root.geometry('520x600')
        root.configure(bg='#171820')
        root.protocol('WM_DELETE_WINDOW', self.close)
        self.label('WATCH TALIM', 25, '#d4fc84').pack(pady=(22, 4))
        self.label('talim tayo talim kami taliman tayo', 12).pack(pady=(0, 18))
        tk.Button(root, text='Open host file · automatic setup', command=self.open_host_file, bg='#d4fc84', font=('Segoe UI', 12), pady=8).pack(pady=(0, 12))
        self.label('Server address (HTTPS, or local HTTP)', 10).pack()
        self.address = tk.Entry(root, width=49, font=('Segoe UI', 11))
        self.address.insert(0, 'http://localhost:3000')
        self.address.pack(pady=7)
        self.label('One-time pairing code from your Activity', 10).pack()
        self.code = tk.Entry(root, width=49, font=('Consolas', 11), show='•')
        self.code.pack(pady=7)
        self.label('Shares your ENTIRE PRIMARY MONITOR with everyone in the room.\nUse Discord screen share separately for video and sound.', 10).pack(pady=12)
        self.start_button = tk.Button(root, text='Pair & share preview', command=self.start, bg='#d4fc84', font=('Segoe UI', 12), padx=20, pady=9)
        self.start_button.pack()
        self.status = self.label('Not sharing. Nobody has control.', 11)
        self.status.pack(pady=20)
        tk.Button(root, text='STOP SHARING & CONTROL  ·  F8', command=self.stop, bg='#f1a1b3', font=('Segoe UI', 12, 'bold'), padx=15, pady=12).pack()
        self.label('Approvals last up to 10 minutes. Disconnects revoke access.\nKeep this window open. F8 works while another app is focused.', 10).pack(pady=15)
        root.after(50, self.tick)

    def label(self, text, size, color='#d1d3df'):
        return tk.Label(self.root, text=text, bg='#171820', fg=color, font=('Segoe UI', size), wraplength=485)

    def open_host_file(self):
        path = filedialog.askopenfilename(title='Choose the host file downloaded from TALWATCH', filetypes=[('TALWATCH host file', '*.talim'), ('JSON file', '*.json')])
        if not path:
            return
        try:
            if Path(path).stat().st_size > 4096:
                raise ValueError('Invalid host file')
            data = json.loads(Path(path).read_text(encoding='utf-8'))
            if data.get('version') != 1 or not isinstance(data.get('server'), str) or not isinstance(data.get('code'), str):
                raise ValueError('Invalid host file')
            self.address.delete(0, tk.END)
            self.address.insert(0, data['server'])
            self.code.delete(0, tk.END)
            self.code.insert(0, data['code'])
            self.start()
        except (ValueError, OSError, AttributeError):
            messagebox.showerror('Cannot open host file', 'Download a new host file from your TALWATCH room and try again.')

    def post(self, generation, message):
        try:
            self.events.put_nowait((generation, message))
        except queue.Full:
            # Fail closed under congestion, never queue unbounded input.
            self.allowed_until = 0
            self.auto_seconds = 0
            if self.socket:
                self.socket.close()

    def send(self, message):
        if self.socket:
            try:
                self.socket.send(json.dumps(message))
            except Exception:
                self.allowed_until = 0
                self.auto_seconds = 0

    def start(self):
        try:
            u = urlparse(self.address.get().strip())
            if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
                raise ValueError('Enter a server origin such as https://watch.example.com')
            if u.scheme == 'http' and u.hostname not in ('localhost', '127.0.0.1'):
                raise ValueError('Remote servers require HTTPS.')
            code = self.code.get().strip()
            if len(code) != 24 or any(c not in '0123456789abcdef' for c in code):
                raise ValueError('Paste the 24-character pairing code from the Activity.')
        except ValueError as exc:
            messagebox.showerror('Check connection details', str(exc))
            return
        if not messagebox.askokcancel('Share primary monitor?', f'Your room is listed to everyone signed into this TALWATCH app. Anyone joining can see your entire primary monitor.\n\nServer: {u.netloc}\n\nClose private windows first. Remote control needs another approval. Start sharing?'):
            return
        self.stop()
        generation = self.generation
        self.start_button.configure(state='disabled')
        self.status.configure(text='Connecting…')
        address = ('wss' if u.scheme == 'https' else 'ws') + '://' + u.netloc + '/ws'
        def on_message(ws, raw):
            try:
                message = json.loads(raw)
                if isinstance(message, dict):
                    self.post(generation, message)
            except (ValueError, TypeError):
                ws.close()
        sock = websocket.WebSocketApp(address, on_open=lambda ws: ws.send(json.dumps({'type': 'host', 'code': code})), on_message=on_message,
            on_close=lambda ws, status, reason: self.post(generation, {'type': 'closed', 'reason': reason or 'Connection ended'}),
            on_error=lambda ws, error: self.post(generation, {'type': 'closed', 'reason': 'Connection failed. Check the server and pairing code.'}))
        self.socket = sock
        threading.Thread(target=sock.run_forever, kwargs={'ping_interval': 10, 'ping_timeout': 5}, daemon=True).start()
        self.code.delete(0, tk.END)

    def capture(self, generation):
        while self.connected and generation == self.generation:
            try:
                frame = ImageGrab.grab(all_screens=False)
                frame.thumbnail((1280, 800))
                data = io.BytesIO()
                frame.convert('RGB').save(data, format='JPEG', quality=55)
                if self.connected and generation == self.generation:
                    self.send({'type': 'frame', 'jpeg': base64.b64encode(data.getvalue()).decode('ascii')})
            except Exception:
                self.post(generation, {'type': 'closed', 'reason': 'Screen capture failed; sharing stopped.'})
                return
            time.sleep(0.3)

    def dismiss(self):
        if self.dialog:
            self.dialog.destroy()
            self.dialog = None

    def revoke(self):
        self.allowed_until = 0
        self.approved = None
        self.auto_seconds = 0
        self.dismiss()
        self.status.configure(text='Sharing preview. Nobody has control.' if self.connected else 'Not sharing. Nobody has control.')

    def stop(self):
        self.connected = False
        self.generation += 1
        self.revoke()
        sock, self.socket = self.socket, None
        if sock:
            threading.Thread(target=sock.close, daemon=True).start()
        self.start_button.configure(state='normal')

    def request(self, m):
        if self.allowed_until > time.time() or self.dialog:
            self.send({'type': 'decision', 'request': m.get('request'), 'allow': False})
            return
        self.dialog_expires = min(float(m.get('expires', 0)) / 1000, time.time() + 30)
        dialog = self.dialog = tk.Toplevel(self.root)
        dialog.title('WATCH TALIM · Control request')
        dialog.geometry('470x280')
        dialog.attributes('-topmost', True)
        name = str(m.get('user', {}).get('username', 'Unknown'))[:50]
        user_id = str(m.get('user', {}).get('id', ''))[:30]
        tk.Label(dialog, text=f'{name} wants to control your PC', font=('Segoe UI', 15, 'bold'), wraplength=430).pack(pady=20)
        tk.Label(dialog, text=f'Discord ID: {user_id}\n\nAllows mouse clicks, typing, browser links, and scrolling\non your primary monitor for up to 10 minutes.\nPress F8 anytime to stop sharing and control.', font=('Segoe UI', 10)).pack(pady=5)
        def answer(allow):
            if allow and time.time() < self.dialog_expires:
                self.approved = (m['request'], name, time.time() + 30)
            else:
                allow = False
            self.send({'type': 'decision', 'request': m['request'], 'allow': allow})
            self.dismiss()
        tk.Button(dialog, text='Allow control for this session', command=lambda: answer(True), bg='#d4fc84').pack(pady=8)
        tk.Button(dialog, text='Decline', command=lambda: answer(False)).pack()
        dialog.protocol('WM_DELETE_WINDOW', lambda: answer(False))

    def handle(self, m):
        kind = m.get('type')
        if kind == 'paired':
            self.connected = True
            self.last_heartbeat = time.time()
            self.status.configure(text=f"Sharing preview · {m.get('members', 0)} viewer(s) at pairing.\nNobody has control.")
            threading.Thread(target=self.capture, args=(self.generation,), daemon=True).start()
        elif kind == 'heartbeat':
            self.last_heartbeat = time.time()
        elif kind == 'request' and self.connected:
            self.request(m)
        elif kind == 'grant' and self.approved and m.get('request') == self.approved[0] and self.approved[2] > time.time():
            self.allowed_until = min(float(m.get('until', 0)) / 1000, time.time() + 600)
            self.status.configure(text=f'{self.approved[1]} has PC control.\nF8 stops sharing and control immediately.')
            self.approved = None
        elif kind == 'revoke':
            self.revoke()
        elif kind == 'input' and self.connected and self.allowed_until > time.time() and valid_input(m):
            if m['kind'] == 'auto':
                self.auto_seconds = m['seconds']
                self.next_scroll = time.time() + self.auto_seconds
            else:
                self.native.execute(m)
        elif kind == 'closed':
            self.stop()
            self.status.configure(text=str(m.get('reason', 'Disconnected'))[:130])

    def tick(self):
        try:
            if self.native.emergency_pressed():
                self.stop()
            now = time.time()
            if self.connected and now - self.last_heartbeat > 8:
                self.stop()
                self.status.configure(text='Connection timed out. Sharing and control stopped.')
            if self.allowed_until and now >= self.allowed_until:
                self.revoke()
                self.send({'type': 'revoke'})
            if self.dialog and now >= self.dialog_expires:
                self.dismiss()
            for _ in range(20):
                try:
                    generation, message = self.events.get_nowait()
                except queue.Empty:
                    break
                if generation == self.generation:
                    self.handle(message)
            if self.connected and now - self.last_ping > 2:
                self.last_ping = now
                self.send({'type': 'heartbeat'})
            if self.auto_seconds and self.allowed_until > now and now >= self.next_scroll:
                if self.native.browser_in_front():
                    self.native.key(0x28)
                self.next_scroll = now + self.auto_seconds
        except Exception:
            self.stop()
            self.status.configure(text='Companion error. Sharing and control stopped; reconnect to retry.')
        self.root.after(50, self.tick)

    def close(self):
        self.stop()
        self.root.destroy()

if __name__ == '__main__':
    app = tk.Tk()
    Companion(app)
    app.mainloop()
