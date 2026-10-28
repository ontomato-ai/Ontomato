"""Trusted launcher: resource limits and privilege drop, never business logic."""
import json
import os
import sys
import signal
parent_pid = int(os.environ.pop("RUNTIME_PARENT_PID", "0"))

# The private lifetime pipe is held open by the Node supervisor. Its EOF kills
# the entire group even after a hard supervisor crash. It carries no data.
if os.name == "posix" and os.environ.pop("RUNTIME_LIFETIME_FD", ""):
    os.set_blocking(4, True)
    if os.fork() == 0:
        # The lifetime watcher must not keep the tool worker IPC channel open.
        try:
            os.close(3)
        except OSError:
            pass
        try:
            while os.read(4, 1):
                pass
        finally:
            worker_uid = os.environ.get("RUNTIME_WORKER_UID")
            if worker_uid and sys.platform == "linux":
                for entry in os.listdir("/proc"):
                    if not entry.isdigit():
                        continue
                    try:
                        with open("/proc/" + entry + "/status", encoding="utf-8") as status:
                            real_uid = next(line.split()[1] for line in status if line.startswith("Uid:"))
                        if real_uid == worker_uid:
                            os.kill(int(entry), signal.SIGKILL)
                    except (OSError, StopIteration):
                        pass
            os.killpg(os.getpgrp(), signal.SIGKILL)
        os._exit(0)
    os.close(4)

limits = json.loads(os.environ.pop("RUNTIME_WORKER_LIMITS"))
uid = os.environ.pop("RUNTIME_WORKER_UID", "")
if os.name == "posix":
    import resource
    for name, value in (
        (resource.RLIMIT_CPU, limits["cpuSeconds"]),
        (resource.RLIMIT_AS, limits["memoryBytes"]),
        (resource.RLIMIT_NPROC, limits["processCount"]),
        (resource.RLIMIT_FSIZE, limits["fileBytes"]),
        (resource.RLIMIT_CORE, 0),
    ):
        # Darwin rejects RLIMIT_AS even though the constant is exposed. This
        # exception is development-only; production always uses Linux limits.
        if not uid and (name == resource.RLIMIT_NPROC or sys.platform == "darwin" and name == resource.RLIMIT_AS):
            continue
        resource.setrlimit(name, (value, value))
    if uid:
        if os.geteuid() != 0:
            raise RuntimeError("CODE_ISOLATION_UNAVAILABLE: cannot change worker identity")
        os.setgroups([])
        os.setgid(int(uid))
        os.setuid(int(uid))
        if os.geteuid() == 0:
            raise RuntimeError("CODE_ISOLATION_UNAVAILABLE: worker is root")
        import ctypes
        if ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) != 0:
            raise RuntimeError("CODE_ISOLATION_UNAVAILABLE: cannot disable privilege escalation")
os.umask(0o077)
if os.name == "nt":
    # Hold the original parent object, not a reusable PID. Windows has no exec
    # replacement or POSIX lifetime pipe, so supervise the actual worker here.
    import ctypes
    from ctypes import wintypes
    import subprocess
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x00100000, False, parent_pid)
    if not handle:
        raise RuntimeError("Cannot establish worker parent lifetime")
    try:
        child = subprocess.Popen(sys.argv[1:], env=os.environ)
        while child.poll() is None:
            if kernel.WaitForSingleObject(handle, 100) != 258:
                subprocess.run(["taskkill", "/pid", str(os.getpid()), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                os._exit(1)
        sys.exit(child.returncode)
    finally:
        kernel.CloseHandle(handle)
os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
