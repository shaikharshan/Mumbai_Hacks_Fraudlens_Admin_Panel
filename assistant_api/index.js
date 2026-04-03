require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { BigQuery } = require('@google-cloud/bigquery');
const { VertexAI } = require('@google-cloud/vertexai');
const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const {
  createRemoteJWKSet,
  jwtVerify,
  errors: JoseErrors
} = require('jose');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const FIREBASE_PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || '').trim();
const REQUIRE_AUTH = (process.env.REQUIRE_AUTH || 'true').trim().toLowerCase() !== 'false';

const VERTEX_PROJECT_ID = (process.env.VERTEX_PROJECT_ID || process.env.GCP_PROJECT_ID || '').trim();
const VERTEX_LOCATION = (process.env.VERTEX_LOCATION || 'asia-south1').trim();
const VERTEX_GEMINI_MODEL = (process.env.VERTEX_GEMINI_MODEL || 'gemini-2.0-flash-001').trim();
const VERTEX_EMBED_MODEL = (process.env.VERTEX_EMBED_MODEL || 'text-embedding-004').trim();

const CHRONOS_API_BASE = (process.env.CHRONOS_API_BASE || '').trim().replace(/\/$/, '');

const BQ_PROJECT_ID = (process.env.BQ_PROJECT_ID || '').trim();
const BQ_DATASET = (process.env.BQ_DATASET || '').trim();
const BQ_ARTIFACTS_TABLE = (process.env.BQ_ARTIFACTS_TABLE || 'doc_artifacts').trim();
const BQ_CHUNKS_TABLE = (process.env.BQ_CHUNKS_TABLE || 'rag_chunks').trim();
const BQ_FACTS_TABLE = (process.env.BQ_FACTS_TABLE || 'incident_facts').trim();
const ENABLE_VECTOR_SEARCH = (process.env.ENABLE_VECTOR_SEARCH || 'true').trim().toLowerCase() !== 'false';

const bigquery = BQ_PROJECT_ID ? new BigQuery({ projectId: BQ_PROJECT_ID }) : null;
const vertex = VERTEX_PROJECT_ID ? new VertexAI({ project: VERTEX_PROJECT_ID, location: VERTEX_LOCATION }) : null;
const gAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform']
});

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com')
);

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex');
}

async function verifyFirebaseIdToken(req) {
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();

  if (!token) {
    if (REQUIRE_AUTH) throw new Error('Missing Authorization bearer token.');
    return { uid: null, token: null };
  }
  if (!FIREBASE_PROJECT_ID) {
    throw new Error('Server misconfigured: FIREBASE_PROJECT_ID is required to verify tokens.');
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID
    });
    return { uid: payload.user_id || payload.sub || null, token, payload };
  } catch (e) {
    if (e instanceof JoseErrors.JWTExpired) throw new Error('Token expired.');
    throw new Error('Invalid token.');
  }
}

async function embedText(text) {
  if (!VERTEX_PROJECT_ID) throw new Error('Vertex AI not configured (VERTEX_PROJECT_ID missing).');
  const client = await gAuth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === 'string' ? token : token?.token;
  if (!accessToken) throw new Error('Failed to acquire GCP access token for embeddings.');

  const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_EMBED_MODEL}:predict`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      instances: [{ content: String(text || '') }]
    })
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(body || 'Vertex embedding error');
  }
  const data = await resp.json();
  const values = data?.predictions?.[0]?.embeddings?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Embedding response missing values.');
  }
  return values;
}

async function generateAnswer({ question, facts, passages }) {
  if (!vertex) throw new Error('Vertex AI not configured (VERTEX_PROJECT_ID missing).');
  const model = vertex.getGenerativeModel({ model: VERTEX_GEMINI_MODEL });

  const system = [
    'You are FraudLens Assistant for an RBI-regulated entity.',
    'You answer questions from IT teams and executives about fraud incidents.',
    'Rules:',
    '- Use ONLY the provided facts and retrieved passages. If missing, say what is missing.',
    '- Be precise. Prefer exact numeric values from facts.',
    '- Output MUST be a single valid JSON object with keys: answer (string), citations (array).',
    '- citations entries must include: incidentId, reportType, objectPath, sha256, fileUrl (if available).',
    '- Do not include markdown.'
  ].join('\n');

  const context = {
    facts: facts || null,
    passages: Array.isArray(passages) ? passages : []
  };

  const prompt = [
    system,
    '',
    'Context JSON:',
    JSON.stringify(context, null, 2),
    '',
    'Question:',
    question
  ].join('\n');

  const resp = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024
    }
  });

  const text =
    resp?.response?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Model returned empty output.');

  // Strict JSON parse with fallback extraction
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (e2) {
        throw new Error('Model output was not valid JSON.');
      }
    }
    throw new Error('Model output was not valid JSON.');
  }
}

function bqTableRef(tableName) {
  return `\`${BQ_PROJECT_ID}.${BQ_DATASET}.${tableName}\``;
}

