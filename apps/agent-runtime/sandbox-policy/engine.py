"""Start the two local bridges and supervise the engine inside the session PID namespace."""
import json
import os
import resource
import socket
import subprocess
import sys
import time


gateway, callback, file_bytes, *command = sys.argv[1:]
with os.fdopen(4) as config:
    environment = json.load(config)

resource.setrlimit(resource.RLIMIT_FSIZE, (int(file_bytes), int(file_bytes)))
for port, name in [(gateway, "gateway"), (callback, "callback")]:
    bridge = subprocess.Popen(
        ["/usr/bin/socat", f"TCP4-LISTEN:{port},bind=127.0.0.1,fork", f"UNIX-CONNECT:/relay/{name}.sock"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 5
    while True:
        if bridge.poll() is not None or time.monotonic() >= deadline:
            sys.exit(f"network bridge: {name} failed to listen on {port}")
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", int(port))) == 0:
                break
        time.sleep(0.01)

# Reap orphaned descendants as PID 1. Exiting PID 1 ends the whole namespace.
engine = subprocess.Popen(command, env=environment, pass_fds=(3,))
os.close(3)
while True:
    pid, status = os.wait()
    if pid == engine.pid:
        code = os.waitstatus_to_exitcode(status)
        os.write(5, str(code).encode("ascii"))
        sys.exit(code if code >= 0 else 128 - code)
