/**
 * Shared Scribe service: generate and save reports (used by ScribeDashboard and by
 * autonomous flow when an incident is blocked). See SCRIBE_AUTHORITIES.md for who receives what.
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import {
  PROMPT_TEMPLATES,
  REPORT_RECIPIENTS,
  REPORT_SUBJECTS,
  AUTO_REPORT_TYPES
} from './reportFormats';

function buildSubject(reportType, incidentId) {
  const template = REPORT_SUBJECTS[reportType];
  return template?.replace('[INCIDENT_ID]', incidentId) || `Report for ${incidentId}`;
}

/**
 * Generate a single report for the given incident and report type, save to Firestore.
 * @param {Firestore} db
 * @param {string} incidentId - Transaction/incident document id
 * @param {string} reportType - One of PROMPT_TEMPLATES keys
 * @returns {Promise<{ reportId: string, reportType: string, subject: string, recipients: string[] }>}
 */
export async function generateAndSaveReport(db, incidentId, reportType) {
  const incidentRef = doc(db, 'transactions', incidentId);
  const incidentSnap = await getDoc(incidentRef);
  if (!incidentSnap.exists()) {
    throw new Error(`No incident found for ID ${incidentId}.`);
  }

  const incidentData = { id: incidentSnap.id, ...incidentSnap.data() };
  const promptTemplate = PROMPT_TEMPLATES[reportType];
  if (!promptTemplate) {
    throw new Error(`No prompt template for report type: ${reportType}.`);
  }

  const prompt = promptTemplate.replace(
    '{incident_data}',
    JSON.stringify(incidentData, null, 2)
  );

  const apiKey = process.env.REACT_APP_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Missing REACT_APP_GEMINI_API_KEY. Add it in .env (get a key at https://aistudio.google.com/apikey).'
    );
  }

  const modelId =
    process.env.REACT_APP_GEMINI_MODEL?.trim() || 'models/gemini-2.5-flash';
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelId}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    }
  );

  if (!geminiResponse.ok) {
    const errorBody = await geminiResponse.json();
    const msg = errorBody.error?.message || 'Gemini API error';
    throw new Error(msg);
  }

  const result = await geminiResponse.json();
  const reportText =
    result.candidates?.[0]?.content?.parts?.[0]?.text ||
    'Gemini response did not contain text output.';

  const recipientsList = REPORT_RECIPIENTS[reportType] || [];
  const subject = buildSubject(reportType, incidentId);

  const docRef = await addDoc(collection(db, 'scribe_reports'), {
    reportType,
    incidentId,
    content: reportText,
    recipients: recipientsList,
    subject,
    generatedAt: serverTimestamp(),
    status: 'draft'
  });

  // Upload a stored copy to GCS via Chronos API (Cloud Run).
  // This keeps the bucket private and gives us a sha256 hash to later anchor on-chain.
  let gcs = null;
  try {
    const base = process.env.REACT_APP_CHRONOS_API?.trim();
    if (base) {
      const resp = await fetch(`${base.replace(/\/$/, '')}/api/docs/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId,
          reportType,
          content: reportText
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.gcsPath && data?.sha256 && data?.objectPath) {
          gcs = { gcsPath: data.gcsPath, sha256: data.sha256, objectPath: data.objectPath };
          await updateDoc(doc(db, 'scribe_reports', docRef.id), {
            gcsPath: data.gcsPath,
            gcsObjectPath: data.objectPath,
            gcsSha256: data.sha256,
            gcsUploadedAt: serverTimestamp()
          });
        }
      }
    }
  } catch (err) {
    // Non-fatal for report generation
    console.error('Chronos/GCS upload failed (non-fatal)', err);
  }

  return {
    reportId: docRef.id,
    reportType,
    subject,
    recipients: recipientsList,
    incidentId,
    content: reportText,
    gcs
  };
}

/**
 * Generate the default set of reports for a blocked/fraud incident (RBI, CERT-In, Executive Summary).
 * Used for autonomous Scribe: call after blocking a transaction.
 * @param {Firestore} db
 * @param {string} incidentId
 * @param {string[]} [reportTypes] - Defaults to AUTO_REPORT_TYPES
 * @returns {Promise<Array<{ reportId: string, reportType: string, subject: string, recipients: string[] }>>}
 */
export async function generateRequiredReportsForIncident(db, incidentId, reportTypes = AUTO_REPORT_TYPES) {
  const results = [];
  for (const reportType of reportTypes) {
    const one = await generateAndSaveReport(db, incidentId, reportType);
    results.push(one);
  }
  return results;
}

export { REPORT_RECIPIENTS, REPORT_SUBJECTS, AUTO_REPORT_TYPES };