function chunkText(text, maxChars = 1200, overlap = 120) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const parts = s.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';

  const flush = () => {
    const v = buf.trim();
    if (v) chunks.push(v);
    buf = '';
  };

  for (const p of parts) {
    if ((buf + '\n\n' + p).length <= maxChars) {
      buf = buf ? buf + '\n\n' + p : p;
      continue;
    }
    flush();
    if (p.length <= maxChars) {
      buf = p;
      continue;
    }
    // Hard split long paragraphs
    let i = 0;
    while (i < p.length) {
      const end = Math.min(i + maxChars, p.length);
      chunks.push(p.slice(i, end));
      i = Math.max(end - overlap, end);
    }
  }
  flush();
  return chunks.slice(0, 60); // safety bound per document
}

function requireBigQuery() {
  if (!bigquery || !BQ_PROJECT_ID || !BQ_DATASET) {
    const msg =
      'BigQuery not configured. Set BQ_PROJECT_ID and BQ_DATASET (and create tables) on the Assistant API.';
    const err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }
}

async function retrievePassages({ question, incidentId }) {
  if (!bigquery || !BQ_PROJECT_ID || !BQ_DATASET) return [];

  const q = String(question || '').slice(0, 5000);

  try {
    if (ENABLE_VECTOR_SEARCH) {
      const qEmb = await embedText(q);
      const params = {
        incidentId: incidentId || null,
        qEmb
      };
      const baseTable = incidentId
        ? `(SELECT * FROM ${bqTableRef(BQ_CHUNKS_TABLE)} WHERE incidentId = @incidentId)`
        : `${bqTableRef(BQ_CHUNKS_TABLE)}`;

      const sql = `
        SELECT
          incidentId, reportType, objectPath, sha256, fileUrl, chunkText,
          distance
        FROM VECTOR_SEARCH(
          TABLE ${baseTable},
          'embedding',
          @qEmb,
          top_k => 8
        )
      `;
      const [rows] = await bigquery.query({ query: sql, params });
      return (rows || []).map((r) => ({
        incidentId: r.incidentId || null,
        reportType: r.reportType || null,
        objectPath: r.objectPath || null,
        sha256: r.sha256 || null,
        fileUrl: r.fileUrl || null,
        text: r.chunkText || ''
      }));
    }

    const params = { incidentId: incidentId || null, q: q.slice(0, 500) };
    const sql = incidentId
      ? `
        SELECT incidentId, reportType, objectPath, sha256, fileUrl, chunkText
        FROM ${bqTableRef(BQ_CHUNKS_TABLE)}
        WHERE incidentId = @incidentId AND LOWER(chunkText) LIKE CONCAT('%', LOWER(@q), '%')
        ORDER BY updatedAt DESC
        LIMIT 6
      `
      : `
        SELECT incidentId, reportType, objectPath, sha256, fileUrl, chunkText
        FROM ${bqTableRef(BQ_CHUNKS_TABLE)}
        WHERE LOWER(chunkText) LIKE CONCAT('%', LOWER(@q), '%')
        ORDER BY updatedAt DESC
        LIMIT 6
      `;
    const [rows] = await bigquery.query({ query: sql, params });
    return (rows || []).map((r) => ({
      incidentId: r.incidentId || null,
      reportType: r.reportType || null,
      objectPath: r.objectPath || null,
      sha256: r.sha256 || null,
      fileUrl: r.fileUrl || null,
      text: r.chunkText || ''
    }));
  } catch (e) {
    // Non-fatal; fall back to provided context only
    console.error('BigQuery retrieval failed (non-fatal)', e.message || e);
    return [];
  }
}

