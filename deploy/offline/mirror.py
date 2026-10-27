#!/usr/bin/env python3
"""Copy oc-mirror archives; oc-mirror owns blob selection, history and import."""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL_VERSION = "4.22.17"
TOOL_IMAGE = "ontomato-oc-mirror:" + TOOL_VERSION
TOOLS_VERSION = "2026.10.28"
TOOL_BASE = {
    "amd64": "registry.access.redhat.com/ubi8/ubi@sha256:73071333d0cd7c526b6d7d01f0c9b709fd4a96c47853b1c9071e0a11284bd1da",
    "arm64": "registry.access.redhat.com/ubi9/ubi@sha256:16e9e43d99e181463513cc84a514859b1abb9460f1c4d9e208da4b4e51cd5cc3",
}
# The bootstrap Registry is pinned by digest; only the repository serving it may vary (e.g. a mirror copy).
REGISTRY_DIGEST = "sha256:ddf754342cfc8acc51a56d5d0ab6af06826461864460636d8bd5c546dab2a7b8"
REGISTRY_REPOSITORY = "docker.io/library/registry"
TOOL_SHA = {
    "amd64": "7bad7aeeb27f6fee911599fcab000587d4066eafb58a7c88aed366676599bb73",
    "arm64": "1d1c755a7581e6bfbeab0198c6ad4349f2761918d53a88523e105e7362c14e5e",
}
IMAGE_KEYS = ("WORKBENCH_IMAGE", "DATA_ENGINE_IMAGE", "MANAGER_IMAGE", "AGENT_RUNTIME_IMAGE", "POSTGRES_IMAGE")


def run(argv, capture=False, **kwargs):
    result = subprocess.run([str(x) for x in argv], check=True, text=True,
                            stdout=subprocess.PIPE if capture else None, **kwargs)
    return result.stdout.strip() if capture else None


