"""Check actual upstream request lines using the gateway's pinned Nginx base, without product images."""
import http.client
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[1]
RECIPE = ROOT / "docker/gateway"
# The production recipe owns the base image and its digest.
IMAGE = next(line.split()[1] for line in (RECIPE / "Dockerfile").read_text().splitlines()
             if line.startswith("FROM "))


def docker(*args):
    return subprocess.run(["docker", *args], check=True, text=True, capture_output=True).stdout.strip()


class GatewayRoutingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        docker("info", "--format", "{{.ServerVersion}}")
        present = subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True)
        if present.returncode:
            docker("pull", IMAGE)

    def check_routes(self, prefix, development):
        name = "ontomato-gateway-routing-" + uuid.uuid4().hex[:12]
        legacy = "data-agent" if prefix else "ontomato"
        web_mount = prefix + "/" if development else "/"
        manager_mount = prefix + "/ontology-manager/" if development else "/"
        with tempfile.TemporaryDirectory(prefix="ontomato-gateway-routing-") as temp:
            echoes = Path(temp) / "echo.conf"
            # Separate loopback upstreams distinguish a correct URI from routing to the wrong service.
            echoes.write_text("\n".join(
                f'''server {{
  listen 127.0.0.1:{port};
  location / {{
    default_type text/plain;
    add_header X-Echo-Upstream {service};
    return 200 "$request\\n";
  }}
}}'''
                for port, service in [(9001, "java"), (9002, "node"), (9003, "manager"), (9004, "web")]
            ))
            args = ["run", "--detach", "--pull=never", "--name", name,
                    "--publish", "127.0.0.1::80", "--entrypoint", "/bin/sh"]
            for source, destination in [
                (RECIPE / "docker-entrypoint.sh", "/gateway-entrypoint.sh"),
                (RECIPE / "nginx.conf.template", "/etc/nginx/templates/gateway.conf.template"),
                (echoes, "/etc/nginx/conf.d/echo.conf"),
            ]:
                args += ["--volume", f"{source}:{destination}:ro"]
            for key, value in {
                "PUBLIC_BASE_PATH": prefix, "LEGACY_API_PREFIX": legacy,
                "WORKBENCH_UPSTREAM": "127.0.0.1:9002", "WEB_UPSTREAM": "127.0.0.1:9004",
                "MANAGER_UPSTREAM": "127.0.0.1:9003", "JAVA_UPSTREAM": "127.0.0.1:9001",
                "WEB_MOUNT": web_mount, "MANAGER_MOUNT": manager_mount,
            }.items():
                args += ["--env", f"{key}={value}"]
            try:
                docker(*args, IMAGE, "/gateway-entrypoint.sh", "/bin/sh", "-c",
                       'nginx -t && exec nginx -g "daemon off;"')
                port = int(docker("port", name, "80/tcp").rsplit(":", 1)[1])
                deadline = time.monotonic() + 15
                while True:
                    try:
                        self.request(port, prefix + "/")
                        break
                    except (OSError, http.client.HTTPException):
                        if time.monotonic() >= deadline:
                            self.fail("Gateway startup failed:\n" + docker("logs", name))
                        time.sleep(0.1)

                # Encoded delimiters, double encoding and repeated query keys must arrive verbatim.
                suffix = "files/report%20%E4%B8%AD%E6%96%87%2Fpart%3Fname%2520.txt"
                query = "?q=a%20b&q=%E4%B8%AD%E6%96%87&slash=%2F&question=%3F&empty="
                for source, target, service in [
                    ("/api/data-query/", "/", "java"),
                    ("/api/resources/", "/api/resources/", "node"),
                    ("/ontology-manager/", manager_mount, "manager"),
                    (f"/{legacy}/", "/", "java"),
                    ("/assets/", web_mount + "assets/", "web"),
                ]:
                    for params in ["", query]:
                        request_target = prefix + source + suffix + params
                        with self.subTest(prefix=prefix, development=development, target=request_target):
                            self.assert_upstream(port, request_target, target + suffix + params, service)

                for source, target, service in [
                    ("/api/data-query", "/", "java"),
                    ("/api/data-query/", "/", "java"),
                    ("/api", "/api", "node"),
                    ("/mcp/analysis-agents", "/mcp/analysis-agents", "node"),
                    ("/config.js", "/config.js", "node"),
                    ("/api/auth/verifyTicket", "/sso/verifyTicket", "java"),
                ]:
                    for params in ["", query]:
                        with self.subTest(prefix=prefix, development=development, source=source, query=params):
                            self.assert_upstream(port, prefix + source + params, target + params, service)
                self.assert_upstream(port, prefix + "/api/data-query/" + suffix + query,
                                     "/" + suffix + query, "java", method="POST")
                print(f"nginx -t and 23 upstream request lines passed: prefix={prefix or '/'} "
                      f"mode={'development' if development else 'production'}", flush=True)
            finally:
                subprocess.run(["docker", "rm", "--force", name], capture_output=True)

    @staticmethod
    def request(port, target, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            connection.request(method, target, body=b"probe" if method == "POST" else None)
            response = connection.getresponse()
            return response.status, response.getheader("X-Echo-Upstream"), response.read().decode()
        finally:
            connection.close()

    def assert_upstream(self, port, source, target, service, method="GET"):
        status, actual_service, request_line = self.request(port, source, method)
        self.assertEqual((status, actual_service, request_line),
                         (200, service, f"{method} {target} HTTP/1.1\n"))

    def test_root_production(self):
        self.check_routes("", False)

    def test_prefixed_production(self):
        self.check_routes("/wenshu", False)

    def test_root_development(self):
        self.check_routes("", True)

    def test_prefixed_development(self):
        self.check_routes("/wenshu", True)


if __name__ == "__main__":
    unittest.main()