async function retrieveFacts({ incidentId }) {
  if (!bigquery || !incidentId || !BQ_PROJECT_ID || !BQ_DATASET) return null;
  const sql = `
    SELECT * FROM ${bqTableRef(BQ_FACTS_TABLE)}
    WHERE incidentId = @incidentId
    ORDER BY updatedAt DESC
    LIMIT 1
  `;
  try {
    const [rows] = await bigquery.query({ query: sql, params: { incidentId } });
    return rows?.[0] || null;
  } catch (e) {
    console.error('BigQuery facts fetch failed (non-fatal)', e.message || e);
    return null;
  }
}

function tryExactAnswerFromFacts(question, factsRow) {
  if (!factsRow || !question) return null;
  const q = String(question).toLowerCase();
  const out = [];

  const has = (s) => q.includes(s);

  if (has('amount') || has('inr') || has('₹') || has('rs') || has('rupee')) {
    if (factsRow.amount != null) out.push(`Amount: ₹${Number(factsRow.amount).toLocaleString('en-IN')}`);
  }
  if (has('status') || has('blocked') || has('approved') || has('pending')) {
    if (factsRow.status) out.push(`Status: ${factsRow.status}`);
  }
  if (has('fraud score') || has('fraudscore') || has('risk score') || has('score')) {
    if (factsRow.fraudScore != null) out.push(`Fraud score: ${Number(factsRow.fraudScore)}`);
  }
  if (has('ncrp') || has('i4c') || has('cybercrime')) {
    if (factsRow.ncrpStatus) out.push(`NCRP status: ${factsRow.ncrpStatus}`);
  }
  if (has('model decision') || has('modeldecision') || has('ml decision') || has('decision')) {
    if (factsRow.modelDecision != null) out.push(`Model decision: ${factsRow.modelDecision ? 'FRAUD' : 'SAFE'}`);
  }
  if (has('timestamp') || has('time') || has('when')) {
    if (factsRow.timestamp) out.push(`Incident time: ${factsRow.timestamp}`);
  }

  if (out.length === 0) return null;
  return out.join('\n');
}

app.get('/api/assistant/health', (req, res) => {
  res.json({
    ok: true,
    service: 'assistant',
    requireAuth: REQUIRE_AUTH,
    firebaseProjectId: FIREBASE_PROJECT_ID || null,
    vertex: {
      projectId: VERTEX_PROJECT_ID || null,
      location: VERTEX_LOCATION || null,
      model: VERTEX_GEMINI_MODEL
    },
    bigquery: {
      projectId: BQ_PROJECT_ID || null,
      dataset: BQ_DATASET || null,
      artifactsTable: BQ_ARTIFACTS_TABLE,
      chunksTable: BQ_CHUNKS_TABLE,
      factsTable: BQ_FACTS_TABLE
    },
    chronosApiBase: CHRONOS_API_BASE || null
  });
});

