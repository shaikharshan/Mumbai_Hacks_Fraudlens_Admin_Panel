import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  query,
  orderBy,
  where,
  limit,
  getDocs,
  doc,
  getDoc
} from 'firebase/firestore';
import {
  Shield,
  LogOut,
  Activity,
  ClipboardList,
  AlertTriangle
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

const pageStyle = {
  minHeight: '100vh',
  backgroundColor: '#f5f5f5',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
};

const headerStyle = {
  backgroundColor: 'white',
  borderBottom: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
};

const headerContentStyle = {
  maxWidth: 1440,
  margin: '0 auto',
  padding: '12px 20px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
};

const mainStyle = {
  maxWidth: 1440,
  margin: '0 auto',
  padding: '16px 20px 24px'
};

const layoutStyle = {
  display: 'grid',
  gridTemplateColumns: '260px minmax(0, 1fr)',
  gap: 20,
  alignItems: 'flex-start'
};

const cardStyle = {
  backgroundColor: 'white',
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  padding: 18,
  marginBottom: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  height: '100%'
};

const widgetListStyle = {
  ...cardStyle,
  position: 'sticky',
  top: 16,
  maxHeight: 'calc(100vh - 140px)',
  overflowY: 'auto'
};

const widgetItemStyle = (selected) => ({
  border: `1px solid ${selected ? '#2563eb' : '#e5e7eb'}`,
  borderRadius: 10,
  padding: 10,
  marginBottom: 8,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  backgroundColor: selected ? '#eff6ff' : 'white',
  cursor: 'pointer'
});

const widgetItemTitleStyle = { fontSize: 13, fontWeight: 600, color: '#111827' };
const widgetItemDescStyle = { fontSize: 11, color: '#6b7280', marginTop: 2 };

const personaSelectStyle = {
  borderRadius: 8,
  border: '1px solid #d1d5db',
  padding: '6px 10px',
  fontSize: 13,
  color: '#374151',
  backgroundColor: 'white'
};

const widgetGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 16
};

const kpiValueStyle = { fontSize: 22, fontWeight: 700, color: '#1f2937', margin: 0 };
const kpiLabelStyle = { fontSize: 13, color: '#6b7280', margin: '0 0 4px 0' };

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle = {
  textAlign: 'left',
  padding: '8px 12px',
  backgroundColor: '#f9fafb',
  color: '#6b7280',
  fontWeight: 600
};
const tdStyle = { padding: '8px 12px', borderTop: '1px solid #e5e7eb' };

const badgeStyle = (bg, color) => ({
  padding: '3px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  backgroundColor: bg,
  color
});

const linkButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  backgroundColor: '#2563eb',
  color: 'white',
  borderRadius: 8,
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 13
};

const signOutBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  backgroundColor: 'transparent',
  color: '#6b7280',
  border: '1px solid #d1d5db',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 13
};

function getSeverity(transaction) {
  if (!transaction.modelDecision) return { level: 'Safe', color: '#10b981' };
  const score = transaction.fraudScore || 0;
  if (score > 0.7) return { level: 'High', color: '#ef4444' };
  if (score > 0.4) return { level: 'Medium', color: '#f59e0b' };
  return { level: 'Low', color: '#f97316' };
}

const PERSONAS = [
  { id: 'ceo', label: 'CEO / MD' },
  { id: 'cfo', label: 'CFO / Finance' },
  { id: 'cro', label: 'CRO / Risk' },
  { id: 'ciso', label: 'CISO / Security' },
  { id: 'ops', label: 'Head of Operations' }
];

