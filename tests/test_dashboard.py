"""Transport regression checks; the peer below is explicitly a test double."""
import json
import socket
import threading
import time
import unittest
from dashboard_server import SerialBridge, valid_state

STATE = {"light": {"on": True, "brightness": 70}, "fan": {"on": True, "speed": 60}, "source": "TEST"}

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.bridge = SerialBridge(self.listener.getsockname()[1])
        self.bridge.start()
        self.peer, _ = self.listener.accept()
        self.peer.settimeout(2)
        self.reader = self.peer.makefile("rb")

    def tearDown(self):
        self.reader.close()
        self.peer.close()
        self.listener.close()
        self.bridge.close()

    def wait_for(self, predicate):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(.01)
        self.fail("Timed out")

    def ready(self):
        self.assertEqual(self.reader.readline(), b"STATE\n")
        self.peer.sendall((json.dumps(STATE) + "\n").encode())
        self.wait_for(lambda: self.bridge.snapshot()["connected"])

    def test_port_is_not_device_confirmation(self):
        self.assertFalse(self.bridge.snapshot()["connected"])
        with self.assertRaises(ConnectionError):
            self.bridge.command("LIGHT_ON")

    def test_fragmented_json_and_telnet(self):
        self.reader.readline()
        self.peer.sendall(b"\xff\xfb\x2c\xff\xfa\x2c\x65\x00\xff\xf0")
        payload = (json.dumps(STATE) + "\n").encode()
        self.peer.sendall(payload[:20])
        time.sleep(.03)
        self.assertFalse(self.bridge.snapshot()["connected"])
        self.peer.sendall(payload[20:])
        self.wait_for(lambda: self.bridge.snapshot()["connected"])

    def test_command_requires_matching_ack(self):
        self.ready()
        result = []
        worker = threading.Thread(target=lambda: result.append(self.bridge.command("LIGHT_LEVEL:35")))
        worker.start()
        line = self.reader.readline()
        while line == b"STATE\n":
            line = self.reader.readline()
        self.assertEqual(line, b"@1 LIGHT_LEVEL:35\n")
        new_state = json.loads(json.dumps(STATE))
        new_state["light"]["brightness"] = 35
        # Unsolicited state and wrong acknowledgement must NOT confirm a command.
        self.peer.sendall((json.dumps(new_state) + "\n" + json.dumps({"ack": 999, "state": new_state}) + "\n").encode())
        time.sleep(.05)
        self.assertEqual(result, [])
        self.peer.sendall((json.dumps({"ack": 1, "state": new_state}) + "\n").encode())
        worker.join(2)
        self.assertEqual(result[0]["light"]["brightness"], 35)

    def test_disconnect_invalidates_state_and_reconnects(self):
        self.ready()
        self.peer.shutdown(socket.SHUT_RDWR)
        self.wait_for(lambda: not self.bridge.snapshot()["connected"])
        peer, _ = self.listener.accept()
        with peer:
            peer.settimeout(2)
            self.assertIn(b"STATE", peer.recv(1024))
            peer.sendall((json.dumps(STATE) + "\n").encode())
            self.wait_for(lambda: self.bridge.snapshot()["connected"])

    def test_schema(self):
        self.assertTrue(valid_state(STATE))
        self.assertFalse(valid_state({"light": {"on": "true"}, "fan": {}}))

if __name__ == "__main__":
    unittest.main()
