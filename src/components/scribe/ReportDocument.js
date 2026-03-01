import React from 'react';
import {
  ORG_NAME,
  REPORTING_CONTACT,
  MARKDOWN_SECTIONS
} from './reportFormats';

const LOGO_URL = process.env.REACT_APP_SCRIBE_LOGO_URL || '';

/**
 * Convert markdown to HTML so PDF shows proper formatting (no raw ** or ##).
 */
function markdownToHtml(text) {
  if (!text || typeof text !== 'string') return '';
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Block-level: headings
  s = s.replace(/^###\s+(.+)$/gm, '<h3 class="scribe-doc-h3">$1</h3>');
  s = s.replace(/^##\s+(.+)$/gm, '<h3 class="scribe-doc-h3">$1</h3>');
  // Unordered list: lines that start with "- " or "* " (not **)
  const lines = s.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const ulMatch = /^[-*]\s+(.+)$/.test(line);
    const olMatch = /^\d+\.\s+(.+)$/.test(line);
    if (ulMatch) {
      const items = [];
      while (i < lines.length && /^[-*]\s+(.+)$/.test(lines[i])) {
        items.push('<li>' + lines[i].replace(/^[-*]\s+/, '') + '</li>');
        i++;
      }
      out.push('<ul class="scribe-doc-ul">' + items.join('') + '</ul>');
      continue;
    }
    if (olMatch) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+(.+)$/.test(lines[i])) {
        items.push('<li>' + lines[i].replace(/^\d+\.\s+/, '') + '</li>');
        i++;
      }
      out.push('<ol class="scribe-doc-ol">' + items.join('') + '</ol>');
      continue;
    }
    out.push(line);
    i++;
  }
  s = out.join('\n');
  // Inline: bold, italic, code (after blocks so we don't break tags)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/_(.+?)_/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code class="scribe-doc-inline-code">$1</code>');
  // Paragraphs: wrap consecutive non-tag lines in <p>, newlines inside -> <br/>
  s = s.split(/\n\n+/).map(block => {
    const t = block.trim();
    if (/^<((ul|ol|h3)|li>)/.test(t) || t.startsWith('<ul') || t.startsWith('<ol') || t.startsWith('<h3')) return t;
    return '<p class="scribe-doc-p">' + t.replace(/\n/g, '<br/>') + '</p>';
  }).join('\n');
  return s;
}

/**
 * Parse markdown into sections by ## Heading (order preserved per sectionHeadings)
 */
