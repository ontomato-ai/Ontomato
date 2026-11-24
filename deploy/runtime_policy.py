"""Load the agent-runtime image's host policy and verify its Compose security settings."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


ASSETS = "/usr/local/lib/ontomato-sandbox"
PROFILE = "ontomato-agent-runtime"
SELINUX_TYPE = "ontomato_agent_runtime_t"


def command(args, root, layer):
    result = subprocess.run(args, cwd=root, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"{layer} (exit {result.returncode})\n{result.stdout}{result.stderr}")
    return result.stdout.strip()


def admin(args):
    return args if os.geteuid() == 0 else ["sudo", *args]


def require_tool(name, layer):
    if not shutil.which(name):
        raise RuntimeError(f"{layer}: required host tool unavailable: {name}")


def select_policy(env_file, option):
    text = env_file.read_text(encoding="utf-8")
    text = re.sub(r"^(?:export\s+)?AGENT_RUNTIME_LSM=.*\n?", "", text, flags=re.M)
    text = text.rstrip("\n") + f"\nAGENT_RUNTIME_LSM={option}\n"
    fd, temporary = tempfile.mkstemp(dir=env_file.parent, prefix=".runtime-policy-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(text)
        os.replace(temporary, env_file)
    finally:
        Path(temporary).unlink(missing_ok=True)


def run_preflight(env_file):
    env_file = Path(env_file).resolve()
    root = env_file.parent
    docker = ["docker"]
    compose = [*docker, "compose", "--env-file", str(env_file)]
    layer = "Docker capability/seccomp"

    def service():
        config = json.loads(command([*compose, "config", "--format", "json"], root, layer))
        return config["services"]["agent-runtime"]

    image = service()["image"]
    security = json.loads(command([*docker, "info", "--format", "{{json .SecurityOptions}}"], root, layer))
    security = {item.split(",", 1)[0] for item in security}
    policy_dir = root / "sandbox-policy"
    policy_dir.mkdir(exist_ok=True)
    container = command([*docker, "create", "--pull=never", image], root, "runtime image policy")
    try:
        for asset in ("seccomp.json", "apparmor", "ontomato-agent-runtime.cil"):
            command([*docker, "cp", f"{container}:{ASSETS}/{asset}", str(policy_dir / asset)],
                    root, "runtime image policy")
    finally:
        command([*docker, "rm", "-v", container], root, "runtime image policy cleanup")

    selected = "no-new-privileges=true"
    if "name=apparmor" in security:
        require_tool("apparmor_parser", "AppArmor")
        policy = policy_dir / "apparmor"
        installed = Path("/etc/apparmor.d") / PROFILE
        command(admin(["install", "-m", "644", str(policy), str(installed)]), root, "AppArmor")
        command(admin(["apparmor_parser", "-r", str(installed)]), root, "AppArmor")
        selected = f"apparmor={PROFILE}"
    elif "name=selinux" in security:
        require_tool("semodule", "SELinux")
        command(admin(["semodule", "-i", str(policy_dir / "ontomato-agent-runtime.cil")]), root, "SELinux")
        selected = f"label=type:{SELINUX_TYPE}"
    select_policy(env_file, selected)

    runtime = service()
    args = [*docker, "run", "--rm", "--pull=never", "--network=none"]
    for capability in runtime["cap_add"]:
        args += ["--cap-add", capability]
    for option in runtime["security_opt"]:
        args += ["--security-opt", option]
    # This probes the rendered service's image and security settings with its own ephemeral filesystem.
    args += ["--entrypoint", "/usr/local/bin/node", runtime["image"], "--import", "tsx", f"{ASSETS}/preflight.mjs"]
    try:
        print(command(args, root, "agent-runtime sandbox preflight"))
    except RuntimeError as error:
        message = str(error)
        if re.search(r"apparmor.*(?:denied|failed|not found|unable)|(?:denied|failed).*apparmor", message, re.I):
            raise RuntimeError(f"AppArmor: {message}") from error
        if re.search(r"SELinux|setexeccon|invalid label", message, re.I):
            raise RuntimeError(f"SELinux: {message}") from error
        raise