def sha256(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def repository(ref):
    # Fully qualified source names make destination paths unambiguous.
    first, sep, rest = ref.partition("/")
    if not sep or not ("." in first or ":" in first or first == "localhost"):
        raise ValueError("Use a fully qualified image reference: " + ref)
    path = rest.split("@", 1)[0]
    if ":" in path:
        path = path.rsplit(":", 1)[0]
    return first + "/" + path


def image_config(ref):
    # Read a single-platform image config straight from the registry; nothing is pulled into Docker.
    return json.loads(run(["docker", "buildx", "imagetools", "inspect", ref, "--format", "{{json .Image}}"],
                          capture=True))


def resolve_image(ref, arch):
    raw = subprocess.check_output(["docker", "buildx", "imagetools", "inspect", ref, "--raw"])
    manifest = json.loads(raw)
    if "manifests" in manifest:
        matches = [m for m in manifest["manifests"] if m.get("platform", {}).get("architecture") == arch
                   and m.get("platform", {}).get("os") == "linux"]
        if len(matches) != 1:
            raise ValueError("Expected one linux/" + arch + " manifest in " + ref)
        digest = matches[0]["digest"]
    else:
        # imagetools adds no formatting to --raw; hash the original bytes, including newlines.
        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
    resolved = repository(ref) + "@" + digest
    image = image_config(resolved)
    if image.get("os") != "linux" or image.get("architecture") != arch:
        raise ValueError("Wrong image platform: " + resolved)
    labels = (image.get("config") or {}).get("Labels") or {}
    version = labels.get("org.opencontainers.image.version")
    if version:
        tag = labels.get("io.ontomato.build") or version + "-" + digest.split(":")[1][:12]
        resolved = repository(ref) + ":" + tag + "@" + digest
    return resolved


def validate_sources(sources):
    for ref in sources.values():
        repository(ref)
        if not re.fullmatch(r"[a-zA-Z0-9./_:-]+@sha256:[a-f0-9]{64}", ref):
            raise ValueError("Delivery images must use immutable digests")


def tool_image(arch):
    return TOOL_IMAGE + "-" + arch + ("-ubi8-v1" if arch == "amd64" else "")


def registry_image(arch):
    return "ontomato-offline-registry:3.1.2-" + arch


def engine_arch():
    # oc-mirror runs in a container on this Docker engine, so the engine picks the runnable tool.
    arch = run(["docker", "version", "--format", "{{.Server.Arch}}"], capture=True)
    if arch not in TOOL_SHA:
        raise ValueError("Unsupported Docker engine architecture: " + arch)
    return arch


def ensure_tool(state, arch):
    tag = tool_image(arch)
    exists = subprocess.run(["docker", "image", "inspect", tag], stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL).returncode == 0
    if exists:
        return tag
    context = state / "tool"
    downloads = context / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archive = downloads / ("oc-mirror-" + arch + ".tar.gz")
    if not archive.exists() or sha256(archive) != TOOL_SHA[arch]:
        segment = "aarch64/" if arch == "arm64" else ""
        url = "https://mirror.openshift.com/pub/openshift-v4/" + segment + "clients/ocp/" + TOOL_VERSION + ("/oc-mirror.tar.gz" if arch == "amd64" else "/oc-mirror.rhel9.tar.gz")
        print("Downloading " + url, flush=True)
        with urllib.request.urlopen(url, timeout=120) as source, archive.open("wb") as target:
            shutil.copyfileobj(source, target)
        if sha256(archive) != TOOL_SHA[arch]:
            raise ValueError("oc-mirror download checksum mismatch")
    shutil.copyfile(HERE / "Dockerfile", context / "Dockerfile")
    run(["docker", "buildx", "build", "--platform", "linux/" + arch, "--provenance=false", "--load", "--build-arg", "BASE_IMAGE=" + TOOL_BASE[arch], "-t", tag, context])
    return tag


def mirror(tool, state, args, network=None, authfile=None, *, cache):
    cache.mkdir(parents=True, exist_ok=True)
    command = ["docker", "run", "--rm", "--pull=never", "-v", str(state) + ":/work", "-v", str(cache) + ":/cache"]
    if network:
        command += ["--network", network]
    if authfile:
        command += ["-v", str(Path(authfile).resolve()) + ":/auth.json:ro"]
        args = ["--authfile", "/auth.json"] + args
    run(command + [tool, "--cache-dir", "/cache", "--remove-signatures"] + args)


def save_bootstrap(tool, target, arch, registry_repository):
    registry_ref = resolve_image(registry_repository + "@" + REGISTRY_DIGEST, arch)
    # docker save needs the Registry image locally; it is the only image an export pulls.
    run(["docker", "pull", "--platform", "linux/" + arch, registry_ref], capture=True)
    # A tag survives docker save/load; digest-only references do not on every engine.
    registry_tag = registry_image(arch)
    run(["docker", "tag", registry_ref, registry_tag])
    import gzip
    with gzip.open(target, "wb", compresslevel=1) as out:
        child = subprocess.Popen(["docker", "save", tool, registry_tag], stdout=subprocess.PIPE)
        try:
            shutil.copyfileobj(child.stdout, out)
        finally:
            child.stdout.close()
        if child.wait() != 0:
            raise ValueError("docker save bootstrap failed")
    return registry_tag


def export_tools(args):
    state, output = Path(args.state).resolve(), Path(args.output).resolve()
    if output.exists():
        raise ValueError("Tool output already exists: " + str(output))
    state.mkdir(parents=True, exist_ok=True)
    # Prepare the native exporter as well when building a kit for another architecture.
    ensure_tool(state, engine_arch())
    tool = ensure_tool(state, args.arch)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".tools-", dir=output.parent) as temporary:
        staging = Path(temporary) / "bundle"
        staging.mkdir()
        registry = save_bootstrap(tool, staging / "images.tar.gz", args.arch, args.registry_repository)
        for name in ("mirror.py", "compose.yml", "Dockerfile"):
            shutil.copyfile(HERE / name, staging / name)
        files = {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in staging.iterdir()}
        manifest = {"schema": 1, "version": TOOLS_VERSION, "arch": args.arch,
                    "images": [tool, registry], "files": files}
        (staging / "tools.json").write_text(json.dumps(manifest, indent=2) + "\n")
        staging.rename(output)
    print("TOOLS=" + str(output), flush=True)


