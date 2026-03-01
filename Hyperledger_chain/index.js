require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Storage } = require('@google-cloud/storage');
const PDFDocument = require('pdfkit');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const projectId = process.env.GCP_PROJECT_ID;
const bucketName = process.env.GCS_BUCKET_NAME;
const storage = projectId ? new Storage({ projectId }) : new Storage();

// In-memory event store for now (will be replaced by Hyperledger Fabric later)
const events = [];

function safeObjectPart(input, maxLen = 120) {
  return String(input || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, maxLen);
}

function guessContentTypeFromPath(objectPath) {
  const p = String(objectPath || '').toLowerCase();
  if (p.endsWith('.pdf')) return 'application/pdf';
  if (p.endsWith('.json')) return 'application/json; charset=utf-8';
  if (p.endsWith('.md')) return 'text/markdown; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function buildPdfBuffer({ incidentId, reportType, content }) {
  return await new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: reportType } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).fillColor('#111827').text('FraudLens — Scribe Report');
      doc.moveDown(0.3);
      doc.fontSize(14).fillColor('#111827').text(String(reportType || 'Report'));
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor('#4b5563').text(`Incident ID: ${incidentId}`);
      doc.text(`Generated: ${new Date().toISOString()}`);
      doc.moveDown(0.8);

      doc.fontSize(11).fillColor('#111827').text(String(content || ''), {
        width: 500,
        align: 'left'
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Health check
app.get('/api/chronos/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'chronos',
    eventsCount: events.length,
    gcp: {
      projectId: projectId || null,
      bucketName: bucketName || null
    }
  });
});

// Upload evidence / report artifact to GCS (PDF)
app.post('/api/docs/upload', async (req, res) => {
  try {
    if (!bucketName) {
      return res.status(500).json({
        error: 'Missing GCS_BUCKET_NAME. Set it in Hyperledger_chain/.env and restart the service.'
      });
    }
    const { incidentId, reportType, content } = req.body || {};
    if (!incidentId || !reportType || typeof content !== 'string') {
      return res.status(400).json({
        error: 'incidentId, reportType and content (string) are required'
      });
    }

    const safeIncident = safeObjectPart(incidentId);
    const safeType = safeObjectPart(reportType);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const objectPath = `reports/${safeIncident}/${safeType}-${ts}.pdf`;

    const buf = await buildPdfBuffer({ incidentId, reportType, content });
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectPath);
    await file.save(buf, {
      contentType: 'application/pdf',
      metadata: {
        cacheControl: 'no-store'
      }
    });

    // Keep bucket private. Return gs:// path for internal linking and hash for immutability.
    return res.status(201).json({
      ok: true,
      incidentId,
      reportType,
      gcsPath: `gs://${bucketName}/${objectPath}`,
      objectPath,
      sha256,
      contentType: 'application/pdf'
    });
  } catch (err) {
    console.error('GCS upload failed', err);
    return res.status(500).json({
      error: 'GCS upload failed',
      details: err.message
    });
  }
});

// Get metadata + sha256 for an artifact in GCS (no content)
app.get('/api/docs/meta', async (req, res) => {
  try {
    if (!bucketName) {
      return res.status(500).json({
        error: 'Missing GCS_BUCKET_NAME. Set it in Cloud Run env vars.'
      });
    }
    const objectPath = String(req.query.objectPath || '').trim();
    if (!objectPath) {
      return res.status(400).json({ error: 'objectPath query param is required' });
    }
    if (!objectPath.startsWith('reports/')) {
      return res.status(400).json({ error: 'objectPath must start with reports/' });
    }

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectPath);
    const [meta] = await file.getMetadata();
    const [buf] = await file.download();
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const contentType = meta?.contentType || guessContentTypeFromPath(objectPath);
    const sizeBytes = Number(meta?.size || buf.length || 0);

    return res.json({
      ok: true,
      gcsPath: `gs://${bucketName}/${objectPath}`,
      objectPath,
      sha256,
      contentType,
      sizeBytes
    });
  } catch (err) {
    console.error('GCS meta failed', err);
    return res.status(500).json({
      error: 'GCS meta failed',
      details: err.message
    });
  }
});

