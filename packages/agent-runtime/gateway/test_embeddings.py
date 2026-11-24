"""Exercise the lease's embedding dimensions through LiteLLM without an upstream service."""

import json
import unittest
from unittest.mock import patch

import httpx
import litellm

from leases import LeaseStore, Model
from server import DATA, app


class ModelGatewayEmbeddingTest(unittest.IsolatedAsyncioTestCase):
    async def test_leased_dimensions_reach_the_provider(self):
        for provider, model_name in (
            ("custom_openai", "text-embedding-v4"),
            ("custom_openai", "custom-embed-v1"),
            ("openai", "text-embedding-v3"),
            ("dashscope", "text-embedding-v4"),
        ):
            with self.subTest(provider=provider, model=model_name):
                store = LeaseStore()
                lease = store.issue({
                    "embedding": Model(
                        litellm_params={
                            "model": f"{provider}/{model_name}",
                            "api_base": "https://dashscope.example/compatible-mode/v1",
                            "api_key": "test-key",
                            "max_retries": 0,
                        },
                        model_info={"dimensions": 2048},
                    ),
                })
                upstream_bodies = []

                async def upstream(request):
                    body = json.loads(request.content)
                    upstream_bodies.append(body)
                    return httpx.Response(200, json={
                        "object": "list",
                        "data": [{"object": "embedding", "index": 0, "embedding": [0.0] * body.get("dimensions", 1024)}],
                        "model": model_name,
                        "usage": {"prompt_tokens": 1, "total_tokens": 1},
                    })

                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app(DATA, store)),
                    base_url="http://gateway.test",
                ) as client:
                    with (
                        patch.object(litellm, "disable_aiohttp_transport", True),
                        patch.object(httpx.AsyncHTTPTransport, "handle_async_request", side_effect=upstream),
                    ):
                        response = await client.post("/v1/embeddings", headers={
                            "Authorization": f"Bearer {lease.token}",
                        }, json={"model": "embedding", "input": ["test"], "dimensions": 64})

                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(upstream_bodies[0].get("dimensions"), 2048)
                self.assertEqual(len(response.json()["data"][0]["embedding"]), 2048)
