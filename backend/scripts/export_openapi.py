"""Export the FastAPI OpenAPI contract as deterministic JSON.

Used by the P14 web client drift-check (`web:spec-drift` CI job): the web
API client is GENERATED from this contract (MASTER_PROMPT 2.1/2.3), and the
committed snapshot at `web/packages/api-client/openapi.json` must always
match what the backend actually serves.

Usage: python scripts/export_openapi.py <output-path|->
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from genesis.api.app import create_app

# The #31 batch-13 boot guard (review B13-R5) refuses to construct the
# app without >=32 bytes of cursor-signing key. This script only
# RENDERS the OpenAPI contract — no server, no request, no cursor is
# ever minted or verified, and the rendered spec does not depend on
# the key's value — so a deterministic render-only placeholder
# satisfies the guard without weakening it anywhere a request could
# be served. NOT a secret (gate 1.6: real key material comes from
# CI/CD variables / the environment in every serving deployment).
os.environ.setdefault("CURSOR_SIGNING_KEY", "openapi-render-only-placeholder-0123456789")


def render_spec() -> str:
    """Serialize the app's OpenAPI spec with stable key ordering."""
    spec = create_app().openapi()
    return json.dumps(spec, indent=2, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write("usage: export_openapi.py <output-path|->\n")
        return 2
    payload = render_spec()
    if argv[1] == "-":
        sys.stdout.write(payload)
    else:
        destination = Path(argv[1])
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
