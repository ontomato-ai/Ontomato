"""The model gateway: one LiteLLM SDK process for every model call of this deployment.

It serves two planes on separate loopback ports. The data plane answers OpenAI's Chat, Responses and
Embeddings APIs for the models a lease allows; the control plane issues and revokes leases and lists a
connection's models. Only the runtime reaches the control plane, and the sandbox that runs an engine
reaches nothing but the data plane.

Client requests never choose the upstream: the model name must be in the lease, and its address, key,
timeout and retries come from the lease's entry. Anything a client sends under those names is dropped.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import socket
import sys
from typing import AsyncIterator

os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "true")

import litellm
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from leases import Lease, LeaseStore, Model

litellm.drop_params = True
litellm.suppress_debug_info = True
litellm.telemetry = False

log = logging.getLogger("gateway")

# Upstream fields a request may not set: the connection owns them.
PROTECTED = frozenset({
    "model", "api_base", "api_key", "api_version", "api_type", "base_url", "custom_llm_provider",
    "headers", "extra_headers", "timeout", "request_timeout", "max_retries", "num_retries", "dimensions",
})


class GatewayError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def error_body(error: BaseException) -> dict:
    status = getattr(error, "status_code", None)
    return {"error": {
        "message": str(error),
        "type": type(error).__name__,
        "code": getattr(error, "code", None) or (f"HTTP_{status}" if status else "GATEWAY_ERROR"),
    }}


def error_status(error: BaseException) -> int:
    status = getattr(error, "status_code", None)
    return status if isinstance(status, int) and 400 <= status < 600 else 502


def failure(error: BaseException) -> JSONResponse:
    log.warning("model call failed: %s", error)
    return JSONResponse(error_body(error), status_code=error_status(error))


def payload(value: object) -> str:
    return json.dumps(value.model_dump() if hasattr(value, "model_dump") else value)


def sse(data: str) -> bytes:
    return f"data: {data}\n\n".encode()


def lease_of(request: Request) -> Lease:
    """The lease this request's bearer token belongs to; expired or foreign tokens reach nothing."""
    header = request.headers.get("authorization") or ""
    if not header.startswith("Bearer "):
        raise GatewayError(401, "A model lease token is required")
    lease = request.app.state.leases.by_token(header[len("Bearer "):])
    if lease is None:
        raise GatewayError(401, "Unknown or revoked model lease")
    return lease


def leased_model(lease: Lease, body: dict) -> Model:
    name = body.get("model")
    model = lease.models.get(name) if isinstance(name, str) else None
    if model is None:
        raise GatewayError(400, f"The lease does not include the model {name!r}")
    return model


def call_params(model: Model, body: dict, stream: bool) -> dict:
    params = {key: value for key, value in model.litellm_params.items() if value is not None}
    for key, value in body.items():
        if key not in PROTECTED:
            params[key] = value
    params["stream"] = stream
    return params


def embedding_params(model: Model, body: dict) -> dict:
    params = {key: value for key, value in model.litellm_params.items() if value is not None}
    prefix, _, upstream = str(params["model"]).partition("/")
    # LiteLLM maps no embedding handler for custom_openai; those connections are OpenAI-compatible servers.
    params["model"] = f"openai/{upstream}" if prefix == "custom_openai" else params["model"]
    params["input"] = body.get("input")
    if model.model_info.get("dimensions") is not None:
        params["dimensions"] = model.model_info["dimensions"]
    return params


async def first_frame(iterator: AsyncIterator) -> object | None:
    """The first frame, pulled before a response starts so that an upstream failure can still be a status."""
    try:
        return await iterator.__anext__()
    except StopAsyncIteration:
        return None


def event_frame(event: dict) -> bytes:
    name = getattr(event.get("type"), "value", event.get("type"))
    return f"event: {name}\n".encode() + sse(json.dumps(event))


async def chat(request: Request) -> Response:
    body = await request.json()
    model = leased_model(lease_of(request), body)
    stream = bool(body.get("stream"))
    params = call_params(model, body, stream)
    if not stream:
        try:
            return JSONResponse((await litellm.acompletion(**params)).model_dump())
        except Exception as error:  # noqa: BLE001 - the upstream's own failure is the answer
            return failure(error)
    try:
        iterator = await litellm.acompletion(**params)
        first = await first_frame(iterator)
    except Exception as error:  # noqa: BLE001 - before the first frame a status is still possible
        return failure(error)

    async def frames() -> AsyncIterator[bytes]:
        try:
            if first is not None:
                yield sse(payload(first))
            async for chunk in iterator:
                yield sse(payload(chunk))
        except Exception as error:  # noqa: BLE001 - the stream has started; report inside it
            log.warning("chat stream broke: %s", error)
            yield sse(payload(error_body(error)))
        finally:
            await iterator.aclose()
        yield b"data: [DONE]\n\n"

    return StreamingResponse(frames(), media_type="text/event-stream")


