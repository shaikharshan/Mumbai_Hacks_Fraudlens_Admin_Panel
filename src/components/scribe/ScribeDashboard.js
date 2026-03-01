import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import ReportGenerator from './sections/ReportGenerator';
import ScheduledReports from './sections/ScheduledReports';
import RecentReportsTable from './sections/RecentReportsTable';
import ScribeDocsPanel from './sections/ScribeDocsPanel';
import { useAuth } from '../../contexts/AuthContext';
import {
  REPORT_RECIPIENTS,
  REPORT_SUBJECTS
} from './reportFormats';
import { generateAndSaveReport } from './scribeService';
import { parseReportContent, getReportPrintHtml } from './ReportDocument';
import './ScribeDashboard.css';
import { db } from '../../firebase';

const EXEC_REPORT_OPTIONS = ['Executive Summary'];

const WEEKLY_CONFIG_ID = 'default_weekly';

const ScribeDashboard = () => {
  const { isExec } = useAuth();
  const location = useLocation();
  const isExecRoute = location.pathname === '/exec/reports';
  const reportOptionsForRole = isExec || isExecRoute ? EXEC_REPORT_OPTIONS : null;

  const heroStats = [
    { label: 'Playbooks', value: '5+' },
    { label: 'Avg. Draft Time', value: '15s' },
    { label: 'Audit Ready', value: 'Yes' }
  ];

  const [generatedReport, setGeneratedReport] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentReportMeta, setCurrentReportMeta] = useState(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [recentReports, setRecentReports] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState('');
  const [reportError, setReportError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [docsOpen, setDocsOpen] = useState(false);
  const [seedLoading, setSeedLoading] = useState(false);
  const [quickOpenReports, setQuickOpenReports] = useState(null);
  const [quickOpenLoading, setQuickOpenLoading] = useState(false);

  useEffect(() => {
    const loadSchedule = async () => {
      try {
        const scheduleSnap = await getDoc(doc(db, 'scribe_config', WEEKLY_CONFIG_ID));
        if (scheduleSnap.exists()) {
          const data = scheduleSnap.data();
          setScheduleEnabled(Boolean(data.isEnabled));
          setRecipients((data.recipients || []).join(', '));
        } else {
          setRecipients(REPORT_RECIPIENTS['Weekly Intelligence Summary'].join(', '));
        }
      } catch (error) {
        console.error('Failed to load schedule config', error);
      } finally {
        setScheduleLoading(false);
      }
    };

    const loadRecentReports = async () => {
      try {
        const reportsQuery = query(
          collection(db, 'scribe_reports'),
          orderBy('generatedAt', 'desc'),
          limit(10)
        );
        const snapshot = await getDocs(reportsQuery);
        const reports = snapshot.docs.map(docSnap => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            type: data.reportType,
            generatedOn: data.generatedAt?.toDate?.().toLocaleString() || '—',
            incidentId: data.incidentId || '—'
          };
        });
        setRecentReports(reports);
      } catch (error) {
        console.error('Failed to load reports', error);
      }
    };

    loadSchedule();
    loadRecentReports();
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => setToastMessage(''), 2500);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  const handleGenerate = async ({ reportType, incidentId }) => {
    setIsGenerating(true);
    setReportError('');
    try {
      const result = await generateAndSaveReport(db, incidentId, reportType);

      setGeneratedReport(result.content || '');
      setCurrentReportMeta({
        reportType: result.reportType,
        incidentId: result.incidentId,
        reportId: result.reportId,
        recipients: result.recipients,
        subject: result.subject,
        gcsPath: result.gcs?.gcsPath,
        gcsObjectPath: result.gcs?.objectPath,
        gcsSha256: result.gcs?.sha256
      });
      setRecentReports(prev => [
        { id: result.reportId, type: reportType, generatedOn: new Date().toLocaleString(), incidentId },
        ...prev
      ].slice(0, 10));
    } catch (error) {
      console.error('Failed to generate report', error);
      let message = error.message || 'Failed to generate report';
      if (message.includes('API key not valid') || message.includes('invalid API key')) {
        message = 'Gemini API key is invalid or expired. Get a new key at https://aistudio.google.com/apikey, set REACT_APP_GEMINI_API_KEY in your .env file, then restart the app (npm start).';
      }
      setReportError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!generatedReport || !currentReportMeta) return;
    const reportTitle = `${currentReportMeta.reportType} - ${currentReportMeta.incidentId}`;
    const parsed = parseReportContent(currentReportMeta.reportType, generatedReport);
    const printableHtml = getReportPrintHtml(
      currentReportMeta.reportType,
      parsed,
      currentReportMeta.incidentId,
      reportTitle
    );

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please enable popups to download the PDF.');
      return;
    }
    printWindow.document.write(printableHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 400);
  };

  const handleSendEmail = () => {
    if (!currentReportMeta) return;
    // Without a backend SMTP relay we fall back to opening the default mail client.
    const recipientsList = currentReportMeta.recipients || [];
    const subject = currentReportMeta.subject || 'FraudLens Report';
    const body = encodeURIComponent(generatedReport);
    window.location.href = `mailto:${recipientsList.join(',')}?subject=${encodeURIComponent(
      subject
    )}&body=${body}`;
    setToastMessage('Opened mail client with default recipients.');
  };

  const handleViewStoredCopy = async () => {
    try {
      const base = process.env.REACT_APP_CHRONOS_API?.trim();
      const objectPath = currentReportMeta?.gcsObjectPath;
      if (!base || !objectPath) {
        alert('No stored copy available yet.');
        return;
      }
      const w = window.open('', '_blank');
      if (!w) {
        alert('Please enable popups to view stored copy.');
        return;
      }
      const baseUrl = base.replace(/\/$/, '');
      const metaUrl = `${baseUrl}/api/docs/meta?objectPath=${encodeURIComponent(objectPath)}`;
      const fileUrl = `${baseUrl}/api/docs/file?objectPath=${encodeURIComponent(objectPath)}`;
      const metaResp = await fetch(metaUrl);
      if (!metaResp.ok) {
        const body = await metaResp.text();
        throw new Error(body || 'Failed to fetch stored copy metadata');
      }
      const meta = await metaResp.json();

      const safe = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Stored copy</title></head><body style="margin:0;padding:16px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;background:#0b1220;color:#e5e7eb;">`);
      w.document.write(`<div style="margin-bottom:12px;font-family:system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">`);
      w.document.write(`<div style="font-weight:700;">Stored copy (GCS)</div>`);
      w.document.write(`<div style="font-size:12px;color:#94a3b8;">${safe(meta.gcsPath)}<br/>sha256: ${safe(meta.sha256)}<br/>type: ${safe(meta.contentType)} · size: ${safe(meta.sizeBytes)} bytes</div>`);
      w.document.write(`<div style="margin-top:8px;"><a href="${safe(fileUrl)}" target="_blank" rel="noreferrer" style="color:#93c5fd;text-decoration:underline;">Open file</a></div>`);
      w.document.write(`</div>`);

      if (String(meta.contentType || '').toLowerCase().includes('pdf')) {
        w.document.write(`<iframe src="${safe(fileUrl)}" style="width:100%;height:80vh;border:1px solid rgba(148,163,184,0.25);border-radius:8px;background:#0b1220;"></iframe>`);
      } else {
        const readUrl = `${baseUrl}/api/docs/read?objectPath=${encodeURIComponent(objectPath)}`;
        const resp = await fetch(readUrl);
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(body || 'Failed to fetch stored copy');
        }
        const data = await resp.json();
        w.document.write(`<pre style="white-space:pre-wrap;line-height:1.5;margin:0;">${safe(data.content)}</pre>`);
      }
      w.document.write(`</body></html>`);
      w.document.close();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to view stored copy.');
    }
  };

  const handleSaveSchedule = async () => {
    setScheduleSaving(true);
    setScheduleStatus('');
    try {
      const recipientsArray = recipients
        .split(',')
        .map(email => email.trim())
        .filter(Boolean);

      await setDoc(
        doc(db, 'scribe_config', WEEKLY_CONFIG_ID),
        {
          isEnabled: scheduleEnabled,
          recipients: recipientsArray,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      setScheduleStatus('Settings saved!');
    } catch (error) {
      console.error('Failed to save schedule', error);
      setScheduleStatus('Failed to save settings. Check console for details.');
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleSeedDemoData = async () => {
    if (seedLoading) return;
    setSeedLoading(true);
    try {
      const demoIncidentId = 'demo_incident_01';
      await setDoc(
        doc(db, 'transactions', demoIncidentId),
        {
          amount: 145000,
          currency: 'INR',
          payerVpa: 'rahul@upi',
          receiverVpa: 'acme-corp@bank',
          payerUserId: 'user_001',
          receiverUserId: 'user_099',
          modelDecision: true,
          fraudScore: 0.82,
          status: 'pending',
          timestamp: serverTimestamp(),
          locationData: {
            latitude: 19.076,
            longitude: 72.8777,
            isSuspicious: true,
            deviationFromLast: 842.3
          },
          ipData: {
            ipAddress: '203.122.19.45',
            riskScore: 88,
            isBlocked: false,
            country: 'India',
            isp: 'Jio Fiber'
          },
          narrative: 'Large anomalous transfer detected from Mumbai to corporate merchant.'
        },
        { merge: true }
      );

      await setDoc(
        doc(db, 'scribe_config', WEEKLY_CONFIG_ID),
        {
          isEnabled: false,
          recipients: REPORT_RECIPIENTS['Weekly Intelligence Summary'],
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      setToastMessage('Demo incident & schedule stub created. Use ID demo_incident_01.');
    } catch (error) {
      console.error('Failed to seed demo data', error);
      setToastMessage('Unable to seed demo data. See console.');
    } finally {
      setSeedLoading(false);
    }
  };

  const handleViewReport = async (reportId) => {
    try {
      const ref = doc(db, 'scribe_reports', reportId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setReportError('Report not found in Firestore.');
        return;
      }
      const data = snap.data();
      const {
        reportType,
        incidentId,
        content,
        recipients = [],
        subject,
        gcsPath,
        gcsObjectPath,
        gcsSha256
      } = data;
      if (!content || !reportType) {
        setReportError('Stored report is missing content or type.');
        return;
      }
      setGeneratedReport(content);
      setCurrentReportMeta({
        reportType,
        incidentId,
        reportId,
        recipients,
        subject,
        gcsPath,
        gcsObjectPath,
        gcsSha256
      });
      setReportError('');
      // Scroll to top so the preview panel is visible
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Failed to load report', error);
      setReportError('Failed to load report. Check console for details.');
    }
  };

  const handleDownloadReport = async (reportId) => {
    try {
      const ref = doc(db, 'scribe_reports', reportId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        alert('Report not found in Firestore.');
        return;
      }
      const data = snap.data();
      const { reportType, incidentId, content } = data;
      if (!content || !reportType) {
        alert('Stored report is missing content or type.');
        return;
      }
      const reportTitle = `${reportType} - ${incidentId || reportId}`;
      const parsed = parseReportContent(reportType, content);
      const printableHtml = getReportPrintHtml(reportType, parsed, incidentId || '—', reportTitle);

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please enable popups to download the PDF.');
        return;
      }
      printWindow.document.write(printableHtml);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
    } catch (error) {
      console.error('Failed to download report', error);
      alert('Failed to download report. Check console for details.');
    }
  };

  // Auto-open latest reports when arriving from Live Alerts toast
  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const reportId = params.get('reportId');
    const reportIdsRaw = params.get('reportIds');
    const incidentId = params.get('incidentId');

    const ids = reportId
      ? [reportId]
      : (reportIdsRaw || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

    if (ids.length === 0) return;

    let cancelled = false;
    const run = async () => {
      try {
        setQuickOpenLoading(true);
        const snaps = await Promise.all(
          ids.map(async (id) => {
            const ref = doc(db, 'scribe_reports', id);
            const snap = await getDoc(ref);
            if (!snap.exists()) return null;
            const data = snap.data();
            return {
              id,
              reportType: data.reportType || '—',
              incidentId: data.incidentId || incidentId || '—',
              generatedAt: data.generatedAt?.toDate?.() || null
            };
          })
        );
        const list = snaps.filter(Boolean);
        list.sort((a, b) => (b.generatedAt?.getTime?.() || 0) - (a.generatedAt?.getTime?.() || 0));
        if (cancelled) return;
        setQuickOpenReports(list);
        if (list[0]?.id) {
          await handleViewReport(list[0].id);
        }
      } catch (err) {
        console.error('Failed to auto-open reports', err);
      } finally {
        if (!cancelled) setQuickOpenLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const weeklyDefaultRecipients = useMemo(
    () => REPORT_RECIPIENTS['Weekly Intelligence Summary'],
    []
  );

  return (
    <div className="scribe-page">
      <div className="scribe-hero">
        <div className="scribe-hero__left">
          <p className="scribe-breadcrumb">
            {isExecRoute ? (
              <Link to="/exec">← Back to Executive Dashboard</Link>
            ) : (
              <Link to="/">← Back to FraudLens Dashboard</Link>
            )}
          </p>
          <h1>Scribe Autonomous Reporting</h1>
          <p className="scribe-subtitle">
            Gemini-powered drafts for SOC, executives, and regulators—ready in seconds with the
            right recipients pre-filled.
          </p>
          <div className="scribe-hero__actions">
            {!isExecRoute && (
              <>
                <button
                  className="scribe-btn outline ghost"
                  onClick={handleSeedDemoData}
                  disabled={seedLoading}
                >
                  {seedLoading ? 'Seeding...' : 'Create Demo Incident'}
                </button>
                <button className="scribe-btn secondary" onClick={() => setDocsOpen(true)}>
                  View Playbook
                </button>
                <button className="scribe-btn primary">Run Full Automation</button>
              </>
            )}
            {isExecRoute && (
              <button className="scribe-btn secondary" onClick={() => setDocsOpen(true)}>
                View Playbook
              </button>
            )}
          </div>
          <div className="scribe-hero__chips">
            {heroStats.map(stat => (
              <div key={stat.label} className="scribe-chip">
                <span>{stat.value}</span>
                <small>{stat.label}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="scribe-hero__card">
          <h3>Why teams trust Scribe</h3>
          <ul>
            <li>One-click draft for RBI (FMR-style), CERT-In, Executive Summary, SOC, GDPR, ISO 27001</li>
            <li>Auto-routes emails to internal reviewers—no accidental regulator sends</li>
            <li>Weekly brief toggle keeps leaders in sync</li>
          </ul>
          <p className="scribe-hero__note">
            Use an incident ID from your transactions list, or <code>demo_incident_01</code> after creating a demo incident.
          </p>
        </div>
      </div>

      {toastMessage && <div className="scribe-toast">{toastMessage}</div>}
      <ScribeDocsPanel open={docsOpen} onClose={() => setDocsOpen(false)} />

      {Array.isArray(quickOpenReports) && quickOpenReports.length > 0 && (
        <div className="scribe-grid" style={{ marginTop: 16 }}>
          <section className="scribe-card full-span">
            <header className="scribe-section-header" style={{ marginBottom: 12 }}>
              <p className="scribe-eyebrow">Auto-open</p>
              <h2 style={{ marginBottom: 6 }}>Latest reports ready</h2>
              <p style={{ marginBottom: 0 }}>
                Choose what to view. We auto-opened the latest one.
              </p>
            </header>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {quickOpenReports.map((r) => (
                <button
                  key={r.id}
                  className="scribe-btn secondary"
                  type="button"
                  onClick={() => handleViewReport(r.id)}
                >
                  View {r.reportType}
                </button>
              ))}
              <button
                className="scribe-btn outline"
                type="button"
                onClick={() => setQuickOpenReports(null)}
                disabled={quickOpenLoading}
              >
                Dismiss
              </button>
              {quickOpenLoading && <span className="scribe-placeholder">Loading…</span>}
            </div>
          </section>
        </div>
      )}

      <div className="scribe-grid">
        <section className="scribe-card full-span">
          <ReportGenerator
            onGenerate={handleGenerate}
            generatedReport={generatedReport}
            isGenerating={isGenerating}
            onDownload={handleDownload}
            onSendEmail={handleSendEmail}
            onViewStoredCopy={handleViewStoredCopy}
            reportMeta={currentReportMeta}
            defaultRecipients={REPORT_RECIPIENTS}
            defaultSubjects={REPORT_SUBJECTS}
            errorMessage={reportError}
            reportOptions={reportOptionsForRole}
          />
        </section>

        {!isExecRoute && (
          <section className="scribe-card">
            <ScheduledReports
              scheduleEnabled={scheduleEnabled}
              recipients={recipients}
              onToggle={() => setScheduleEnabled(!scheduleEnabled)}
              onRecipientsChange={setRecipients}
              onSave={handleSaveSchedule}
              isSaving={scheduleSaving}
              saveStatus={scheduleStatus}
              defaultRecipients={weeklyDefaultRecipients}
            />
            {scheduleLoading && <p className="scribe-placeholder">Loading schedule...</p>}
          </section>
        )}

        <section className="scribe-card">
          <RecentReportsTable
            reports={recentReports}
            onView={handleViewReport}
            onDownload={handleDownloadReport}
          />
        </section>
      </div>
    </div>
  );
};

export default ScribeDashboard;

