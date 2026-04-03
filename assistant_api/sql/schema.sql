-- FraudLens Assistant RAG schema (BigQuery)
-- Replace `YOUR_PROJECT.YOUR_DATASET` before running.

-- 1) Chunk store (text + embedding + citations)
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT.YOUR_DATASET.rag_chunks` (
  chunkId STRING NOT NULL,
  incidentId STRING,
  reportType STRING,
  reportId STRING,
  objectPath STRING,
  sha256 STRING,
  fileUrl STRING,
  source STRING,
  chunkIndex INT64,
  chunkText STRING,
  embedding ARRAY<FLOAT64>,
  updatedAt TIMESTAMP
);

-- 1b) Artifact metadata mirror (Chronos/GCS pointers + sha256)
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT.YOUR_DATASET.doc_artifacts` (
  artifactId STRING NOT NULL,
  incidentId STRING,
  reportType STRING,
  reportId STRING,
  objectPath STRING,
  gcsPath STRING,
  sha256 STRING,
  contentType STRING,
  fileUrl STRING,
  updatedAt TIMESTAMP
);

-- Optional clustering for cheaper filtered reads.
-- BigQuery doesn't support altering clustering easily on existing tables in all cases;
-- create table with clustering if you know it upfront.

-- 2) Exact facts table (deterministic answers)
CREATE TABLE IF NOT EXISTS `YOUR_PROJECT.YOUR_DATASET.incident_facts` (
  incidentId STRING NOT NULL,
  amount FLOAT64,
  currency STRING,
  status STRING,
  fraudScore FLOAT64,
  modelDecision BOOL,
  ncrpStatus STRING,
  timestamp TIMESTAMP,
  factsJson STRING,
  updatedAt TIMESTAMP
);

-- 3) Vector index (recommended once rag_chunks is populated)
-- Run after you have embeddings stored in `embedding`.
-- Note: index build/refresh uses BigQuery vector index capabilities.
CREATE VECTOR INDEX IF NOT EXISTS `rag_chunks_embedding_idx`
ON `YOUR_PROJECT.YOUR_DATASET.rag_chunks`(embedding)
OPTIONS(
  index_type = 'IVF',
  distance_type = 'COSINE'
);