def verify_tools(bundle, arch):
    data = json.loads((bundle / "tools.json").read_text())
    if data.get("schema") != 1 or data.get("arch") != arch:
        raise ValueError("Invalid tool metadata or wrong platform")
    if data.get("images") != [tool_image(arch), registry_image(arch)]:
        raise ValueError("Tool images do not match their bundled executor")
    if set(data.get("files", {})) != {"images.tar.gz", "mirror.py", "compose.yml", "Dockerfile"}:
        raise ValueError("Incomplete tool bundle")
    for name, record in data["files"].items():
        path = bundle / name
        if path.stat().st_size != record["bytes"] or sha256(path) != record["sha256"]:
            raise ValueError("Tool checksum mismatch: " + name)
    return data


def install_tools(args):
    bundle = Path(args.bundle).resolve()
    arch = engine_arch()
    data = verify_tools(bundle, arch)
    run(["docker", "load", "-i", bundle / "images.tar.gz"])
    for image in data["images"]:
        actual = run(["docker", "image", "inspect", image, "--format", "{{.Architecture}}"], capture=True)
        if actual != arch:
            raise ValueError("Wrong loaded tool platform: " + image)
    print("TOOLS_INSTALLED=" + data["version"], flush=True)


def export(args):
    state, output = Path(args.state).resolve(), Path(args.output).resolve()
    if output.exists():
        raise ValueError("Output already exists; choose a new delivery directory: " + str(output))
    if state == output or state in output.parents or output in state.parents:
        raise ValueError("Delivery output and persistent state must be separate directories")
    sources = dict(zip(IMAGE_KEYS, (args.workbench, args.data_engine, args.manager, args.agent_runtime, args.postgres)))
    # The product entry has validated these exact digests before export advances history.
    validate_sources(sources)
    state.mkdir(parents=True, exist_ok=True)
    # This oc-mirror version needs a destination tag even for digest sources.
    # Preserve the readable build tag; the digest pins the actual content.
    # JSON is a YAML subset; no YAML dependency is required at the site.
    config = {"apiVersion": "mirror.openshift.io/v2alpha1", "kind": "ImageSetConfiguration",
              "mirror": {"additionalImages": [
                  {"name": ref if ref.split("@")[0] != repository(ref) else repository(ref) + ":mirror-" + ref.split("@sha256:")[1] + "@" + ref.split("@")[1]}
                  for ref in dict.fromkeys(sources.values())]}}
    (state / "imageset.yaml").write_text(json.dumps(config, indent=2) + "\n")
    # Tool preparation is independent of the application archive and target architecture.
    exporter = tool_image(engine_arch())
    run(["docker", "image", "inspect", exporter], capture=True)
    flags = ["-c", "/work/imageset.yaml"]
    if args.insecure_source:
        flags += ["--src-tls-verify=false"]
    # Archives from an earlier export of this state were already delivered; the export history that makes
    # this run incremental lives in oc-mirror's working directory, so only this run's archives are collected.
    for old in (state / "export").glob("mirror_*.tar"):
        old.unlink()
    # The cache only supplies blob bytes, so it may be shared between states; which blobs an export archives
    # comes from the history in this state's working directory.
    cache = Path(args.cache_dir).resolve() if args.cache_dir else state / "cache"
    mirror(exporter, state, flags + ["file:///work/export"], args.network, args.authfile, cache=cache)
    archives = sorted((state / "export").glob("mirror_*.tar"))
    if not archives:
        raise ValueError("oc-mirror produced no archive; no delivery was created")
    output.mkdir(parents=True)
    for archive in archives:
        shutil.copyfile(archive, output / archive.name)
    shutil.copyfile(state / "imageset.yaml", output / "imageset.yaml")
    files = {p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in sorted(output.iterdir())}
    metadata = {"schema": 1, "version": args.version, "arch": args.arch, "images": sources,
                "tool": exporter, "files": files}
    (output / "delivery.json").write_text(json.dumps(metadata, indent=2) + "\n")
    size = sum(item["bytes"] for name, item in files.items() if name.startswith("mirror_"))
    print("DELIVERY=" + str(output) + "\nARCHIVE_BYTES=" + str(size), flush=True)


