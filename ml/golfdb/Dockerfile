# Swing analyzer v2 — SwingNet inference service (FastAPI).
FROM python:3.12-slim

# OpenCV (headless) + ffmpeg for video decoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch first so the CUDA build isn't pulled in transitively
RUN pip install --no-cache-dir \
    torch==2.12.1 torchvision==0.27.1 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code (SwingNet model + pipeline + service) and weights
COPY MobileNetV2.py model.py eval.py dataloader.py util.py pipeline.py service.py ./
COPY models/ ./models/
COPY yolov8n.pt ./yolov8n.pt

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8000"]
