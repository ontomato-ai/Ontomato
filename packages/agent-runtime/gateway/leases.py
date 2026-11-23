"""Model leases held in memory by the gateway process.

A lease is what the runtime issues when it needs models: for a run (one engine process), for one
embedding rebuild, one connection test or one model listing. It names the models the caller may use
and carries the upstream parameters the runtime resolved, including the decrypted key. Nothing is
written to disk: a lease exists while the runtime keeps it, and revoking it makes the token useless.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from typing import Dict


@dataclass(frozen=True)
class Model:
    """One model as the runtime resolved it: LiteLLM's own entry shape."""

    litellm_params: Dict[str, object] = field(default_factory=dict)
    model_info: Dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class Lease:
    id: str
    token: str
    models: Dict[str, Model]


class LeaseStore:
    def __init__(self) -> None:
        self._leases: Dict[str, Lease] = {}

    def issue(self, models: Dict[str, Model]) -> Lease:
        lease = Lease(id=secrets.token_urlsafe(16), token=secrets.token_urlsafe(32), models=models)
        self._leases[lease.id] = lease
        return lease

    def by_token(self, token: str) -> Lease | None:
        for lease in self._leases.values():
            if secrets.compare_digest(lease.token, token):
                return lease
        return None

    def revoke(self, lease_id: str) -> None:
        self._leases.pop(lease_id, None)

    def __len__(self) -> int:
        return len(self._leases)
