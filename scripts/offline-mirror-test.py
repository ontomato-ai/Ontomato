import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("mirror", Path(__file__).resolve().parents[1] / "deploy/offline/mirror.py")
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        (self.bundle / "imageset.yaml").write_text("{}")
        (self.bundle / "mirror_000001.tar").write_bytes(b"oc-mirror fixture")
        self.data = {"schema": 1, "version": "4.0.1", "arch": "arm64",
                     "tool": mirror.TOOL_IMAGE + "-arm64", "registry": "ontomato-offline-registry:3.1.2-arm64",
                     "images": {key: "example.com/product/" + key.lower() + "@sha256:" + "a" * 64 for key in mirror.IMAGE_KEYS},
                     "files": {p.name: {"bytes": p.stat().st_size, "sha256": mirror.sha256(p)} for p in self.bundle.iterdir()}}
        self.write_manifest()

    def write_manifest(self):
        (self.bundle / "delivery.json").write_text(json.dumps(self.data))

    def test_corrupt_archive_fails_before_docker(self):
        (self.bundle / "mirror_000001.tar").write_bytes(b"corrupt")
        with patch.object(mirror, "run") as run, self.assertRaisesRegex(ValueError, "checksum"):
            mirror.import_bundle(SimpleNamespace(bundle=self.bundle, state=self.root / "state"))
        run.assert_not_called()

    def test_pre_runtime_baseline_import_remains_readable(self):
        del self.data["images"]["AGENT_RUNTIME_IMAGE"]
        self.write_manifest()
        target = self.root / "old-images.env"
        args = SimpleNamespace(bundle=self.bundle, state=self.root / "old-state", port=5100,
                               project="fixture", output_env=target)
        with patch.object(mirror, "run"), patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "ensure_mirror_network"), patch.object(mirror, "mirror"):
            mirror.import_bundle(args)
        self.assertNotIn("AGENT_RUNTIME_IMAGE", target.read_text())
        self.assertIn("POSTGRES_IMAGE=", target.read_text())

    def test_paths_cannot_escape_delivery(self):
        self.data["files"]["../secret"] = {"bytes": 0, "sha256": ""}
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            mirror.verify_bundle(self.bundle)

    def test_failed_import_preserves_active_references(self):
        target = self.root / "images.env"
        target.write_text("WORKBENCH_IMAGE=previous\n")
        args = SimpleNamespace(bundle=self.bundle, state=self.root / "state", port=5000,
                               project="fixture", output_env=target)
        with patch.object(mirror, "run"), patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "ensure_mirror_network"), patch.object(mirror, "mirror", side_effect=ValueError("missing baseline")):
            with self.assertRaisesRegex(ValueError, "baseline"):
                mirror.import_bundle(args)
        self.assertEqual(target.read_text(), "WORKBENCH_IMAGE=previous\n")
        self.assertFalse((self.root / "state/imports").exists())

    def test_successful_import_outputs_digests_and_keeps_history(self):
        state = self.root / "state"
        history = state / "incoming/working-dir/.history"
        history.mkdir(parents=True)
        (history / "previous").write_text("keep")
        (state / "incoming/mirror_999999.tar").write_text("old")
        target = self.root / "images.env"
        args = SimpleNamespace(bundle=self.bundle, state=state, port=5100,
                               project="fixture", output_env=target)
        with patch.object(mirror, "run"), patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "ensure_mirror_network"), patch.object(mirror, "mirror") as invoke:
            mirror.import_bundle(args)
        self.assertEqual((history / "previous").read_text(), "keep")
        self.assertEqual(len(list((state / "imports").glob("*.json"))), 1)
        self.assertFalse((state / "incoming/mirror_999999.tar").exists())
        self.assertIn("WORKBENCH_IMAGE=127.0.0.1:5100/product/workbench_image@sha256:" + "a" * 64, target.read_text())
        self.assertIn("docker://registry:5000", invoke.call_args[0][2])

    def test_cross_architecture_import_runs_the_engine_tool_and_registry(self):
        args = SimpleNamespace(bundle=self.bundle, state=self.root / "state", port=5102,
                               project="fixture", output_env=self.root / "images.env")
        with patch.object(mirror, "run") as run, patch.object(mirror, "engine_arch", return_value="amd64"), \
                patch.object(mirror, "ensure_mirror_network"), patch.object(mirror, "mirror") as invoke:
            mirror.import_bundle(args)
        inspected = [call.args[0][-1] for call in run.call_args_list if call.args[0][:3] == ["docker", "image", "inspect"]]
        self.assertEqual(inspected, [mirror.tool_image("amd64"), mirror.registry_image("amd64")])
        compose = next(call for call in run.call_args_list if "compose" in call.args[0])
        self.assertEqual(compose.kwargs["env"]["MIRROR_REGISTRY_IMAGE"], mirror.registry_image("amd64"))
        self.assertEqual(invoke.call_args.args[0], mirror.tool_image("amd64"))
        self.assertIn("WORKBENCH_IMAGE=127.0.0.1:5102/", args.output_env.read_text())

    def test_registry_is_attached_to_the_mirror_network_when_compose_left_it_out(self):
        with patch.object(mirror, "run", side_effect=["cid", json.dumps({"p_default": {}}), None]) as run:
            mirror.ensure_mirror_network("p", {})
        self.assertEqual(run.call_args_list[-1].args[0], ["docker", "network", "connect", "--alias", "registry", "p_mirror", "cid"])

    def test_registry_already_on_the_mirror_network_is_left_alone(self):
        with patch.object(mirror, "run", side_effect=["cid", json.dumps({"p_default": {}, "p_mirror": {}})]) as run:
            mirror.ensure_mirror_network("p", {})
        self.assertEqual(run.call_count, 2)

    def test_source_repository_preserves_ports_and_nested_paths(self):
        self.assertEqual(mirror.repository("localhost:5000/a/b:v1"), "localhost:5000/a/b")
        self.assertEqual(mirror.repository("example.com/a/b@sha256:" + "a" * 64), "example.com/a/b")
        with self.assertRaisesRegex(ValueError, "fully qualified"):
            mirror.repository("pgvector/pgvector:pg18")

    def test_resolve_selects_platform_digest_without_product_policy(self):
        digest = "sha256:" + "b" * 64
        manifest = {"manifests": [
            {"platform": {"os": "linux", "architecture": "amd64"}, "digest": "sha256:" + "a" * 64},
            {"platform": {"os": "linux", "architecture": "arm64"}, "digest": digest},
        ]}
        image = {"os": "linux", "architecture": "arm64"}
        with patch.object(mirror.subprocess, "check_output", return_value=json.dumps(manifest).encode()), \
                patch.object(mirror, "run", return_value=json.dumps(image)) as run:
            ref = mirror.resolve_image("example.com/arbitrary/image:mutable", "arm64")
        self.assertEqual(ref, "example.com/arbitrary/image@" + digest)
        # The platform config is read from the registry; nothing is pulled into the local Docker.
        self.assertEqual([call.args[0] for call in run.call_args_list],
                         [["docker", "buildx", "imagetools", "inspect", ref, "--format", "{{json .Image}}"]])

    def test_build_tag_survives_resolution_and_offline_import_with_the_same_digest(self):
        raw = b'{"schemaVersion":2}\n'
        digest = "sha256:" + hashlib.sha256(raw).hexdigest()
        build = "4.1.0-dev-ci123-gabc"
        image = {"os": "linux", "architecture": "arm64", "config": {"Labels": {
            "org.opencontainers.image.version": "4.1.0-dev", "io.ontomato.build": build}}}
        with patch.object(mirror.subprocess, "check_output", return_value=raw), \
                patch.object(mirror, "run", return_value=json.dumps(image)):
            ref = mirror.resolve_image("example.com/a:edge", "arm64")
        self.assertEqual(ref, "example.com/a:" + build + "@" + digest)
        self.data["images"]["WORKBENCH_IMAGE"] = ref
        self.write_manifest()
        target = self.root / "images.env"
        args = SimpleNamespace(bundle=self.bundle, state=self.root / "state", port=5000,
                               project="fixture", output_env=target)
        with patch.object(mirror, "run"), patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "ensure_mirror_network"), patch.object(mirror, "mirror"):
            mirror.import_bundle(args)
        self.assertIn("WORKBENCH_IMAGE=127.0.0.1:5000/a:" + build + "@" + digest, target.read_text())

    def test_resolve_single_manifest_hashes_exact_bytes(self):
        raw = b'{"schemaVersion":2}\n'
        image = {"os": "linux", "architecture": "arm64"}
        with patch.object(mirror.subprocess, "check_output", return_value=raw), \
                patch.object(mirror, "run", return_value=json.dumps(image)):
            ref = mirror.resolve_image("example.com/a:tag", "arm64")
        self.assertEqual(ref, "example.com/a@sha256:" + hashlib.sha256(raw).hexdigest())

    def test_resolve_rejects_wrong_platform(self):
        with patch.object(mirror.subprocess, "check_output", return_value=b'{"schemaVersion":2}'), \
                patch.object(mirror, "run", return_value=json.dumps({"os": "linux", "architecture": "amd64"})):
            with self.assertRaisesRegex(ValueError, "platform"):
                mirror.resolve_image("example.com/a:tag", "arm64")

    def export_args(self):
        refs = list(self.data["images"].values())
        return SimpleNamespace(state=self.root / "state", output=self.root / "exported", arch="arm64",
                               version="4.0.1", workbench=refs[0], data_engine=refs[1], manager=refs[2],
                               agent_runtime=refs[3], postgres=refs[4], bootstrap=False, insecure_source=False, network=None, authfile=None,
                               registry_repository=mirror.REGISTRY_REPOSITORY, cache_dir=None)

    def test_export_rejects_mutable_tag_before_creating_state(self):
        args = self.export_args()
        args.workbench = "example.com/a:mutable"
        with patch.object(mirror, "ensure_tool") as tool, self.assertRaisesRegex(ValueError, "immutable"):
            mirror.export(args)
        tool.assert_not_called()
        self.assertFalse(args.state.exists())

    def test_export_preserves_validated_pins_without_resolving_again(self):
        args = self.export_args()
        def write_archive(*_, **__):
            (args.state / "export").mkdir()
            (args.state / "export/mirror_000001.tar").write_bytes(b"archive")
        with patch.object(mirror, "resolve_image") as resolve, \
                patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "run"), \
                patch.object(mirror, "mirror", side_effect=write_archive):
            mirror.export(args)
        resolve.assert_not_called()
        data = mirror.verify_bundle(args.output)
        self.assertEqual(data["images"], self.data["images"])
        names = [item["name"] for item in json.loads((args.output / "imageset.yaml").read_text())["mirror"]["additionalImages"]]
        self.assertEqual(len(names), 5)
        self.assertTrue(all(name.endswith("@sha256:" + "a" * 64) for name in names))


    def test_incremental_export_ships_only_this_runs_archives(self):
        args = self.export_args()
        (args.state / "export").mkdir(parents=True)
        (args.state / "export/mirror_000001.tar").write_bytes(b"previous full archive")
        (args.state / "export/mirror_000002.tar").write_bytes(b"previous second part")
        def write_archive(*_, **__):
            self.assertEqual(list((args.state / "export").glob("mirror_*.tar")), [])
            (args.state / "export/mirror_000001.tar").write_bytes(b"increment")
        with patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "run"), \
                patch.object(mirror, "mirror", side_effect=write_archive):
            mirror.export(args)
        self.assertEqual(sorted(p.name for p in args.output.glob("mirror_*.tar")), ["mirror_000001.tar"])
        self.assertEqual((args.output / "mirror_000001.tar").read_bytes(), b"increment")

    def test_application_export_uses_native_tool_without_building_or_shipping_tools(self):
        args = self.export_args()
        def write_archive(*_, **__):
            (args.state / "export").mkdir()
            (args.state / "export/mirror_000001.tar").write_bytes(b"archive")
        with patch.object(mirror, "engine_arch", return_value="amd64"), \
                patch.object(mirror, "ensure_tool") as prepare, \
                patch.object(mirror, "save_bootstrap") as bootstrap, patch.object(mirror, "run"), \
                patch.object(mirror, "mirror", side_effect=write_archive) as invoke:
            mirror.export(args)
        prepare.assert_not_called()
        bootstrap.assert_not_called()
        self.assertEqual(invoke.call_args.args[0], mirror.tool_image("amd64"))
        data = mirror.verify_bundle(args.output)
        self.assertEqual(data["arch"], "arm64")
        self.assertEqual(data["tool"], mirror.tool_image("amd64"))
        self.assertNotIn("bootstrap.tar.gz", data["files"])

    def test_old_producer_identity_does_not_reload_old_bootstrap(self):
        self.data["tool"], self.data["registry"] = "old-tool:1", "old-registry:1"
        bootstrap = self.bundle / "bootstrap.tar.gz"
        bootstrap.write_bytes(b"obsolete v2 tools")
        self.data["files"][bootstrap.name] = {"bytes": bootstrap.stat().st_size, "sha256": mirror.sha256(bootstrap)}
        self.write_manifest()
        args = SimpleNamespace(bundle=self.bundle, state=self.root / "state", port=5000,
                               project="fixture", output_env=self.root / "images.env")
        with patch.object(mirror, "run") as run, patch.object(mirror, "engine_arch", return_value="amd64"), \
                patch.object(mirror, "ensure_mirror_network"), patch.object(mirror, "mirror") as invoke:
            mirror.import_bundle(args)
        self.assertFalse(any(c.args[0][:2] == ["docker", "load"] for c in run.call_args_list))
        self.assertEqual(invoke.call_args.args[0], mirror.tool_image("amd64"))

    def tool_bundle(self):
        args = SimpleNamespace(state=self.root / "tool-build", output=self.root / "tools", arch="arm64",
                               registry_repository="mirror.example.com/registry")
        def save(tool, target, arch, registry_repository):
            target.write_bytes(b"tools only")
            return mirror.registry_image(arch)
        with patch.object(mirror, "engine_arch", return_value="amd64"), \
                patch.object(mirror, "ensure_tool", side_effect=lambda state, arch: mirror.tool_image(arch)), \
                patch.object(mirror, "save_bootstrap", side_effect=save):
            mirror.export_tools(args)
        return args.output

    def test_tool_kit_is_independent_and_install_does_not_import_or_start_services(self):
        bundle = self.tool_bundle()
        data = mirror.verify_tools(bundle, "arm64")
        self.assertEqual(data["version"], mirror.TOOLS_VERSION)
        self.assertNotIn("applicationVersion", data)
        with patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "run", return_value="arm64") as run:
            for _ in range(2):
                mirror.install_tools(SimpleNamespace(bundle=bundle))
        self.assertEqual([c.args[0][:2] for c in run.call_args_list], [["docker", "load"], ["docker", "image"], ["docker", "image"]] * 2)
        self.assertFalse((bundle / "delivery.json").exists())

    def test_damaged_or_wrong_arch_tool_kit_fails_before_load(self):
        bundle = self.tool_bundle()
        with patch.object(mirror, "run") as run, self.assertRaisesRegex(ValueError, "platform"):
            mirror.verify_tools(bundle, "amd64")
        run.assert_not_called()
        (bundle / "images.tar.gz").write_bytes(b"damaged")
        with patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "run") as run, self.assertRaisesRegex(ValueError, "checksum"):
            mirror.install_tools(SimpleNamespace(bundle=bundle))
        run.assert_not_called()

    def test_export_mounts_the_state_cache_by_default_and_a_given_shared_cache(self):
        for cache_dir, expected in ((None, self.root / "state/cache"), (self.root / "shared cache", self.root / "shared cache")):
            with self.subTest(cache_dir=cache_dir):
                args = self.export_args()
                args.output = self.root / ("exported-" + str(cache_dir is None))
                args.cache_dir = cache_dir
                def write_archive(*_, **__):
                    (args.state / "export").mkdir(parents=True, exist_ok=True)
                    (args.state / "export/mirror_000001.tar").write_bytes(b"archive")
                with patch.object(mirror, "engine_arch", return_value="arm64"), \
                        patch.object(mirror, "run", side_effect=write_archive) as run:
                    mirror.export(args)
                command = run.call_args.args[0]
                self.assertEqual(command[command.index("-v", command.index("-v") + 1) + 1], str(expected) + ":/cache")
                self.assertEqual(command[command.index("--cache-dir") + 1], "/cache")
                self.assertTrue(expected.is_dir())

    def test_import_keeps_the_site_cache_in_its_state(self):
        args = SimpleNamespace(bundle=self.bundle, state=self.root / "state", port=5000,
                               project="fixture", output_env=self.root / "images.env")
        with patch.object(mirror, "run"), patch.object(mirror, "engine_arch", return_value="arm64"), \
                patch.object(mirror, "ensure_mirror_network"), patch.object(mirror, "mirror") as invoke:
            mirror.import_bundle(args)
        self.assertEqual(invoke.call_args.kwargs["cache"], args.state.resolve() / "cache")

    def test_bootstrap_pulls_only_the_registry_image_for_docker_save(self):
        ref = "mirror.example.com/copies/registry@" + mirror.REGISTRY_DIGEST
        with patch.object(mirror, "resolve_image", return_value=ref), \
                patch.object(mirror, "run", side_effect=[None, ValueError("stop")]) as run, \
                self.assertRaisesRegex(ValueError, "stop"):
            mirror.save_bootstrap("tool", self.root / "bootstrap.tar.gz", "arm64", "mirror.example.com/copies/registry")
        self.assertEqual(run.call_args_list[0].args[0], ["docker", "pull", "--platform", "linux/arm64", ref])

    def test_bootstrap_registry_keeps_the_pinned_digest_from_any_repository(self):
        with patch.object(mirror, "resolve_image", side_effect=ValueError("stop")) as resolve, \
                self.assertRaisesRegex(ValueError, "stop"):
            mirror.save_bootstrap("tool", self.root / "bootstrap.tar.gz", "arm64", "mirror.example.com/copies/registry")
        self.assertEqual(resolve.call_args.args, ("mirror.example.com/copies/registry@" + mirror.REGISTRY_DIGEST, "arm64"))
        self.assertEqual(mirror.REGISTRY_REPOSITORY, "docker.io/library/registry")

    def test_tool_build_runs_no_target_architecture_instruction(self):
        _, unpack, final = (Path(mirror.HERE) / "Dockerfile").read_text().split("\nFROM ")
        self.assertTrue(unpack.startswith("--platform=$BUILDPLATFORM "))
        self.assertNotIn("RUN ", final)


if __name__ == "__main__":
    unittest.main()
