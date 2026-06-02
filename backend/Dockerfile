FROM python:3.12-slim

WORKDIR /app

# Speed-of-light layer caching: copy only deps manifest first.
COPY pyproject.toml ./

# Copy source needed by the hatchling build backend.
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir .

EXPOSE 8000

# Use `python -m` so we're invoking uvicorn from the same interpreter
# that did the install, regardless of PATH activation state.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