app.post('/api/assistant/chat', async (req, res) => {
  try {
    const { question, mode, incidentId, providedContext } = req.body || {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }

    const authInfo = await verifyFirebaseIdToken(req);

    const safeMode = mode === 'global' ? 'global' : 'incident';
    const safeIncidentId = safeMode === 'incident' ? String(incidentId || '').trim() : '';

    const contextFacts = {};
    if (providedContext?.incident) {
      contextFacts.incident = providedContext.incident;
      contextFacts.incidentHash = sha256Hex(JSON.stringify(providedContext.incident));
    }
    if (Array.isArray(providedContext?.reports)) {
      contextFacts.reports = providedContext.reports.map((r) => ({
        reportId: r.reportId,
        reportType: r.reportType,
        incidentId: r.incidentId,
        status: r.status,
        generatedAt: r.generatedAt,
        gcsObjectPath: r.gcsObjectPath,
        gcsSha256: r.gcsSha256,
        gcsPath: r.gcsPath
      }));
    }

    const bqFacts = safeIncidentId ? await retrieveFacts({ incidentId: safeIncidentId }) : null;
    if (bqFacts) contextFacts.bigQueryFacts = bqFacts;

    // Deterministic exact answers when possible (prevents hallucinations).
    if (safeIncidentId && bqFacts) {
      const exact = tryExactAnswerFromFacts(question, bqFacts);
      if (exact) {
        return res.json({
          answer: exact,
          citations: [
            {
              incidentId: safeIncidentId,
              reportType: 'Incident facts (BigQuery)',
              objectPath: null,
              sha256: null,
              fileUrl: null
            }
          ]
        });
      }
    }

    const bqPassages = await retrievePassages({ question, incidentId: safeIncidentId || null });

    // Always include provided report text passages first (precise incident scope)
    const passages = [];
    if (safeIncidentId && Array.isArray(providedContext?.reports)) {
      for (const r of providedContext.reports) {
        if (!r?.content) continue;
        passages.push({
          incidentId: r.incidentId || safeIncidentId,
          reportType: r.reportType || null,
          objectPath: r.gcsObjectPath || null,
          sha256: r.gcsSha256 || null,
          fileUrl:
            CHRONOS_API_BASE && r.gcsObjectPath
              ? `${CHRONOS_API_BASE}/api/docs/file?objectPath=${encodeURIComponent(r.gcsObjectPath)}`
              : null,
          text: String(r.content || '').slice(0, 30000)
        });
      }
    }
    for (const p of bqPassages) passages.push(p);

    // Deduplicate citations by objectPath+sha256
    const citationMap = new Map();
    for (const p of passages) {
      const k = `${p.objectPath || ''}::${p.sha256 || ''}::${p.reportType || ''}`;
      if (!citationMap.has(k)) {
        citationMap.set(k, {
          incidentId: p.incidentId || safeIncidentId || null,
          reportType: p.reportType || null,
          objectPath: p.objectPath || null,
          sha256: p.sha256 || null,
          fileUrl: p.fileUrl || null
        });
      }
    }

    const modelResp = await generateAnswer({
      question,
      facts: {
        mode: safeMode,
        incidentId: safeIncidentId || null,
        user: { uid: authInfo.uid },
        contextFacts
      },
      passages: passages.map((p) => ({
        incidentId: p.incidentId || null,
        reportType: p.reportType || null,
        objectPath: p.objectPath || null,
        sha256: p.sha256 || null,
        fileUrl: p.fileUrl || null,
        text: p.text || ''
      }))
    });

    const answer = String(modelResp?.answer || '').trim() || '(No answer)';
    const citations = Array.isArray(modelResp?.citations)
      ? modelResp.citations
      : Array.from(citationMap.values());

    return res.json({ answer, citations });
  } catch (err) {
    console.error('Assistant chat failed', err);
    return res.status(500).json({ error: err.message || 'Assistant error' });
  }
});