// Stream a stored artifact from GCS (keeps bucket private; UI opens this URL directly)
app.get('/api/docs/file', async (req, res) => {
  try {
    if (!bucketName) {
      return res.status(500).json({
        error: 'Missing GCS_BUCKET_NAME. Set it in Cloud Run env vars.'
      });
    }
    const objectPath = String(req.query.objectPath || '').trim();
    if (!objectPath) {
      return res.status(400).json({ error: 'objectPath query param is required' });
    }
    if (!objectPath.startsWith('reports/')) {
      return res.status(400).json({ error: 'objectPath must start with reports/' });
    }

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectPath);
    const [meta] = await file.getMetadata();
    const contentType = meta?.contentType || guessContentTypeFromPath(objectPath);
    const filename = objectPath.split('/').pop() || 'artifact';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    const stream = file.createReadStream();
    stream.on('error', (err) => {
      console.error('GCS file stream failed', err);
      if (!res.headersSent) {
        res.status(500).send('Failed to stream file');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('GCS file failed', err);
    return res.status(500).json({
      error: 'GCS file failed',
      details: err.message
    });
  }
});

// Read back a stored artifact from GCS (keeps bucket private; UI fetches via this API)
app.get('/api/docs/read', async (req, res) => {
  try {
    if (!bucketName) {
      return res.status(500).json({
        error: 'Missing GCS_BUCKET_NAME. Set it in Cloud Run env vars.'
      });
    }
    const objectPath = String(req.query.objectPath || '').trim();
    if (!objectPath) {
      return res.status(400).json({ error: 'objectPath query param is required' });
    }
    if (!objectPath.startsWith('reports/')) {
      return res.status(400).json({ error: 'objectPath must start with reports/' });
    }

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(objectPath);
    const [meta] = await file.getMetadata();
    const [buf] = await file.download();
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const contentType = meta?.contentType || guessContentTypeFromPath(objectPath);
    if (String(contentType).toLowerCase().includes('pdf')) {
      return res.json({
        ok: true,
        gcsPath: `gs://${bucketName}/${objectPath}`,
        objectPath,
        sha256,
        contentType,
        fileUrl: `/api/docs/file?objectPath=${encodeURIComponent(objectPath)}`
      });
    }
    const text = buf.toString('utf8');

    return res.json({
      ok: true,
      gcsPath: `gs://${bucketName}/${objectPath}`,
      objectPath,
      sha256,
      contentType,
      content: text
    });
  } catch (err) {
    console.error('GCS read failed', err);
    return res.status(500).json({
      error: 'GCS read failed',
      details: err.message
    });
  }
});

// Record a fraud decision + linked Scribe reports
app.post('/api/chronos/decision', (req, res) => {
  const { incidentId, decision, reasonCode, reports, decidedBy } = req.body || {};

  if (!incidentId || !decision) {
    return res.status(400).json({ error: 'incidentId and decision are required' });
  }

  const event = {
    type: 'decision',
    incidentId,
    decision,
    reasonCode: reasonCode || null,
    decidedBy: decidedBy || 'it_admin',
    reports: Array.isArray(reports) ? reports : [],
    timestamp: new Date().toISOString()
  };

  events.push(event);
  res.status(201).json({ ok: true, event });
});

// Get full on-chain-style history (simulated) for an incident
app.get('/api/chronos/incident/:incidentId', (req, res) => {
  const { incidentId } = req.params;
  const history = events.filter(e => e.incidentId === incidentId);
  res.json({ incidentId, events: history });
});

app.listen(port, () => {
  console.log(`Chronos audit service listening on port ${port}`);
});

