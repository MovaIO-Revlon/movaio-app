FROM python:3.11-slim

WORKDIR /app

# Environment variables
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1

# Install pandoc
RUN apt-get update && apt-get install -y pandoc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt 

COPY . .
RUN mkdir -p logs

# Create non-root user
RUN adduser --disabled-password --gecos '' appuser
RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 5002

# # Health check
# HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
#   CMD python -c "import requests; requests.get('http://localhost:5002/health')" || exit 1

CMD ["uvicorn", "app:asgi_app", "--host", "0.0.0.0", "--port", "5002"]
