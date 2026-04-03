# FraudLens Assistant API (Cloud Run)

Backend service for the dashboard chatbot:

- Verifies **Firebase ID tokens** (JWT) using public signing keys
- Uses **Vertex AI (Gemini)** to generate answers
- Uses **BigQuery vector search** for enterprise retrieval (optional until tables exist)
- Returns **audit-friendly citations** (incidentId, reportType, objectPath, sha256, fileUrl)

## Endpoints

- `GET /api/assistant/health`
- `POST /api/assistant/chat`
- `POST /api/assistant/ingest/report`
- `POST /api/assistant/ingest/facts`

## Required env vars

### Auth

- `FIREBASE_PROJECT_ID` (Firebase project where Auth lives)
- `REQUIRE_AUTH` (default `true`)

### Vertex AI

- `VERTEX_PROJECT_ID` (GCP project hosting Vertex AI)
- `VERTEX_LOCATION` (e.g. `asia-south1`)
- `VERTEX_GEMINI_MODEL` (e.g. `gemini-2.0-flash-001`)
- `VERTEX_EMBED_MODEL` (e.g. `text-embedding-004`)

### BigQuery (for RAG + facts)

- `BQ_PROJECT_ID`
- `BQ_DATASET`
- `BQ_CHUNKS_TABLE` (default `rag_chunks`)
- `BQ_FACTS_TABLE` (default `incident_facts`)
- `ENABLE_VECTOR_SEARCH` (default `true`)

### Evidence links

- `CHRONOS_API_BASE` (e.g. `https://chronos-api-...run.app`)

## BigQuery schema

Create tables + vector index using:

- `sql/schema.sql`

## Frontend wiring

Set in the React app:

- `REACT_APP_ASSISTANT_API=https://<assistant-cloud-run-url>`

Then the floating **Ask Assistant** widget appears in both IT and Executive dashboards.

