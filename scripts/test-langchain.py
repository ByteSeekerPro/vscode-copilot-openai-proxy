#!/usr/bin/env python3
"""
LangChain integration test for VS Code LM API Bridge.

Verifies that the bridge exposes a valid OpenAI-compatible API by running
non-streaming and (optionally) streaming completions through LangChain.

Usage (recommended — run from the scripts/ directory with uv)
──────────────────────────────────────────────────────────────
    cd scripts

    uv run test-langchain.py                   # auto-installs deps, auto-detects model
    uv run test-langchain.py --stream          # also run streaming test
    uv run test-langchain.py --model copilot-gpt-4o --port 9090 --stream

uv reads pyproject.toml in this directory and manages a local virtualenv
automatically — no manual pip install needed.

Alternatively, with plain python
──────────────────────────────────
    pip install langchain-openai langchain-core
    python scripts/test-langchain.py

Prerequisites
─────────────
    - uv  (https://docs.astral.sh/uv/) — or pip + python 3.11+
    - VS Code LM API Bridge server must be running before executing this script
"""

import argparse
import json
import sys
import urllib.request


# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch_models(base_url: str) -> list[str]:
    """Return the list of model IDs from the /v1/models endpoint."""
    try:
        with urllib.request.urlopen(f"{base_url}/models", timeout=5) as resp:
            data = json.loads(resp.read())
            return [m["id"] for m in data.get("data", [])]
    except Exception as exc:
        print(f"[WARN] Could not reach {base_url}/models — {exc}")
        return []


def run_test(name: str, fn) -> bool:
    """Run a single test function and print pass/fail."""
    print(f"\n[TEST] {name}")
    try:
        fn()
        print("  ✅  PASSED")
        return True
    except AssertionError as exc:
        print(f"  ❌  FAILED (assertion): {exc}")
    except Exception as exc:
        print(f"  ❌  FAILED (error): {exc}")
    return False


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_basic(llm) -> None:
    """Non-streaming chat completion with a system and user message."""
    from langchain_core.messages import HumanMessage, SystemMessage

    messages = [
        SystemMessage(content="You are a concise assistant. Keep your answers very short."),
        HumanMessage(content="What is 2 + 2? Answer in exactly one sentence."),
    ]
    response = llm.invoke(messages)
    assert response.content, "Expected non-empty response content"
    print(f"  Answer : {response.content.strip()}")


def test_streaming(llm) -> None:
    """Streaming chat completion — verifies at least one chunk is received."""
    from langchain_core.messages import HumanMessage

    chunks = []
    print("  Stream : ", end="", flush=True)
    for chunk in llm.stream([HumanMessage(content="Count from 1 to 5, one number per line.")]):
        if chunk.content:
            print(chunk.content, end="", flush=True)
            chunks.append(chunk.content)
    print()
    assert chunks, "Expected at least one streamed chunk but received none"


def test_models_endpoint(base_url: str) -> None:
    """Check that /v1/models returns a non-empty list."""
    models = fetch_models(base_url)
    assert models, "Expected at least one model from /v1/models"
    print(f"  Models : {', '.join(models)}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="LangChain integration test for VS Code LM API Bridge",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--port",   type=int, default=9090,
                        help="Bridge port (default: 9090)")
    parser.add_argument("--model",  type=str, default=None,
                        help="Model ID to use (auto-detected from /v1/models if omitted)")
    parser.add_argument("--stream", action="store_true",
                        help="Also run the streaming completion test")
    args = parser.parse_args()

    base_url = f"http://127.0.0.1:{args.port}/v1"

    # ── Dependency check ──────────────────────────────────────────────────────
    try:
        from langchain_openai import ChatOpenAI  # noqa: F401
    except ImportError:
        print("ERROR: langchain-openai is not installed.")
        print("       Run:  pip install langchain-openai langchain-core")
        sys.exit(1)
    from langchain_openai import ChatOpenAI

    # ── Model selection ───────────────────────────────────────────────────────
    model_id = args.model
    if not model_id:
        available = fetch_models(base_url)
        if not available:
            print(
                "ERROR: No models returned by the bridge and --model was not specified.\n"
                "       Make sure the LM API Bridge server is running in VS Code."
            )
            sys.exit(1)
        model_id = available[0]
        print(f"[INFO] Auto-selected model: {model_id}")
    else:
        print(f"[INFO] Using model        : {model_id}")

    print(f"[INFO] Base URL           : {base_url}\n")

    # ── Build the LangChain client ────────────────────────────────────────────
    llm = ChatOpenAI(
        base_url=base_url,
        api_key="not-needed",   # Bridge does not require authentication
        model=model_id,
    )

    # ── Run tests ─────────────────────────────────────────────────────────────
    tests: list[tuple[str, object]] = [
        ("Models endpoint (/v1/models)",   lambda: test_models_endpoint(base_url)),
        ("Non-streaming chat completion",  lambda: test_basic(llm)),
    ]
    if args.stream:
        tests.append(("Streaming chat completion", lambda: test_streaming(llm)))

    results = [run_test(name, fn) for name, fn in tests]
    passed  = sum(results)
    failed  = len(results) - passed

    print(f"\n{'─' * 50}")
    print(f" {passed}/{len(results)} tests passed")
    print(f"{'─' * 50}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