function parseMarkdownSections(text, sectionHeadings) {
  if (!text || !sectionHeadings?.length) return [];
  const blocks = text.trim().split(/\n(?=##\s+)/).filter(Boolean);
  const sectionMap = new Map();
  for (const block of blocks) {
    const firstLine = block.split('\n')[0] || '';
    const match = firstLine.match(/^##\s+(.+?)\s*$/);
    const title = match ? match[1].trim() : '';
    const body = match ? block.slice(firstLine.length).trim() : block.trim();
    if (!title) continue;
    for (const expected of sectionHeadings) {
      if (title.toLowerCase() === expected.toLowerCase()) {
        sectionMap.set(expected, { heading: expected, body });
        break;
      }
    }
  }
  return sectionHeadings.map(h => sectionMap.get(h)).filter(Boolean);
}

/**
 * Try to extract JSON from Gemini output (may be wrapped in ```json or text)
 */
function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (_) {}
  }
  return null;
}

export function parseReportContent(reportType, rawContent) {
  if (!rawContent) return { type: 'raw', data: { raw: '' } };
  const trimmed = rawContent.trim();

  if (
    reportType === 'Executive Summary' ||
    reportType === 'CERT-In Incident Report (India)' ||
    reportType === 'RBI Fraud Report (FMR-style)'
  ) {
    const json = extractJson(trimmed);
    if (json) return { type: 'json', data: json };
  }

  const sections = MARKDOWN_SECTIONS[reportType];
  if (sections?.length) {
    const parsed = parseMarkdownSections(trimmed, sections);
    if (parsed.length > 0) return { type: 'markdown', data: parsed };
  }

  return { type: 'raw', data: { raw: trimmed } };
}

const docStyles = `
  .scribe-doc { font-family: Georgia, "Times New Roman", serif; color: #111; max-width: 800px; margin: 0 auto; line-height: 1.6; }
  .scribe-doc-header { border-bottom: 2px solid #1e293b; padding-bottom: 12px; margin-bottom: 24px; }
  .scribe-doc-logo { max-height: 48px; margin-bottom: 8px; }
  .scribe-doc-title { font-size: 22px; font-weight: 700; margin: 0; }
  .scribe-doc-meta { font-size: 13px; color: #64748b; margin-top: 8px; }
  .scribe-doc-section { margin-bottom: 24px; }
  .scribe-doc-section h2 { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; margin: 0 0 8px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .scribe-doc-section p, .scribe-doc-section ul { margin: 0 0 8px 0; font-size: 14px; }
  .scribe-doc-section ul { padding-left: 20px; }
  .scribe-doc-table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 12px 0; }
  .scribe-doc-table th, .scribe-doc-table td { text-align: left; padding: 8px 12px; border: 1px solid #e2e8f0; }
  .scribe-doc-table th { background: #f8fafc; font-weight: 600; }
  .scribe-doc-footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
  .scribe-doc-section .scribe-doc-h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px 0; color: #334155; }
  .scribe-doc-section .scribe-doc-p { margin: 0 0 8px 0; font-size: 14px; }
  .scribe-doc-section .scribe-doc-ul, .scribe-doc-section .scribe-doc-ol { margin: 0 0 8px 0; padding-left: 20px; font-size: 14px; }
  .scribe-doc-inline-code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
`;

function ExecSummaryDocument({ data, incidentId }) {
  const d = data || {};
  const headline = d.headline || 'Executive Summary';
  const summary = d.summary || '';
  const amountAtRisk = d.amountAtRisk != null ? `₹${Number(d.amountAtRisk).toLocaleString('en-IN')}` : '—';
  const outcome = d.outcome || '—';
  const keyPoints = Array.isArray(d.keyPoints) ? d.keyPoints : [];

  return (
    <div className="scribe-doc">
      <header className="scribe-doc-header">
        {LOGO_URL && <img src={LOGO_URL} alt="" className="scribe-doc-logo" />}
        <h1 className="scribe-doc-title">{ORG_NAME} — Executive Summary</h1>
        <p className="scribe-doc-meta">Incident: {incidentId} · {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>
      </header>
      <div className="scribe-doc-section">
        <h2>Headline</h2>
        <p><strong>{headline}</strong></p>
      </div>
      <div className="scribe-doc-section">
        <h2>Summary</h2>
        <p>{summary}</p>
      </div>
      <table className="scribe-doc-table">
        <tbody>
          <tr><th>Amount at risk</th><td>{amountAtRisk}</td></tr>
          <tr><th>Outcome</th><td>{outcome}</td></tr>
        </tbody>
      </table>
      {keyPoints.length > 0 && (
        <div className="scribe-doc-section">
          <h2>Key points</h2>
          <ul>{keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>
        </div>
      )}
      <footer className="scribe-doc-footer">
        {ORG_NAME} · Confidential · For internal use
      </footer>
    </div>
  );
}

function CERTInDocument({ data, incidentId }) {
  const d = data || {};
  const rows = [
    ['Reporting organisation', d.reportingOrganization || ORG_NAME],
    ['Incident type', d.incidentType || '—'],
    ['Occurrence time', d.occurrenceTime || '—'],
    ['Detection time', d.detectionTime || '—'],
    ['Affected systems', d.affectedSystems || '—'],
    ['Incident summary', d.incidentSummary || '—'],
    ['Technical details', d.technicalDetails || '—'],
    ['Impact', d.impact || '—'],
    ['Actions taken', d.actionsTaken || '—'],
    ['Contact (name)', d.contactName || REPORTING_CONTACT.email],
    ['Contact (email)', d.contactEmail || REPORTING_CONTACT.email],
    ['Contact (phone)', d.contactPhone || REPORTING_CONTACT.phone]
  ];

  return (
    <div className="scribe-doc">
      <header className="scribe-doc-header">
        {LOGO_URL && <img src={LOGO_URL} alt="" className="scribe-doc-logo" />}
        <h1 className="scribe-doc-title">CERT-In Incident Report (Annexure A)</h1>
        <p className="scribe-doc-meta">Incident ID: {incidentId} · {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })} · Section 70B, IT Act, 2000</p>
      </header>
      <table className="scribe-doc-table">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i}><th>{label}</th><td>{value}</td></tr>
          ))}
        </tbody>
      </table>
      <footer className="scribe-doc-footer">
        Submit to incident@cert-in.org.in within 6 hours of noticing the incident.
      </footer>
    </div>
  );
}