const WIDGETS = [
  {
    id: 'kpi_overview',
    title: 'Key Fraud KPIs',
    description: 'Total volume, fraud detected, fraud rate.',
    personas: ['ceo', 'cfo', 'cro', 'ciso', 'ops']
  },
  {
    id: 'loss_vs_prevented',
    title: 'Loss vs Prevented (₹)',
    description: 'Estimate of prevented vs realised fraud loss.',
    personas: ['ceo', 'cfo', 'cro']
  },
  {
    id: 'fraud_rate_trend',
    title: 'Fraud Rate Over Time',
    description: 'Trend of fraud percentage over last 7 days.',
    personas: ['ceo', 'cro', 'ciso']
  },
  {
    id: 'volume_trend',
    title: 'Transaction Volume (7 days)',
    description: 'Total vs fraud transactions.',
    personas: ['ceo', 'cfo', 'cro', 'ops']
  },
  {
    id: 'risk_distribution',
    title: 'Risk Distribution',
    description: 'High / Medium / Low / Safe share.',
    personas: ['ceo', 'cro', 'ciso']
  },
  {
    id: 'recent_fraud',
    title: 'Recent Fraud Incidents',
    description: 'Latest high-risk cases with IDs.',
    personas: ['ceo', 'cro', 'ciso', 'ops']
  },
  {
    id: 'top_risky_vpas',
    title: 'Top Risky VPAs',
    description: 'VPAs most frequently involved in fraud flags.',
    personas: ['cro', 'ciso']
  },
  {
    id: 'top_risky_merchant',
    title: 'Top Risky Counterparties',
    description: 'Receivers with most blocked incidents.',
    personas: ['cro', 'ops']
  },
  {
    id: 'severity_mix',
    title: 'Severity Mix',
    description: 'High / Medium / Low fraud incidents.',
    personas: ['ciso', 'cro']
  },
  {
    id: 'analyst_load_placeholder',
    title: 'Analyst Workload (Planned)',
    description: 'Future: SLA and analyst throughput metrics.',
    personas: ['cro', 'ops']
  },
  {
    id: 'ncrp_pipeline_placeholder',
    title: 'NCRP Pipeline (Planned)',
    description: 'Future: count of cases sent vs pending for NCRP.',
    personas: ['ciso', 'ops']
  },
  {
    id: 'certin_reporting_placeholder',
    title: 'CERT-In Reporting (Planned)',
    description: 'Future: status of CERT-In report drafts and sends.',
    personas: ['cro', 'ciso']
  },
  {
    id: 'refund_outcomes_placeholder',
    title: 'Refund Outcomes (Planned)',
    description: 'Future: refunded vs rejected vs in-progress.',
    personas: ['ceo', 'cfo', 'ops']
  },
  {
    id: 'trust_index_placeholder',
    title: 'Trust Score Index (Planned)',
    description: 'Composite index for trust over time.',
    personas: ['ceo', 'cro']
  },
  {
    id: 'exec_summaries',
    title: 'Executive Summary Feed',
    description: 'Latest Scribe-generated summaries.',
    personas: ['ceo', 'cfo']
  },
  {
    id: 'risk_hotspots_placeholder',
    title: 'Risk Hotspots (Planned)',
    description: 'Top 5 risk hotspots by region or MO.',
    personas: ['cro', 'ciso']
  },
  {
    id: 'playbook_stats_placeholder',
    title: 'Playbook Usage (Planned)',
    description: 'Usage of block/report/refund playbooks.',
    personas: ['ops', 'cro']
  }
];

const DEFAULT_WIDGETS_BY_PERSONA = {
  ceo: ['kpi_overview', 'loss_vs_prevented', 'fraud_rate_trend', 'recent_fraud', 'exec_summaries'],
  cfo: ['kpi_overview', 'loss_vs_prevented', 'refund_outcomes_placeholder', 'exec_summaries'],
  cro: ['kpi_overview', 'fraud_rate_trend', 'risk_distribution', 'top_risky_vpas', 'recent_fraud'],
  ciso: ['kpi_overview', 'risk_distribution', 'severity_mix', 'ncrp_pipeline_placeholder', 'certin_reporting_placeholder'],
  ops: ['kpi_overview', 'volume_trend', 'recent_fraud', 'top_risky_merchant', 'analyst_load_placeholder']
};

