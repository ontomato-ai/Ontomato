"""Linux launcher proof in a disposable stock image, not product-image acceptance."""
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import tempfile

assert sys.platform == "linux" and os.geteuid() == 0
root = Path(tempfile.mkdtemp(prefix="worker-proof-"))
root.chmod(0o711)
runtime_private = root / "runtime-private"
runtime_private.mkdir(mode=0o700)
(runtime_private / "secret").write_text("supervisor-fixture-secret")
other = root / "other"
other.mkdir(mode=0o700)
os.chown(other, 20001, 20001)
library = root / "library"
library.mkdir()
(library / "sitecustomize.py").write_text(
    "import os\nfrom pathlib import Path\n"
    "if os.geteuid() == 0: Path('/tmp/worker-bootstrap-breach').write_text('root')\n"
)
os.chown(library, 0, 20000)
library.chmod(0o550)
os.chown(library / "sitecustomize.py", 0, 20000)
(library / "sitecustomize.py").chmod(0o440)


def run(code, uid=20000, limits=None, unprivileged=False):
    work = root / ("work-" + str(uid) + "-" + str(len(list(root.iterdir()))))
    work.mkdir(mode=0o700)
    (work / "program.py").write_text(code)
    os.chown(work, uid, uid)
    os.chown(work / "program.py", uid, uid)
    policy = dict(cpuSeconds=3, memoryBytes=128 * 1024**2, processCount=8,
                  fileBytes=1024, outputBytes=1024, wallTimeMs=10000)
    policy.update(limits or {})
    env = dict(PATH="/usr/local/bin:/usr/bin:/bin", PYTHONPATH=str(library),
               RUNTIME_WORKER_UID=str(uid), RUNTIME_WORKER_LIMITS=json.dumps(policy),
               ONTOMATO_CREDENTIAL_JSON='{"kind":"bearer","value":"short-run-fixture"}')
    return subprocess.run(
        [sys.executable, "-I", "-S", "/fixture/worker-launch.py", sys.executable, "program.py"],
        cwd=work, env=env, capture_output=True, text=True, timeout=12,
        **(dict(user=20002, group=20002, extra_groups=[]) if unprivileged else {}),
    )


probe = run(f"""
import json,os,resource
from pathlib import Path
denied=[]
for file in [{str(runtime_private / 'secret')!r},{str(other)!r},{str(library / 'sitecustomize.py')!r}]:
    try:
        if file.endswith('sitecustomize.py'): Path(file).write_text('changed')
        elif file.endswith('other'): list(Path(file).iterdir())
        else: Path(file).read_text()
    except PermissionError: denied.append(file)
Path('owned').write_text('ok')
try: Path('oversize').write_bytes(b'x'*2048)
except OSError: pass
print(json.dumps({{'uid':os.getuid(),'gid':os.getgid(),'denied':len(denied),
    'fileBytes':Path('oversize').stat().st_size,'cpu':resource.getrlimit(resource.RLIMIT_CPU)[0],
    'memory':resource.getrlimit(resource.RLIMIT_AS)[0], 'processes':resource.getrlimit(resource.RLIMIT_NPROC)[0],
    'credentials':json.loads(os.environ['ONTOMATO_CREDENTIAL_JSON'])['value'],
    'supervisorSecret':os.environ.get('SERVER_SECRET')}}))
""")
assert probe.returncode == 0, probe.stderr
value = json.loads(probe.stdout)
assert value == dict(uid=20000, gid=20000, denied=3, fileBytes=1024, cpu=3,
                    memory=128 * 1024**2, processes=8, credentials="short-run-fixture",
                    supervisorSecret=None), value
assert not Path("/tmp/worker-bootstrap-breach").exists()
memory = run("bytearray(256*1024**2)", uid=20003, limits=dict(memoryBytes=64 * 1024**2))
assert memory.returncode != 0 and "MemoryError" in memory.stderr, memory.stderr
cpu = run("while True: pass", uid=20004, limits=dict(cpuSeconds=1))
assert cpu.returncode < 0, cpu
failed = run("print('must not run')", uid=20005, unprivileged=True)
assert failed.returncode != 0 and "CODE_ISOLATION_UNAVAILABLE" in failed.stderr, failed.stderr
forks = run("""
import os,signal
children=[]
try:
    for i in range(20):
        pid=os.fork()
        if pid==0:
            import time
            time.sleep(30)
            os._exit(0)
        children.append(pid)
except OSError:
    print(len(children))
finally:
    for pid in children: os.kill(pid,signal.SIGKILL)
    for pid in children: os.waitpid(pid,0)
""", uid=20006, limits=dict(processCount=4))
assert forks.returncode == 0 and int(forks.stdout.strip()) <= 3, forks.stderr
# A detached descendant must die when the supervisor's lifetime pipe closes.
work = root / "lifetime"
work.mkdir(mode=0o700)
os.chown(work, 20007, 20007)
(work / "program.py").write_text("""
import json,os,subprocess,sys,time
child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'], start_new_session=True)
print(json.dumps([os.getpid(),child.pid]),flush=True)
time.sleep(60)
""")
os.chown(work / "program.py", 20007, 20007)
read_fd, write_fd = os.pipe()
def child_pipe():
    os.dup2(read_fd, 4)
env = dict(PATH="/usr/local/bin:/usr/bin:/bin", RUNTIME_WORKER_UID="20007", RUNTIME_LIFETIME_FD="4",
           RUNTIME_WORKER_LIMITS=json.dumps(dict(cpuSeconds=5,memoryBytes=128*1024**2,processCount=8,fileBytes=1024)))
worker=subprocess.Popen([sys.executable,"-I","-S","/fixture/worker-launch.py",sys.executable,"program.py"],
    cwd=work,env=env,pass_fds=(read_fd,4),preexec_fn=child_pipe,start_new_session=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
os.close(read_fd)
try:
    pids=json.loads(worker.stdout.readline())
    os.close(write_fd)
    worker.wait(timeout=5)
    import time
    def alive(pid):
        try: return next(line.split()[1] for line in Path("/proc",str(pid),"status").read_text().splitlines() if line.startswith("State:")) != "Z"
        except FileNotFoundError: return False
    for _ in range(100):
        if not any(alive(pid) for pid in pids): break
        time.sleep(.02)
    assert not any(alive(pid) for pid in pids), pids
finally:
    if worker.poll() is None: os.killpg(worker.pid, 9);worker.wait()
print("PASS lifetime pipe terminates detached descendants by worker UID")
print("PASS Linux UID/GID, private filesystem permissions, read-only library, clean environment, bootstrap isolation, CPU/memory/process/file limits, unprivileged fail-closed")
