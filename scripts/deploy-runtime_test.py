"""Configuration migration and Compose boundaries, without starting application images."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("prepare", ROOT / "deploy/prepare-env.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class RuntimeDeployment(unittest.TestCase):
    def test_upgrade_generates_once_preserves_old_secrets_and_rejects_duplicate(self):
        with tempfile.TemporaryDirectory() as temp:
            env = Path(temp) / ".env"
            original = "POSTGRES_PASSWORD=keep-pg\nONTOMATO_MODEL_RUNTIME_TOKEN=keep-model\n"
            env.write_text(original)
            prepare.prepare(env)
            written = env.read_text()
            self.assertTrue(written.startswith(original))
            self.assertRegex(written, r"AGENT_RUNTIME_SERVICE_TOKEN=[A-Za-z0-9_-]{43}\n")
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            prepare.prepare(env)
            self.assertEqual(env.read_text(), written)
            env.write_text(written + "AGENT_RUNTIME_SERVICE_TOKEN=duplicate\n")
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                prepare.prepare(env)

    def test_both_compose_templates_share_credential_and_isolate_runtime_storage(self):
        for root, workbench, database, overlay in [(ROOT, "ontomato", "ontomato", "ghcr"),
                                                  (ROOT.parent / "ontomato-enterprise", "data-agent", "data_agent", "registry")]:
            if not root.exists():
                continue
            with self.subTest(root=root), tempfile.TemporaryDirectory() as temp:
                # Compose reads the service-level `env_file: .env` relative to the project
                # directory, not the --env-file override, so the project has to own the
                # prepared file. Copying the templates keeps this test off any local
                # deploy/.env that a checkout does not contain.
                project = Path(temp) / "deploy"
                project.mkdir()
                for name in ("docker-compose.yml", f"docker-compose.{overlay}.yml", "initdb.sql"):
                    (project / name).write_bytes((root / "deploy" / name).read_bytes())
                env = project / ".env"
                env.write_text((root / "deploy/.env.example").read_text())
                prepare.prepare(env)
                result = subprocess.run(["docker", "compose", "--project-directory", str(project),
                    "--env-file", str(env), "-f", str(project / "docker-compose.yml"),
                    "-f", str(project / f"docker-compose.{overlay}.yml"), "config", "--no-env-resolution", "--format", "json"],
                    text=True, capture_output=True, env={k: v for k, v in os.environ.items() if k != "AGENT_RUNTIME_SERVICE_TOKEN"})
                self.assertEqual(result.returncode, 0, result.stderr)
                services = json.loads(result.stdout)["services"]
                runtime = services["agent-runtime"]
                settings = runtime["environment"]
                hosts = json.loads(settings["AGENT_RUNTIME_HOSTS"])
                self.assertEqual(hosts[0]["token"], services[workbench]["environment"]["AGENT_RUNTIME_SERVICE_TOKEN"])
                self.assertEqual(settings["AGENT_RUNTIME_DATABASE"], database)
                self.assertEqual(settings["AGENT_RUNTIME_SCHEMA"], "agent_runtime")
                self.assertNotIn("ports", runtime)
                self.assertEqual(runtime["volumes"][0]["target"], "/data")
                self.assertIn("/ontomato-agent-runtime:", runtime["image"])
                self.assertIn("agent-runtime", services[workbench]["depends_on"])


if __name__ == "__main__":
    unittest.main()