async def responses(request: Request) -> Response:
    body = await request.json()
    model = leased_model(lease_of(request), body)
    stream = bool(body.get("stream"))
    params = call_params(model, body, stream)
    if not stream:
        try:
            return JSONResponse((await litellm.aresponses(**params)).model_dump())
        except Exception as error:  # noqa: BLE001
            return failure(error)
    try:
        iterator = await litellm.aresponses(**params)
        first = await first_frame(iterator)
    except Exception as error:  # noqa: BLE001
        return failure(error)

    async def frames() -> AsyncIterator[bytes]:
        try:
            if first is not None:
                yield event_frame(first.model_dump())
            async for chunk in iterator:
                yield event_frame(chunk.model_dump())
        except Exception as error:  # noqa: BLE001
            log.warning("responses stream broke: %s", error)
            yield event_frame({"type": "error", **error_body(error)})
        finally:
            await iterator.aclose()

    return StreamingResponse(frames(), media_type="text/event-stream")


async def embeddings(request: Request) -> Response:
    body = await request.json()
    model = leased_model(lease_of(request), body)
    try:
        response = await litellm.aembedding(**embedding_params(model, body))
    except Exception as error:  # noqa: BLE001
        return failure(error)
    return JSONResponse(response.model_dump())


async def issue_lease(request: Request) -> Response:
    body = await request.json()
    models = {name: Model(**entry) for name, entry in body["models"].items()}
    lease = request.app.state.leases.issue(models)
    return JSONResponse({"id": lease.id, "token": lease.token})


async def revoke_lease(request: Request) -> Response:
    request.app.state.leases.revoke(request.path_params["id"])
    return Response(status_code=204)


async def discover(request: Request) -> Response:
    body = await request.json()
    connection = body["connection"]
    provider = connection["provider"]
    names = await asyncio.to_thread(
        litellm.get_valid_models,
        custom_llm_provider="openai" if provider == "custom_openai" else provider,
        api_base=connection.get("apiBase"),
        api_key=connection["apiKey"],
        check_provider_endpoint=True,
    )
    if names is None:
        raise GatewayError(502, "The provider returned no model list")
    return JSONResponse({"models": [{"id": name} for name in names]})


def refuse(request: Request, error: Exception) -> JSONResponse:
    return JSONResponse(error_body(error), status_code=error.status)


def app(routes: list, store: LeaseStore) -> Starlette:
    application = Starlette(routes=routes, exception_handlers={GatewayError: refuse})
    application.state.leases = store
    return application


DATA = [
    Route("/v1/chat/completions", chat, methods=["POST"]),
    Route("/v1/responses", responses, methods=["POST"]),
    Route("/v1/embeddings", embeddings, methods=["POST"]),
]
CONTROL = [
    Route("/leases", issue_lease, methods=["POST"]),
    Route("/leases/{id}", revoke_lease, methods=["DELETE"]),
    Route("/discover", discover, methods=["POST"]),
]


def listening() -> socket.socket:
    handle = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    handle.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    handle.bind(("127.0.0.1", 0))
    handle.listen(2048)
    return handle


async def serve(routes: list, store: LeaseStore, handle: socket.socket) -> uvicorn.Server:
    server = uvicorn.Server(uvicorn.Config(app(routes, store), log_config=None, lifespan="off"))
    asyncio.get_running_loop().create_task(server.serve(sockets=[handle]))
    while not server.started:
        await asyncio.sleep(0.01)
    return server


async def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="gateway %(levelname)s %(message)s")
    store = LeaseStore()
    control, data = listening(), listening()
    servers = [
        await serve(CONTROL, store, control),
        await serve(DATA, store, data),
    ]
    print(json.dumps({"control": control.getsockname()[1], "data": data.getsockname()[1]}), flush=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for received in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(received, stop.set)
    await stop.wait()
    for server in servers:
        await server.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