export default function ExecDashboard() {
  const { profile, signOut } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [users, setUsers] = useState([]);
  const [certInStats, setCertInStats] = useState({ draft: 0, submitted: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [persona, setPersona] = useState('ceo');
  const [selectedWidgetIds, setSelectedWidgetIds] = useState(DEFAULT_WIDGETS_BY_PERSONA.ceo);

  useEffect(() => {
    if (!process.env.REACT_APP_FIREBASE_PROJECT_ID) {
      setError(
        'Firebase not configured. Add REACT_APP_FIREBASE_* variables to .env and restart the app (npm start).'
      );
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [txSnap, usersSnap, certInSnap] = await Promise.all([
          getDocs(
            query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(100))
          ),
          getDocs(collection(db, 'users')),
          getDocs(
            query(
              collection(db, 'scribe_reports'),
              where('reportType', '==', 'CERT-In Incident Report (India)')
            )
          )
        ]);
        const txData = await Promise.all(
          txSnap.docs.map(async (d) => {
            const data = d.data();
            let enriched = { id: d.id, ...data, timestamp: data.timestamp?.toDate?.() || new Date() };
            if (data.ipLogId) {
              try {
                const ipDoc = await getDoc(doc(db, 'ip_logs', data.ipLogId));
                if (ipDoc.exists()) enriched.ipData = ipDoc.data();
              } catch (_) {}
            }
            return enriched;
          })
        );
        setTransactions(txData);
        setUsers(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Aggregate CERT-In reporting status
        const draftCount = certInSnap.docs.filter(
          (d) => (d.data().status || 'draft') === 'draft'
        ).length;
        const submittedCount = certInSnap.docs.filter(
          (d) => (d.data().status || 'draft') === 'submitted'
        ).length;
        setCertInStats({ draft: draftCount, submitted: submittedCount });
      } catch (err) {
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    setSelectedWidgetIds(DEFAULT_WIDGETS_BY_PERSONA[persona] || []);
  }, [persona]);

  const analytics = useMemo(() => {
    const totalTransactions = transactions.length;
    const fraudDetected = transactions.filter((t) => t.modelDecision).length;
    const totalUsers = users.length;
    const avgAmount = totalTransactions
      ? Math.round(transactions.reduce((s, t) => s + (t.amount || 0), 0) / totalTransactions)
      : 0;

    const realisedLoss = transactions
      .filter((t) => t.modelDecision && t.status !== 'blocked')
      .reduce((s, t) => s + (t.amount || 0), 0);
    const preventedLoss = transactions
      .filter((t) => t.modelDecision && t.status === 'blocked')
      .reduce((s, t) => s + (t.amount || 0), 0);

    return {
      totalTransactions,
      fraudDetected,
      totalUsers,
      avgAmount,
      fraudRate: totalTransactions ? (fraudDetected / totalTransactions) * 100 : 0,
      realisedLoss,
      preventedLoss
    };
  }, [transactions, users]);

  const last7Days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return d;
      }),
    []
  );

  const chartData = useMemo(
    () =>
      last7Days.map((date) => {
        const dayTx = transactions.filter((t) => t.timestamp?.toDateString?.() === date.toDateString());
        return {
          date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          transactions: dayTx.length,
          fraud: dayTx.filter((t) => t.modelDecision).length
        };
      }),
    [last7Days, transactions]
  );

  const riskDistribution = useMemo(
    () => [
      { name: 'High', value: transactions.filter((t) => getSeverity(t).level === 'High').length, color: '#ef4444' },
      { name: 'Medium', value: transactions.filter((t) => getSeverity(t).level === 'Medium').length, color: '#f59e0b' },
      { name: 'Low', value: transactions.filter((t) => getSeverity(t).level === 'Low').length, color: '#f97316' },
      { name: 'Safe', value: transactions.filter((t) => getSeverity(t).level === 'Safe').length, color: '#10b981' }
    ],
    [transactions]
  );

  const fraudIncidents = useMemo(
    () => transactions.filter((t) => t.modelDecision).slice(0, 15),
    [transactions]
  );

  const riskyVpAs = useMemo(() => {
    const counts = new Map();
    transactions
      .filter((t) => t.modelDecision)
      .forEach((t) => {
        if (t.receiverVpa) counts.set(t.receiverVpa, (counts.get(t.receiverVpa) || 0) + 1);
      });
    return Array.from(counts.entries())
      .map(([vpa, count]) => ({ vpa, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [transactions]);

  const riskyCounterparties = useMemo(() => {
    const counts = new Map();
    transactions
      .filter((t) => t.modelDecision)
      .forEach((t) => {
        const key = t.receiverUserId || t.receiverVpa || 'unknown';
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [transactions]);

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={{ ...mainStyle, paddingTop: 80, textAlign: 'center', color: '#6b7280' }}>
          Loading executive dashboard...
        </div>
      </div>
    );
  }

  const toggleWidget = (id) => {
    setSelectedWidgetIds((current) =>
      current.includes(id) ? current.filter((w) => w !== id) : [...current, id]
    );
  };

  const renderWidget = (id) => {
    const w = WIDGETS.find((w) => w.id === id);
    if (!w) return null;

    switch (w.id) {
      case 'kpi_overview':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px 0', color: '#111827' }}>
              Key Fraud KPIs
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 12
              }}
            >
              <div>
                <p style={kpiLabelStyle}>Total transactions</p>
                <p style={kpiValueStyle}>{analytics.totalTransactions}</p>
              </div>
              <div>
                <p style={kpiLabelStyle}>Fraud detected</p>
                <p style={{ ...kpiValueStyle, color: '#dc2626' }}>{analytics.fraudDetected}</p>
              </div>
              <div>
                <p style={kpiLabelStyle}>Fraud rate</p>
                <p style={{ ...kpiValueStyle, color: '#f59e0b' }}>
                  {analytics.fraudRate.toFixed(1)}%
                </p>
              </div>
              <div>
                <p style={kpiLabelStyle}>Total users</p>
                <p style={kpiValueStyle}>{analytics.totalUsers}</p>
              </div>
              <div>
                <p style={kpiLabelStyle}>Avg amount</p>
                <p style={kpiValueStyle}>₹{analytics.avgAmount.toLocaleString()}</p>
              </div>
            </div>
          </div>
        );
      case 'loss_vs_prevented':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px 0', color: '#111827' }}>
              Loss vs Prevented (estimate)
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
              Based on confirmed fraud with status blocked vs not blocked.
            </p>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <p style={kpiLabelStyle}>Realised loss</p>
                <p style={{ ...kpiValueStyle, color: '#dc2626' }}>
                  ₹{analytics.realisedLoss.toLocaleString()}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={kpiLabelStyle}>Prevented loss</p>
                <p style={{ ...kpiValueStyle, color: '#16a34a' }}>
                  ₹{analytics.preventedLoss.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        );
      case 'fraud_rate_trend':
      case 'volume_trend':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px 0', color: '#111827' }}>
              {w.id === 'fraud_rate_trend' ? 'Fraud rate (7 days)' : 'Transaction volume (7 days)'}
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                {w.id === 'fraud_rate_trend' ? (
                  <Bar dataKey="fraud" fill="#ef4444" name="Fraud count" />
                ) : (
                  <>
                    <Bar dataKey="transactions" fill="#3b82f6" name="Total" />
                    <Bar dataKey="fraud" fill="#ef4444" name="Fraud" />
                  </>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        );
      case 'risk_distribution':
      case 'severity_mix': {
        const nonZero = riskDistribution.filter((d) => d.value > 0);
        const title = w.id === 'risk_distribution' ? 'Risk distribution' : 'Severity mix';
        if (nonZero.length === 0) {
          return (
            <div style={cardStyle}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
                {title}
              </h3>
              <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                No risk data available for the current period. As soon as incidents are flagged,
                this chart will show the mix of High / Medium / Low / Safe.
              </p>
            </div>
          );
        }
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px 0', color: '#111827' }}>
              {title}
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={nonZero}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {nonZero.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );
      }
      case 'recent_fraud':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
              Recent fraud incidents
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
              Use these incident IDs in Scribe to generate executive summaries.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Incident ID</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Risk</th>
                  <th style={thStyle}>Date</th>
                </tr>
              </thead>
              <tbody>
                {fraudIncidents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}
                    >
                      No fraud incidents in this window.
                    </td>
                  </tr>
                ) : (
                  fraudIncidents.map((t) => {
                    const sev = getSeverity(t);
                    return (
                      <tr key={t.id}>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{t.id}</td>
                        <td style={tdStyle}>₹{(t.amount || 0).toLocaleString()}</td>
                        <td style={tdStyle}>
                          <span style={badgeStyle(sev.color, 'white')}>{sev.level}</span>
                        </td>
                        <td style={tdStyle}>{t.timestamp?.toLocaleString?.() || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 8 }}>
              <Link to="/exec/reports" style={linkButtonStyle}>
                Open Reports →
              </Link>
            </div>
          </div>
        );
      case 'top_risky_vpas':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
              Top risky VPAs
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
              VPAs most frequently involved in fraud-flagged transactions.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Receiver VPA</th>
                  <th style={thStyle}>Fraud flags</th>
                </tr>
              </thead>
              <tbody>
                {riskyVpAs.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>
                      No risky VPAs detected yet.
                    </td>
                  </tr>
                ) : (
                  riskyVpAs.map((r) => (
                    <tr key={r.vpa}>
                      <td style={tdStyle}>{r.vpa}</td>
                      <td style={tdStyle}>{r.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        );
      case 'top_risky_merchant':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
              Top risky counterparties
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
              Receivers most frequently involved in fraud decisions.
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Receiver</th>
                  <th style={thStyle}>Fraud incidents</th>
                </tr>
              </thead>
              <tbody>
                {riskyCounterparties.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ ...tdStyle, color: '#6b7280', textAlign: 'center' }}>
                      No risky counterparties yet.
                    </td>
                  </tr>
                ) : (
                  riskyCounterparties.map((r) => (
                    <tr key={r.id}>
                      <td style={tdStyle}>{r.id}</td>
                      <td style={tdStyle}>{r.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        );
      case 'ncrp_pipeline_placeholder': {
        const initiated = transactions.filter((t) => t.ncrpStatus === 'initiated').length;
        const submitted = transactions.filter((t) => t.ncrpStatus === 'submitted').length;
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
              NCRP reporting pipeline
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
              Overview of incidents for which NCRP reporting has been initiated.
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <p style={kpiLabelStyle}>NCRP opened</p>
                <p style={{ ...kpiValueStyle, fontSize: 18 }}>
                  {initiated}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={kpiLabelStyle}>Marked submitted</p>
                <p style={{ ...kpiValueStyle, fontSize: 18 }}>
                  {submitted}
                </p>
              </div>
            </div>
          </div>
        );
      }
      case 'certin_reporting_placeholder':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
              CERT-In reporting status
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
              Count of CERT-In drafts vs submitted reports generated by Scribe.
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <p style={kpiLabelStyle}>Drafts in Scribe</p>
                <p style={{ ...kpiValueStyle, fontSize: 18 }}>
                  {certInStats.draft}
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={kpiLabelStyle}>Marked submitted</p>
                <p style={{ ...kpiValueStyle, fontSize: 18 }}>
                  {certInStats.submitted}
                </p>
              </div>
            </div>
          </div>
        );
      case 'exec_summaries':
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
              Executive summaries
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>
              Use the Scribe Reports view to generate and review one-page briefings for the board.
            </p>
            <Link to="/exec/reports" style={linkButtonStyle}>
              <ClipboardList size={16} />
              Go to Scribe summaries
            </Link>
          </div>
        );
      default:
        return (
          <div style={cardStyle}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px 0', color: '#111827' }}>
              {w.title}
            </h3>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              {w.description} This is a planned widget; metrics will appear here as soon as the
              underlying data is wired.
            </p>
          </div>
        );
    }
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={headerContentStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Shield size={28} color="#2563eb" />
            <div>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#1f2937',
                  margin: 0
                }}
              >
                FraudLens — Executive view
              </h1>
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                {profile?.displayName || profile?.email} (Leadership)
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#6b7280' }}>View as</span>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                style={personaSelectStyle}
              >
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <Link to="/exec/reports" style={linkButtonStyle}>
              <ClipboardList size={16} />
              Reports
            </Link>
            <button type="button" onClick={signOut} style={signOutBtnStyle}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main style={mainStyle}>
        {error && (
          <div
            style={{
              ...cardStyle,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b'
            }}
          >
            {error}
          </div>
        )}

        <div style={layoutStyle}>
          <aside style={widgetListStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Activity size={18} color="#2563eb" />
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#111827'
                  }}
                >
                  Widget library
                </h2>
                <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
                  Click to add or remove from your dashboard.
                </p>
              </div>
            </div>
            {WIDGETS.map((w) => {
              const selected = selectedWidgetIds.includes(w.id);
              const personaRecommended = w.personas?.includes(persona);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => toggleWidget(w.id)}
                  style={{
                    ...widgetItemStyle(selected),
                    width: '100%',
                    borderLeft: personaRecommended ? '3px solid #2563eb' : widgetItemStyle(selected).border
                  }}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div style={widgetItemTitleStyle}>{w.title}</div>
                    <div style={widgetItemDescStyle}>{w.description}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {personaRecommended && (
                      <span
                        style={{
                          fontSize: 10,
                          color: '#2563eb',
                          backgroundColor: '#eff6ff',
                          padding: '2px 6px',
                          borderRadius: 999
                        }}
                      >
                        Recommended
                      </span>
                    )}
                    {selected ? (
                      <span style={{ fontSize: 11, color: '#16a34a' }}>On</span>
                    ) : (
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Off</span>
                    )}
                  </div>
                </button>
              );
            })}
          </aside>

          <section>
            {selectedWidgetIds.length === 0 ? (
              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={18} color="#f59e0b" />
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 15,
                        fontWeight: 600,
                        color: '#111827'
                      }}
                    >
                      No widgets selected
                    </h3>
                    <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                      Use the widget library on the left to design your executive view.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div style={widgetGridStyle}>
                {selectedWidgetIds.map((id) => (
                  <div key={id}>{renderWidget(id)}</div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

