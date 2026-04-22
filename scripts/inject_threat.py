#!/usr/bin/env python3
"""Send a manual threat injection command to AutoCM via WebSocket."""

import argparse
import asyncio
import json
import time

import websockets


async def inject_threat(host: str, port: int, satellite_id: str) -> int:
    uri = f"ws://{host}:{port}/ws/telemetry"
    payload = {
        "type": "inject_threat",
        # Backend enforces a 10s command latency requirement.
        "timestamp": time.time() - 11.0,
        "satellite_id": satellite_id,
    }

    print(f"Connecting to {uri}")
    async with websockets.connect(uri) as websocket:
        await websocket.send(json.dumps(payload))
        print("Command sent:", payload)

        response = await websocket.recv()
        print("Response:", response)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Inject a manual threat into AutoCM.")
    parser.add_argument("satellite_id", nargs="?", default="SAT-Alpha-01",
                        help="Satellite ID to mark as threatened (default: SAT-Alpha-01)")
    parser.add_argument("--host", default="127.0.0.1",
                        help="API host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000,
                        help="API port (default: 8000)")

    args = parser.parse_args()
    return asyncio.run(inject_threat(args.host, args.port, args.satellite_id))


if __name__ == "__main__":
    raise SystemExit(main())