app.post('/api/assistant/ingest/report', async (req, res) => {
  try {
    await verifyFirebaseIdToken(req);
    requireBigQuery();

    const { incidentId, reportType, reportId, objectPath, gcsPath, sha256, content, source, contentType } = req.body || {};
    if (!incidentId || !reportType || typeof content !== 'string') {
      return res.status(400).json({ error: 'incidentId, reportType, content are required' });
    }
    const safeIncidentId = String(incidentId).trim();
    const safeReportType = String(reportType).trim();
    const safeObjectPath = objectPath ? String(objectPath).trim() : null;
    const safeGcsPath = gcsPath ? String(gcsPath).trim() : null;
    const safeSha = sha256 ? String(sha256).trim() : null;
    const safeReportId = reportId ? String(reportId).trim() : null;
    const safeContentType = contentType ? String(contentType).trim() : 'application/pdf';

    // Insert artifact metadata (best-effort). This is useful even before chunking is complete.
    try {
      await bigquery.dataset(BQ_DATASET).table(BQ_ARTIFACTS_TABLE).insert(
        [
          {
            artifactId: safeObjectPath || safeReportId || `${safeIncidentId}:${safeReportType}:${safeSha || ''}`,
            incidentId: safeIncidentId,
            reportType: safeReportType,
            reportId: safeReportId,
            objectPath: safeObjectPath,
            gcsPath: safeGcsPath,
            sha256: safeSha,
            contentType: safeContentType,
            fileUrl:
              CHRONOS_API_BASE && safeObjectPath
                ? `${CHRONOS_API_BASE}/api/docs/file?objectPath=${encodeURIComponent(safeObjectPath)}`
                : null,
            updatedAt: new Date().toISOString()
          }
        ],
        { ignoreUnknownValues: true }
      );
    } catch (e) {
      console.error('Artifacts insert failed (non-fatal)', e.message || e);
    }

    const chunks = chunkText(content, 1400, 140);
    const rows = [];
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i];
      const emb = await embedText(text);
      rows.push({
        chunkId: `${safeIncidentId}:${safeReportType}:${safeReportId || 'na'}:${i}:${sha256Hex(text).slice(0, 12)}`,
        incidentId: safeIncidentId,
        reportType: safeReportType,
        reportId: safeReportId,
        objectPath: safeObjectPath,
        sha256: safeSha,
        fileUrl:
          CHRONOS_API_BASE && safeObjectPath
            ? `${CHRONOS_API_BASE}/api/docs/file?objectPath=${encodeURIComponent(safeObjectPath)}`
            : null,
        source: source || 'firestore_report',
        chunkIndex: i,
        chunkText: text,
        embedding: emb,
        updatedAt: new Date().toISOString()
      });
    }

    await bigquery.dataset(BQ_DATASET).table(BQ_CHUNKS_TABLE).insert(rows, { ignoreUnknownValues: true });
    return res.status(201).json({ ok: true, inserted: rows.length });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('Ingest report failed', err);
    return res.status(status).json({ error: err.message || 'ingest error' });
  }
});

app.post('/api/assistant/ingest/facts', async (req, res) => {
  try {
    await verifyFirebaseIdToken(req);
    requireBigQuery();

    const { incidentId, facts } = req.body || {};
    if (!incidentId || typeof facts !== 'object' || !facts) {
      return res.status(400).json({ error: 'incidentId and facts object are required' });
    }
    const safeIncidentId = String(incidentId).trim();
    const row = {
      incidentId: safeIncidentId,
      amount: facts.amount != null ? Number(facts.amount) : null,
      currency: facts.currency != null ? String(facts.currency) : null,
      status: facts.status != null ? String(facts.status) : null,
      fraudScore: facts.fraudScore != null ? Number(facts.fraudScore) : null,
      modelDecision: facts.modelDecision != null ? Boolean(facts.modelDecision) : null,
      ncrpStatus: facts.ncrpStatus != null ? String(facts.ncrpStatus) : null,
      timestamp: facts.timestamp != null ? String(facts.timestamp) : null,
      factsJson: JSON.stringify(facts),
      updatedAt: new Date().toISOString()
    };
    await bigquery.dataset(BQ_DATASET).table(BQ_FACTS_TABLE).insert([row], { ignoreUnknownValues: true });
    return res.status(201).json({ ok: true });
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('Ingest facts failed', err);
    return res.status(status).json({ error: err.message || 'ingest error' });
  }
});

app.listen(port, () => {
  console.log(`Assistant API listening on port ${port}`);
});

