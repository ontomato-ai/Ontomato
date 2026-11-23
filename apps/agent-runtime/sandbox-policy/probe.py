import errno
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from urllib.request import urlopen

uid, gateway, callback, *denied = os.environ["PROBE"].split()
print("probe: Docker capability/seccomp", flush=True)
status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines())
assert os.getuid() == os.geteuid() == int(uid)
assert os.getgid() == os.getegid() == int(uid)
assert int(status["CapEff"], 16) == 0
assert status["NoNewPrivs"].strip() == "1"
print("identity: uid/gid dropped, CapEff=0, NoNewPrivs=1", flush=True)


def readonly(file):
    try:
        Path(file).write_text("unexpected write")
    except OSError as error:
        assert error.errno == errno.EROFS, (file, error)
    else:
        raise AssertionError(f"wrote read-only file: {file}")


print("probe: mounts", flush=True)
assert Path("/skills/selected/SKILL.md").read_text() == "selected"
for file in ["/skills/selected/SKILL.md", "/etc/passwd", "/usr/local/lib/ontomato-sandbox/probe.py"]:
    readonly(file)
for file in ["/workspace/outputs/probe", "/workspace/home/probe", "/workspace/tmp/probe",
             "/workspace/work/probe", "/native/probe"]:
    Path(file).write_text("writable")
for file in ["/data", "/app", "/skills/unselected", "/workspace/other-session"]:
    assert not os.path.lexists(file), file
print("mounts: only selected skill and system files are readable; session, native state and project writable", flush=True)

print("probe: network bridge", flush=True)
interfaces = subprocess.check_output(["/usr/sbin/ip", "-j", "link"], text=True)
assert [interface["ifname"] for interface in json.loads(interfaces)] == ["lo"]
assert subprocess.check_output(["/usr/sbin/ip", "route"], text=True).strip() == ""
assert subprocess.check_output(["/usr/sbin/ip", "-6", "route", "show", "default"], text=True).strip() == ""
for url, message in [(gateway, b"gateway"), (callback, b"callback")]:
    with urlopen(url, timeout=2) as response:
        assert response.read() == message, url
for endpoint in denied:
    host, port = endpoint.rsplit(":", 1)
    try:
        sock = socket.create_connection((host, int(port)), timeout=1)
    except OSError:
        pass
    else:
        sock.close()
        raise AssertionError(f"unexpected network access: {endpoint}")
print("network: both relays respond, only lo, other session/database/container/external addresses blocked", flush=True)

# A detached descendant must die when the namespace's PID 1 exits.
subprocess.Popen(["/bin/sleep", "120"], start_new_session=True, stdout=subprocess.DEVNULL,
                 stderr=subprocess.DEVNULL)
print("namespace: " + os.readlink("/proc/self/ns/net"), flush=True)
time.sleep(120)
