# ═══════════════════════════════════════════════════════════════════════════
#  ACM — Dockerfile (v2 Pure Python)
#  Autonomous Constellation Manager | National Space Hackathon 2026
# ═══════════════════════════════════════════════════════════════════════════

# Use the required base image per Section 8 of the spec
FROM ubuntu:22.04

WORKDIR /app

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install Python 3.11 and dependencies
RUN apt-get update && apt-get install -y \
    python3.11 python3.11-dev python3-pip \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
# requirements.txt contains: fastapi, uvicorn, numpy, scipy, etc.
COPY api/requirements.txt ./requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application layers
COPY api/ ./api/
COPY data/ ./data/
COPY frontend/ ./frontend/

# Ensure host-OS engine binaries (like .pyd or .so) aren't mixed in
RUN rm -f ./core/autocm_engine*.so ./core/autocm_engine*.pyd 2>/dev/null || true

# Generate catalog if not present (seeds the sim with initial objects)
RUN cd /app/data && python3 generate_catalog.py 2>/dev/null || echo "[OK] Using existing catalog"

EXPOSE 8000

# High-performance Uvicorn worker
CMD ["python3", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
