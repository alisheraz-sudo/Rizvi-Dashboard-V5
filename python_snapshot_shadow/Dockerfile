FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY snapshot_recovery.py /app/snapshot_recovery.py
COPY python_snapshot_shadow/app.py /app/app.py
EXPOSE 8080
CMD ["python", "/app/app.py"]