function RBIFraudDocument({ data, incidentId }) {
  const d = data || {};
  const amountStr = d.amountInvolved != null ? `₹${Number(d.amountInvolved).toLocaleString('en-IN')}` : '—';
  const rows = [
    ['Reporting organisation', d.reportingOrganization || ORG_NAME],
    ['Amount involved', amountStr],
    ['Reporting office (RBI)', d.reportingOffice || '—'],
    ['Fraud classification', d.fraudClassification || '—'],
    ['Occurrence time', d.occurrenceTime || '—'],
    ['Detection time', d.detectionTime || '—'],
    ['Affected systems', d.affectedSystems || '—'],
    ['Incident summary', d.incidentSummary || '—'],
    ['Impact', d.impact || '—'],
    ['Actions taken', d.actionsTaken || '—'],
    ['Contact (name)', d.contactName || REPORTING_CONTACT.email],
    ['Contact (email)', d.contactEmail || REPORTING_CONTACT.email],
    ['Contact (phone)', d.contactPhone || REPORTING_CONTACT.phone]
  ];

  return (
    <div className="scribe-doc">
      <header className="scribe-doc-header">
        {LOGO_URL && <img src={LOGO_URL} alt="" className="scribe-doc-logo" />}
        <h1 className="scribe-doc-title">RBI Fraud Report (FMR-style)</h1>
        <p className="scribe-doc-meta">Incident ID: {incidentId} · {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })} · Master Circular on Frauds – Classification and Reporting</p>
      </header>
      <table className="scribe-doc-table">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i}><th>{label}</th><td>{value}</td></tr>
          ))}
        </tbody>
      </table>
      <footer className="scribe-doc-footer">
        {ORG_NAME} · Aligned to RBI Master Circular. Report to the indicated RBI office per amount threshold.
      </footer>
    </div>
  );
}