def verify_bundle(bundle):
    data = json.loads((bundle / "delivery.json").read_text())
    if data.get("schema") != 1 or data.get("arch") not in TOOL_SHA or set(data.get("images", {})) not in (set(IMAGE_KEYS), set(IMAGE_KEYS) - {"AGENT_RUNTIME_IMAGE"}):
        raise ValueError("Invalid delivery metadata")
    # Older deliveries record their producer's tool/Registry tags. They do not select
    # the executor; the independently installed tools own that choice.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.+-]*", data.get("version", "")):
        raise ValueError("Invalid delivery version")
    files = data["files"]
    if "imageset.yaml" not in files or not any(re.fullmatch(r"mirror_\d+\.tar", name) for name in files):
        raise ValueError("Delivery has no image set or mirror archive")
    for name, record in files.items():
        if Path(name).name != name or name not in ("imageset.yaml", "bootstrap.tar.gz") and not re.fullmatch(r"mirror_\d+\.tar", name):
            raise ValueError("Unexpected delivery file: " + name)
        path = bundle / name
        if path.stat().st_size != record["bytes"] or sha256(path) != record["sha256"]:
            raise ValueError("Delivery checksum mismatch: " + name)
    validate_sources(data["images"])
    return data


def ensure_mirror_network(project, env):
    # Compose v2.24.6 on Docker 26 (seen on a CentOS 7 host) occasionally starts the Registry attached to
    # its default network only, so oc-mirror on the internal network cannot resolve "registry". Attach it
    # here; this is the only place that depends on that Compose behavior.
    network = project + "_mirror"
    container = run(["docker", "compose", "-p", project, "-f", HERE / "compose.yml", "ps", "-q", "registry"],
                    capture=True, env=env)
    attached = json.loads(run(["docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", container],
                              capture=True))
    if network not in attached:
        run(["docker", "network", "connect", "--alias", "registry", network, container])


