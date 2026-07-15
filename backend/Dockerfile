FROM python:3.11-slim
 
WORKDIR /app
 
# Environment variables

ENV FLASK_ENV=production

ENV PYTHONUNBUFFERED=1
 
ENV AZURE_TENANT_ID=

ENV AZURE_CLIENT_ID=

ENV AZURE_CLIENT_SECRET=
 
# Install pandoc

RUN apt-get update && rm -rf /var/lib/apt/lists/*
 
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt && \

    pip install --no-cache-dir azure-communication-email==1.1.0 azure-identity==1.25.1 pypandoc==1.16.2 python-docx==1.2.0
 
COPY . .

RUN mkdir -p logs temp_dir
 
# Create non-root user

RUN adduser --disabled-password --gecos '' appuser

RUN chown -R appuser:appuser /app

USER appuser
 
EXPOSE 5000
 
# Health check

HEALTHCHECK --interval=120s --timeout=10s --start-period=5s --retries=3 \

  CMD python -c "import requests; requests.get('http://localhost:5000/health')" || exit 1
 
CMD ["python", "app.py"]

 