function MarkdownSectionsDocument({ sections, title, incidentId, subtitle }) {
  return (
    <div className="scribe-doc">
      <header className="scribe-doc-header">
        {LOGO_URL && <img src={LOGO_URL} alt="" className="scribe-doc-logo" />}
        <h1 className="scribe-doc-title">{title}</h1>
        <p className="scribe-doc-meta">Incident: {incidentId}{subtitle ? ` · ${subtitle}` : ''} · {new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>
      </header>
      {sections.map(({ heading, body }, i) => (
        <div key={i} className="scribe-doc-section">
          <h2>{heading}</h2>
          <div className="scribe-doc-section-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(body) }} />
        </div>
      ))}
      <footer className="scribe-doc-footer">
        {ORG_NAME} · Confidential
      </footer>
    </div>
  );
}

function RawFallback({ raw, reportType, incidentId }) {
  return (
    <div className="scribe-doc">
      <header className="scribe-doc-header">
        <h1 className="scribe-doc-title">{reportType}</h1>
        <p className="scribe-doc-meta">Incident: {incidentId}</p>
      </header>
      <div className="scribe-doc-section-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(raw) }} />
    </div>
  );
}

/**
 * Renders parsed report for preview.
 */
export function ReportDocument({ reportType, parsed, incidentId }) {
  if (!parsed) return null;
  const { type, data } = parsed;

  if (type === 'json') {
    if (reportType === 'Executive Summary') {
      return <ExecSummaryDocument data={data} incidentId={incidentId} />;
    }
    if (reportType === 'CERT-In Incident Report (India)') {
      return <CERTInDocument data={data} incidentId={incidentId} />;
    }
    if (reportType === 'RBI Fraud Report (FMR-style)') {
      return <RBIFraudDocument data={data} incidentId={incidentId} />;
    }
  }

  if (type === 'markdown' && Array.isArray(data) && data.length > 0) {
    const subtitles = {
      'Internal SOC Post-Mortem': 'SOC 2 incident post-mortem',
      'GDPR Data Breach Notification (Draft)': 'GDPR Article 33 draft',
      'ISO 27001 Incident Evidence': 'Annex A evidence packet'
    };
    return (
      <MarkdownSectionsDocument
        sections={data}
        title={`${reportType} — ${ORG_NAME}`}
        incidentId={incidentId}
        subtitle={subtitles[reportType]}
      />
    );
  }

  return (
    <RawFallback
      raw={type === 'raw' ? (data?.raw ?? '') : JSON.stringify(data)}
      reportType={reportType}
      incidentId={incidentId}
    />
  );
}

/**
 * Returns full HTML string for print/PDF (same structure as ReportDocument).
 */
export function getReportPrintHtml(reportType, parsed, incidentId, reportTitle) {
  const wrap = (body) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${reportTitle}</title>
  <style>${docStyles}</style>
</head>
<body style="margin:0; padding: 24px;">
  ${body}
</body>
</html>`;

  if (!parsed || !incidentId) return wrap('<p>No content.</p>');

  const { type, data } = parsed;

  if (type === 'json' && reportType === 'Executive Summary') {
    const d = data || {};
    const amountAtRisk = d.amountAtRisk != null ? `₹${Number(d.amountAtRisk).toLocaleString('en-IN')}` : '—';
    const keyPoints = Array.isArray(d.keyPoints) ? d.keyPoints : [];
    const body = `
      <div class="scribe-doc">
        <header class="scribe-doc-header">
          ${LOGO_URL ? `<img src="${LOGO_URL}" alt="" class="scribe-doc-logo" />` : ''}
          <h1 class="scribe-doc-title">${ORG_NAME} — Executive Summary</h1>
          <p class="scribe-doc-meta">Incident: ${incidentId} · ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>
        </header>
        <div class="scribe-doc-section"><h2>Headline</h2><p><strong>${(d.headline || '').replace(/</g, '&lt;')}</strong></p></div>
        <div class="scribe-doc-section"><h2>Summary</h2><p>${(d.summary || '').replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p></div>
        <table class="scribe-doc-table"><tbody>
          <tr><th>Amount at risk</th><td>${amountAtRisk}</td></tr>
          <tr><th>Outcome</th><td>${(d.outcome || '—').replace(/</g, '&lt;')}</td></tr>
        </tbody></table>
        ${keyPoints.length ? `<div class="scribe-doc-section"><h2>Key points</h2><ul>${keyPoints.map(k => `<li>${String(k).replace(/</g, '&lt;')}</li>`).join('')}</ul></div>` : ''}
        <footer class="scribe-doc-footer">${ORG_NAME} · Confidential</footer>
      </div>`;
    return wrap(body);
  }

  if (type === 'json' && reportType === 'CERT-In Incident Report (India)') {
    const d = data || {};
    const rows = [
      ['Reporting organisation', d.reportingOrganization || ORG_NAME],
      ['Incident type', d.incidentType || '—'],
      ['Occurrence time', d.occurrenceTime || '—'],
      ['Detection time', d.detectionTime || '—'],
      ['Affected systems', d.affectedSystems || '—'],
      ['Incident summary', d.incidentSummary || '—'],
      ['Technical details', d.technicalDetails || '—'],
      ['Impact', d.impact || '—'],
      ['Actions taken', d.actionsTaken || '—'],
      ['Contact', [d.contactName, d.contactEmail, d.contactPhone].filter(Boolean).join(' · ') || REPORTING_CONTACT.email]
    ];
    const tbody = rows.map(([label, value]) => `<tr><th>${label}</th><td>${String(value).replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</td></tr>`).join('');
    const body = `
      <div class="scribe-doc">
        <header class="scribe-doc-header">
          ${LOGO_URL ? `<img src="${LOGO_URL}" alt="" class="scribe-doc-logo" />` : ''}
          <h1 class="scribe-doc-title">CERT-In Incident Report (Annexure A)</h1>
          <p class="scribe-doc-meta">Incident ID: ${incidentId} · ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>
        </header>
        <table class="scribe-doc-table"><tbody>${tbody}</tbody></table>
        <footer class="scribe-doc-footer">Submit to incident@cert-in.org.in within 6 hours.</footer>
      </div>`;
    return wrap(body);
  }

  if (type === 'json' && reportType === 'RBI Fraud Report (FMR-style)') {
    const d = data || {};
    const amountStr = d.amountInvolved != null ? `₹${Number(d.amountInvolved).toLocaleString('en-IN')}` : '—';
    const rows = [
      ['Reporting organisation', d.reportingOrganization || ORG_NAME],
      ['Amount involved', amountStr],
      ['Reporting office (RBI)', d.reportingOffice || '—'],
      ['Fraud classification', d.fraudClassification || '—'],
      ['Occurrence time', d.occurrenceTime || '—'],
      ['Detection time', d.detectionTime || '—'],
      ['Affected systems', d.affectedSystems || '—'],
      ['Incident summary', d.incidentSummary || '—'],
      ['Impact', d.impact || '—'],
      ['Actions taken', d.actionsTaken || '—'],
      ['Contact', [d.contactName, d.contactEmail, d.contactPhone].filter(Boolean).join(' · ') || REPORTING_CONTACT.email]
    ];
    const tbody = rows.map(([label, value]) => `<tr><th>${label}</th><td>${String(value).replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</td></tr>`).join('');
    const body = `
      <div class="scribe-doc">
        <header class="scribe-doc-header">
          ${LOGO_URL ? `<img src="${LOGO_URL}" alt="" class="scribe-doc-logo" />` : ''}
          <h1 class="scribe-doc-title">RBI Fraud Report (FMR-style)</h1>
          <p class="scribe-doc-meta">Incident ID: ${incidentId} · ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })} · Master Circular on Frauds</p>
        </header>
        <table class="scribe-doc-table"><tbody>${tbody}</tbody></table>
        <footer class="scribe-doc-footer">${ORG_NAME} · Aligned to RBI Master Circular.</footer>
      </div>`;
    return wrap(body);
  }

  if (type === 'markdown' && Array.isArray(data) && data.length > 0) {
    const sectionsHtml = data.map(({ heading, body }) => `
      <div class="scribe-doc-section">
        <h2>${heading.replace(/</g, '&lt;')}</h2>
        <div class="scribe-doc-section-body">${markdownToHtml(body)}</div>
      </div>`).join('');
    const body = `
      <div class="scribe-doc">
        <header class="scribe-doc-header">
          ${LOGO_URL ? `<img src="${LOGO_URL}" alt="" class="scribe-doc-logo" />` : ''}
          <h1 class="scribe-doc-title">${reportType} — ${ORG_NAME}</h1>
          <p class="scribe-doc-meta">Incident: ${incidentId} · ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</p>
        </header>
        ${sectionsHtml}
        <footer class="scribe-doc-footer">${ORG_NAME} · Confidential</footer>
      </div>`;
    return wrap(body);
  }

  const raw = type === 'raw' ? (data?.raw ?? '') : JSON.stringify(data);
  return wrap(`
    <div class="scribe-doc">
      <header class="scribe-doc-header"><h1 class="scribe-doc-title">${String(reportType).replace(/</g, '&lt;')}</h1><p class="scribe-doc-meta">Incident: ${incidentId}</p></header>
      <div class="scribe-doc-section-body">${markdownToHtml(String(raw))}</div>
    </div>`);
}