def import_bundle(args):
    bundle, state = Path(args.bundle).resolve(), Path(args.state).resolve()
    data = verify_bundle(bundle)
    state.mkdir(parents=True, exist_ok=True)
    # A 4.1.0 archive may contain its original bootstrap. Never reload those old tools:
    # installation/updating of tool images is a separate operation.
    # Like export, run this engine's own tool and Registry: they only copy and store layers, so a delivery
    # imports on any engine (the release host keeps an arm64 import target on amd64 without emulation).
    # On a site the engine is the delivery architecture, i.e. the bundled images.
    arch = engine_arch()
    tool, registry = tool_image(arch), registry_image(arch)
    for image in (tool, registry):
        run(["docker", "image", "inspect", image], capture=True)
    env = dict(os.environ, MIRROR_STATE=str(state), MIRROR_PORT=str(args.port), MIRROR_REGISTRY_IMAGE=registry)
    run(["docker", "compose", "-p", args.project, "-f", HERE / "compose.yml", "up", "-d"], env=env)
    ensure_mirror_network(args.project, env)
    # Keep import history beside the cache. Only incoming archives change each time.
    incoming = state / "incoming"
    incoming.mkdir(exist_ok=True)
    for old in incoming.glob("mirror_*.tar"):
        old.unlink()
    for name in data["files"]:
        if name == "imageset.yaml" or name.startswith("mirror_"):
            shutil.copyfile(bundle / name, incoming / name)
    mirror(tool, state, ["-c", "/work/incoming/imageset.yaml", "--from", "file:///work/incoming",
                         "--dest-tls-verify=false", "docker://registry:5000"], args.project + "_mirror",
           cache=state / "cache")
    # Receipts record successful Registry imports only, not application upgrades.
    receipts = state / "imports"
    receipts.mkdir(exist_ok=True)
    shutil.copyfile(bundle / "delivery.json", receipts / (sha256(bundle / "delivery.json") + ".json"))
    # A failed import never changes the active deployment's image references.
    lines = ["ARCH=" + data["arch"], "ONTOMATO_VERSION=" + data["version"]]
    for key in data["images"]:
        path = data["images"][key].split("/", 1)[1]
        lines.append(key + "=127.0.0.1:" + str(args.port) + "/" + path)
    target = Path(args.output_env).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text("\n".join(lines) + "\n")
    temporary.replace(target)
    print("IMAGES_ENV=" + str(target), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    resolve = commands.add_parser("resolve", help="Check the selected platform in the registry and print immutable references as a JSON array")
    exp = commands.add_parser("export", help="Export validated immutable images; retain --state between versions")
    for command in (resolve, exp):
        for name in ("workbench", "data-engine", "manager", "agent-runtime", "postgres"):
            command.add_argument("--" + name, required=True)
        command.add_argument("--arch", choices=tuple(TOOL_SHA), required=True)
    for name in ("state", "output", "version"):
        exp.add_argument("--" + name, required=True)
    exp.add_argument("--authfile", help="Container auth JSON with inline credentials; never copied to a delivery")
    exp.add_argument("--cache-dir", help="oc-mirror download cache (default: <state>/cache); may be shared")
    exp.add_argument("--network", help="Docker network for the exporter")
    exp.add_argument("--insecure-source", action="store_true")
    tool_export = commands.add_parser("tools-export", help="Prepare standalone offline tool images and executor")
    tool_export.add_argument("--arch", choices=tuple(TOOL_SHA), required=True)
    tool_export.add_argument("--state", required=True)
    tool_export.add_argument("--output", required=True)
    tool_export.add_argument("--registry-repository", default=REGISTRY_REPOSITORY)
    tool_install = commands.add_parser("tools-install", help="Install/update tool images without importing application images")
    tool_install.add_argument("--bundle", required=True)
    tool_check = commands.add_parser("tools-verify", help="Verify a prepared tool bundle before composing a delivery")
    tool_check.add_argument("--bundle", required=True)
    tool_check.add_argument("--arch", choices=tuple(TOOL_SHA), required=True)
    imp = commands.add_parser("import", help="Import a delivery to the persistent local Registry")
    for name in ("bundle", "state", "output-env"):
        imp.add_argument("--" + name, required=True)
    imp.add_argument("--port", type=int, default=5000)
    imp.add_argument("--project", default="ontomato-offline")
    args = parser.parse_args()
    try:
        if args.command == "resolve":
            print(json.dumps([resolve_image(ref, args.arch) for ref in
                              (args.workbench, args.data_engine, args.manager, args.agent_runtime, args.postgres)]))
        elif args.command == "export":
            export(args)
        elif args.command == "tools-export":
            export_tools(args)
        elif args.command == "tools-install":
            install_tools(args)
        elif args.command == "tools-verify":
            verify_tools(Path(args.bundle).resolve(), args.arch)
        else:
            if not 1 <= args.port <= 65535:
                raise ValueError("Registry port must be 1..65535")
            import_bundle(args)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, "mirror: " + str(error) + "\n")


if __name__ == "__main__":
    main()
