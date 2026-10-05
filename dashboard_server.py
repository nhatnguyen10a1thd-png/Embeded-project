"""Local dashboard host. Commands succeed only after matching ESP32 feedback."""
import argparse
import json
import mimetypes
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "web-dashboard"
COMMAND = re.compile(r"(?:LIGHT_ON|LIGHT_OFF|FAN_ON|FAN_OFF|ALL_OFF|LIGHT_LEVEL:(?:100|[0-9]{1,2})|FAN_SPEED:(?:100|[0-9]{1,2}))\Z")

def valid_state(value):
    if not isinstance(value, dict):
        return False
    for name, level in (("light", "brightness"), ("fan", "speed")):
        device = value.get(name, {})
        if not isinstance(device, dict) or type(device.get("on")) is not bool:
            return False
        if type(device.get(level)) is not int or not 0 <= device[level] <= 100:
            return False
    return True

class SerialBridge:
    def __init__(self, port):
        self.port = port
        self.condition = threading.Condition()
        self.command_lock = threading.Lock()
        self.write_lock = threading.Lock()
        self.sock = None
        self.state = None
        self.received_at = 0
        self.request_id = 0
        self.acks = {}
        self.error = "Chưa mở Wokwi: chọn Wokwi: Start Simulator trong VS Code."
        self.stop = threading.Event()
        self.worker = threading.Thread(target=self.run, daemon=True)

    def start(self):
        self.worker.start()

    def close(self):
        self.stop.set()
        with self.write_lock:
            if self.sock:
                self.sock.close()
        self.worker.join(timeout=2)

    def write(self, line):
        with self.write_lock:
            if self.sock is None:
                raise ConnectionError("Wokwi chưa chạy hoặc đã dừng.")
            self.sock.sendall((line + "\n").encode("ascii"))

    def accept_line(self, line):
        try:
            value = json.loads(line[line.index(b"{"):])
        except (ValueError, UnicodeError):
            return
        state = value.get("state") if "ack" in value else value
        if not valid_state(state):
            return
        with self.condition:
            self.state = state
            self.received_at = time.monotonic()
            self.error = ""
            if type(value.get("ack")) is int:
                self.acks[value["ack"]] = state
                if len(self.acks) > 32:
                    del self.acks[next(iter(self.acks))]
            self.condition.notify_all()

    def run(self):
        while not self.stop.is_set():
            try:
                conn = socket.create_connection(("127.0.0.1", self.port), timeout=0.5)
                conn.settimeout(0.2)
                with self.write_lock:
                    self.sock = conn
                with self.condition:
                    self.received_at = 0
                    self.acks.clear()
                    self.error = "Đã mở cổng Wokwi, đang chờ ESP32. Kiểm tra nút Play và dây TX0/RX0."
                line = bytearray()
                telnet = 0
                last_query = 0
                while not self.stop.is_set():
                    now = time.monotonic()
                    if now - last_query >= 1:
                        self.write("STATE")
                        last_query = now
                    try:
                        data = conn.recv(8192)
                    except socket.timeout:
                        continue
                    if not data:
                        raise ConnectionError("Wokwi đã ngắt kết nối.")
                    # RFC2217 escapes IAC and may include Telnet negotiation.
                    for byte in data:
                        if telnet == 1:
                            if byte == 255:
                                telnet = 0
                            elif byte == 250:
                                telnet = 3
                                continue
                            elif byte in (251, 252, 253, 254):
                                telnet = 2
                                continue
                            else:
                                telnet = 0
                                continue
                        elif telnet == 2:
                            telnet = 0
                            continue
                        elif telnet == 3:
                            if byte == 255:
                                telnet = 4
                            continue
                        elif telnet == 4:
                            telnet = 0 if byte == 240 else 3
                            continue
                        elif byte == 255:
                            telnet = 1
                            continue
                        if byte == 10:
                            self.accept_line(bytes(line).strip())
                            line.clear()
                        elif byte != 13:
                            line.append(byte)
                            if len(line) > 16384:
                                line.clear()
            except OSError:
                with self.condition:
                    self.received_at = 0
                    self.error = f"Chưa có mô phỏng tại cổng {self.port}. Mở wokwi-sim/diagram.json rồi chọn Wokwi: Start Simulator."
                    self.condition.notify_all()
            finally:
                with self.write_lock:
                    if self.sock:
                        self.sock.close()
                    self.sock = None
            self.stop.wait(0.5)

    def snapshot(self):
        with self.condition:
            connected = self.received_at > 0 and time.monotonic() - self.received_at < 5
            error = self.error or "ESP32 không phản hồi. Kiểm tra mô phỏng có đang tạm dừng không."
            return dict(connected=connected, state=self.state, transport="wokwi-rfc2217",
                        bridgeError="" if connected else error)

    def command(self, command):
        with self.command_lock:
            if not self.snapshot()["connected"]:
                raise ConnectionError(self.snapshot()["bridgeError"])
            with self.condition:
                self.request_id += 1
                request_id = self.request_id
            self.write(f"@{request_id} {command}")
            deadline = time.monotonic() + 3
            with self.condition:
                while request_id not in self.acks:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or self.received_at == 0:
                        raise TimeoutError("ESP32 chưa xác nhận lệnh. Build firmware mới và khởi động lại Wokwi.")
                    self.condition.wait(remaining)
                return self.acks.pop(request_id)

