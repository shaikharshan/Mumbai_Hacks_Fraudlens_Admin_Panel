import React, { useState, useMemo } from 'react';
import { parseReportContent, ReportDocument } from '../ReportDocument';

const FULL_REPORT_OPTIONS = [
  'RBI Fraud Report (FMR-style)',
  'CERT-In Incident Report (India)',
  'Executive Summary',
  'Internal SOC Post-Mortem',
  'GDPR Data Breach Notification (Draft)',
  'ISO 27001 Incident Evidence'
];

const ReportGenerator = ({
  onGenerate,
  generatedReport,
  isGenerating,
  onDownload,
  onSendEmail,
  onViewStoredCopy,
  reportMeta,
  defaultRecipients,
  defaultSubjects,
  errorMessage,
  reportOptions: reportOptionsProp
}) => {
  const reportOptions = reportOptionsProp && reportOptionsProp.length > 0 ? reportOptionsProp : FULL_REPORT_OPTIONS;
  const [incidentId, setIncidentId] = useState('');
  const [reportType, setReportType] = useState(reportOptions[0]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!incidentId.trim()) return;
    onGenerate({ reportType, incidentId: incidentId.trim() });
  };

  const hasReport = Boolean(generatedReport);
  const parsed = useMemo(
    () => hasReport && reportMeta ? parseReportContent(reportMeta.reportType, generatedReport) : null,
    [hasReport, reportMeta, generatedReport]
  );

  return (
    <div>
      <header className="scribe-section-header">
        <div>
          <p className="scribe-eyebrow">On-Demand Report Generator</p>
          <h2>Generate On-Demand Report</h2>
          <p>Create instant compliance outputs for any incident document.</p>
        </div>
      </header>

      <form className="scribe-form" onSubmit={handleSubmit}>
        <label>
          <span>Report Type</span>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)}>
            {reportOptions.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Incident ID</span>
          <input
            type="text"
            placeholder="e.g. txn_20241118_abcd1234"
            value={incidentId}
            onChange={(e) => setIncidentId(e.target.value)}
          />
        </label>

        <div className="scribe-hint">
          <p>
            Default recipients:{' '}
            {(defaultRecipients?.[reportType] || []).join(', ') || '—'}
          </p>
          <p>
            Subject line:{' '}
            {defaultSubjects?.[reportType]?.replace('[INCIDENT_ID]', incidentId || 'INCIDENT_ID')}
          </p>
        </div>

        <div className="scribe-actions">
          <button type="submit" className="scribe-btn primary" disabled={isGenerating}>
            {isGenerating ? 'Generating...' : 'Generate & Preview Report'}
          </button>
        </div>
      </form>

      {errorMessage && <p className="scribe-error">{errorMessage}</p>}

      <div className="scribe-preview">
        <div className="scribe-preview-header">
          <div>
            <p className="scribe-eyebrow">Preview</p>
            <h3>{hasReport ? reportMeta?.reportType : 'Report Output'}</h3>
            {reportMeta?.incidentId && <p>Incident • {reportMeta.incidentId}</p>}
          </div>
          <div className="scribe-preview-buttons">
            <button
              className="scribe-btn secondary"
              onClick={onDownload}
              disabled={!hasReport}
            >
              Download as PDF
            </button>
            <button
              className="scribe-btn outline"
              onClick={onViewStoredCopy}
              disabled={!hasReport || !reportMeta?.gcsObjectPath}
              title={!reportMeta?.gcsObjectPath ? 'No stored copy uploaded yet.' : 'View stored copy from GCS via Chronos API'}
            >
              View stored copy
            </button>
            <button
              className="scribe-btn outline"
              onClick={onSendEmail}
              disabled={!hasReport}
            >
              Send Email
            </button>
          </div>
        </div>
        <div className="scribe-preview-body">
          {hasReport ? (
            parsed ? (
              <ReportDocument
                reportType={reportMeta?.reportType}
                parsed={parsed}
                incidentId={reportMeta?.incidentId}
              />
            ) : (
              <pre>{generatedReport}</pre>
            )
          ) : (
            <p className="scribe-placeholder">
              Generated content will appear here in the correct format for the selected report type.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportGenerator;

