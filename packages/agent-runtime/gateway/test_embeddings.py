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
        # Keep the provider cases aligned with supportsEmbeddings in contracts/src/model-settings.ts.
        for provider, model_name, api_base, url in (
            ("custom_openai", "text-embedding-v4", "https://custom.example/v1",
             "https://custom.example/v1/embeddings"),
            ("custom_openai", "custom-embed-v1", "https://custom.example/v1",
             "https://custom.example/v1/embeddings"),
            ("openai", "text-embedding-3-small", None, "https://api.openai.com/v1/embeddings"),
            ("azure", "text-embedding-3-small", "https://azure.example",
             "https://azure.example/openai/deployments/text-embedding-3-small/embeddings"),
            ("dashscope", "text-embedding-v4", None,
             "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings"),
            ("gemini", "gemini-embedding-001", None,
             "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents"),
            ("bigmodel", "embedding-3", None, "https://open.bigmodel.cn/api/paas/v4/embeddings"),
            ("bigmodel", "embedding-3", "https://bigmodel.example/v4",
             "https://bigmodel.example/v4/embeddings"),
        ):
            with self.subTest(provider=provider, model=model_name):
                store = LeaseStore()
                lease = store.issue({
                    "embedding": Model(
                        litellm_params={
                            "model": f"{provider}/{model_name}",
                            "api_base": api_base,
                            "api_key": "test-key",
                            "max_retries": 0,
                        },
                        model_info={"dimensions": 2048},
                    ),
                })
                upstream_requests = []

                async def upstream(request):
                    body = json.loads(request.content)
                    upstream_requests.append(request)
                    if provider == "gemini":
                        dimensions = body["requests"][0]["outputDimensionality"]
                        return httpx.Response(200, json={"embeddings": [{"values": [0.0] * dimensions}]})
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
                (request,) = upstream_requests
                self.assertEqual(request.method, "POST")
                self.assertEqual(str(request.url.copy_with(query=None)), url)
                body = json.loads(request.content)
                if provider == "gemini":
                    (item,) = body["requests"]
                    self.assertEqual(item["outputDimensionality"], 2048)
                    self.assertEqual(item["content"]["parts"], [{"text": "test"}])
                else:
                    self.assertEqual(body["dimensions"], 2048)
                    self.assertEqual(body["input"], ["test"])
                    self.assertEqual(body["model"], model_name)
                if provider == "bigmodel":
                    self.assertEqual(body, {"model": model_name, "input": ["test"], "dimensions": 2048})
                    self.assertEqual(request.headers["Authorization"], "Bearer test-key")
                self.assertEqual(len(response.json()["data"][0]["embedding"]), 2048)