class HttpBridge:
    def __init__(self, url):
        self.url = url.rstrip("/")
    def request(self, path, method="GET"):
        with urllib.request.urlopen(urllib.request.Request(self.url + path, method=method), timeout=3) as response:
            state = json.load(response)
        if not valid_state(state):
            raise ValueError("ESP32 trả trạng thái không hợp lệ.")
        return state
    def snapshot(self):
        try:
            return dict(connected=True, state=self.request("/api/state"), transport="http", bridgeError="")
        except (OSError, ValueError):
            return dict(connected=False, state=None, transport="http", bridgeError="Không kết nối được ESP32 qua WiFi.")
    def command(self, command):
        return self.request("/api/command?value=" + urllib.parse.quote(command), "POST")

def handler_for(bridge):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def reply(self, status, value, content_type="application/json; charset=utf-8"):
            body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            if path == "/api/state":
                return self.reply(200, bridge.snapshot())
            if path == "/api/health":
                return self.reply(200, {"app": "gesture-dashboard", "version": 2})
            target = (ROOT / (urllib.parse.unquote(path).lstrip("/") or "index.html")).resolve()
            if not target.is_relative_to(ROOT) or not target.is_file():
                return self.reply(404, {"error": "Not found"})
            mime = "text/javascript" if target.suffix == ".js" else mimetypes.guess_type(target)[0] or "application/octet-stream"
            self.reply(200, target.read_bytes(), mime)
        def do_POST(self):
            if self.path != "/api/command":
                return self.reply(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024:
                    raise ValueError("Request quá lớn hoặc rỗng.")
                body = json.loads(self.rfile.read(length))
                command = body.get("command") if isinstance(body, dict) else None
                if not isinstance(command, str) or not COMMAND.fullmatch(command):
                    raise ValueError("Lệnh không hợp lệ.")
            except (ValueError, UnicodeError) as error:
                return self.reply(400, {"ok": False, "error": str(error)})
            try:
                state = bridge.command(command)
                self.reply(200, {"ok": True, "confirmed": True, "state": state})
            except (OSError, ValueError) as error:
                self.reply(503, {"ok": False, "error": str(error)})
    return Handler

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--serial-port", type=int, default=4000)
    parser.add_argument("--esp32-url")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    bridge = HttpBridge(args.esp32_url) if args.esp32_url else SerialBridge(args.serial_port)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(bridge))
    except OSError:
        raise SystemExit(f"Cong {args.port} dang duoc dung. Dung server cu hoac dung -Port 8081.")
    if isinstance(bridge, SerialBridge):
        bridge.start()
    print(f"Dashboard: http://localhost:{args.port} | Ctrl+C de dung", flush=True)
    if not args.no_browser:
        webbrowser.open(f"http://localhost:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if isinstance(bridge, SerialBridge):
            bridge.close()

if __name__ == "__main__":
    main()
