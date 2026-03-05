import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  doc,
  updateDoc,
  getDocs,
  Timestamp,
  getDoc,
  increment,
  where
} from 'firebase/firestore';
import { 
  AlertTriangle, 
  Shield, 
  CheckCircle, 
  XCircle, 
  User, 
  Users,
  MapPin, 
  TrendingUp,
  Eye,
  RefreshCw,
  Database,
  Search,
  Map,  
  Wifi,
  Ban,
  Globe,
  LogOut,
  FileWarning,
  Copy,
  ExternalLink
} from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import { db } from './firebase';
import ScribeDashboard from './components/scribe/ScribeDashboard';
import { generateRequiredReportsForIncident } from './components/scribe/scribeService';
import { commitFraudDecision, getIncidentHistory, verifyDocument } from './services/chronosService';
import { getBankFromVpa, getBankPersonaFromUrl, getBankBadgeStyle } from './utils/bankHelper';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Signup from './pages/Signup';
import PendingApproval from './pages/PendingApproval';
import ExecDashboard from './pages/ExecDashboard';

// Mock Firebase for demo
// const db = {};

const FraudLensAdminPanel = () => {
  const { profile, signOut, isIT, adminUsersCollection, isDemo } = useAuth();
  const [activeTab, setActiveTab] = useState('alerts');
  const [pendingUsers, setPendingUsers] = useState([]);
  const [approveRole, setApproveRole] = useState({});
  const [ncrpModalOpen, setNcrpModalOpen] = useState(false);
  const [ncrpReportTransaction, setNcrpReportTransaction] = useState(null);
  const [scribeAutoPromptTransactionId, setScribeAutoPromptTransactionId] = useState(null);
  const [scribeAutoGenerating, setScribeAutoGenerating] = useState(false);
  const [scribeAutoDoneCount, setScribeAutoDoneCount] = useState(null);
  const [scribeAutoDoneReports, setScribeAutoDoneReports] = useState(null);
  const [scribeAutoDoneIncidentId, setScribeAutoDoneIncidentId] = useState(null);
  const [scribeAutoError, setScribeAutoError] = useState(null);
  const [commitLedgerLoading, setCommitLedgerLoading] = useState(false);
  const [commitLedgerError, setCommitLedgerError] = useState(null);
  const [ledgerCommittedFor, setLedgerCommittedFor] = useState(null);
  const [incidentHistory, setIncidentHistory] = useState(null);
  const [evidenceReports, setEvidenceReports] = useState([]);

  // Direct link to NCRP complaint acceptance page so users land closer to the form.
  const NCRP_PORTAL_URL = 'https://cybercrime.gov.in/Webform/Accept.aspx';

  const buildNCRPReportText = (t) => {
    const parts = [
      'Financial fraud incident confirmed via FraudLens Admin.',
      `Incident ID: ${t.id}`,
      `Date & Time: ${t.timestamp?.toLocaleString?.() || 'N/A'}`,
      `Amount: INR ${(t.amount || 0).toLocaleString()}`,
      `Payer VPA: ${t.payerVpa || 'N/A'}`,
      `Receiver VPA: ${t.receiverVpa || 'N/A'}`,
      `Fraud score: ${((t.fraudScore || 0) * 100).toFixed(1)}%`,
      `Model decision: ${t.modelDecision ? 'FRAUD' : 'SAFE'}`
    ];
    if (t.ipData?.ipAddress) {
      parts.push(`IP: ${t.ipData.ipAddress} (Risk: ${t.ipData.riskScore || 0}%)`);
      if (t.ipData.country) parts.push(`IP Country: ${t.ipData.country}`);
    }
    if (t.locationData?.latitude != null) {
      parts.push(`Location: ${t.locationData.latitude?.toFixed(4)}, ${t.locationData.longitude?.toFixed(4)}`);
      parts.push(`Suspicious location: ${t.locationData.isSuspicious ? 'Yes' : 'No'}`);
    }
    parts.push('— End of report. Submit this description on the National Cyber Crime Reporting Portal (cybercrime.gov.in).');
    return parts.join('\n');
  };

  const openNCRPReportFlow = async (transaction) => {
    setNcrpReportTransaction(transaction);
    setNcrpModalOpen(true);
    window.open(NCRP_PORTAL_URL, '_blank', 'noopener,noreferrer');

    // Mark NCRP flow as initiated on the transaction for exec/NCRP widgets
    try {
      if (transaction?.id) {
        await updateDoc(doc(db, 'transactions', transaction.id), {
          ncrpStatus: 'initiated',
          ncrpOpenedAt: Timestamp.now()
        });
      }
    } catch (err) {
      console.error('Failed to update NCRP status on transaction', err);
    }
  };

  const copyNCRPReportToClipboard = () => {
    if (!ncrpReportTransaction) return;
    const text = buildNCRPReportText(ncrpReportTransaction);
    navigator.clipboard.writeText(text).then(() => alert('Report text copied. Paste it into the NCRP complaint form.'), () => alert('Copy failed. Please select and copy the text manually.'));
  };
  const [transactions, setTransactions] = useState([]);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [users, setUsers] = useState([]);
  const [ipLogs, setIpLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [ipSearchQuery, setIpSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    severity: 'all',
    status: 'all',
    timeRange: '24h'
  });
  const [mapFilters, setMapFilters] = useState({
    riskLevel: 'all',
    timeRange: '24h',
    transactionType: 'all'
  });
  const [ipFilters, setIpFilters] = useState({
    riskLevel: 'all',
    status: 'all',
    country: 'all'
  });
  const [analytics, setAnalytics] = useState({
    totalTransactions: 0,
    fraudDetected: 0,
    totalUsers: 0,
    avgTransactionAmount: 0,
    suspiciousLocations: 0,
    blockedIPs: 0
  });

  // Aggregate IP data from transactions
  const aggregateIpData = (transactions, ipLogsData) => {
    const ipAggregation = {};
    
    // Initialize with data from ip_logs collection
    ipLogsData.forEach(ipLog => {
      ipAggregation[ipLog.ipAddress] = {
        id: ipLog.id,
        ipAddress: ipLog.ipAddress,
        riskScore: ipLog.riskScore,
        isBlocked: ipLog.isBlocked,
        country: ipLog.country || 'Unknown',
        isp: ipLog.isp || 'Unknown',
        transactionCount: 0,
        blockedTransactions: 0,
        lastSeen: null
      };
    });

    // Aggregate transaction data for each IP
    transactions.forEach(transaction => {
      if (transaction.ipData && transaction.ipData.ipAddress) {
        const ip = transaction.ipData.ipAddress;
        
        if (ipAggregation[ip]) {
          ipAggregation[ip].transactionCount++;
          
          if (transaction.status === 'blocked') {
            ipAggregation[ip].blockedTransactions++;
          }
          
          // Update last seen to most recent transaction
          if (!ipAggregation[ip].lastSeen || transaction.timestamp > ipAggregation[ip].lastSeen) {
            ipAggregation[ip].lastSeen = transaction.timestamp;
          }
        }
      }
    });

    return Object.values(ipAggregation);
  };

  // Load pending admin users (IT only)
  useEffect(() => {
    if (!isIT || !adminUsersCollection) return;
    const loadPending = async () => {
      try {
        const snap = await getDocs(collection(db, adminUsersCollection));
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => u.approved !== true && !u.rejected);
        setPendingUsers(list);
      } catch (err) {
        console.error('Failed to load pending users', err);
      }
    };
    loadPending();
  }, [isIT, adminUsersCollection]);

  const handleApproveUser = async (uid, role) => {
    try {
      await updateDoc(doc(db, adminUsersCollection, uid), {
        approved: true,
        role: role || 'it_analyst',
        updatedAt: Timestamp.now()
      });
      setPendingUsers((prev) => prev.filter((u) => u.id !== uid));
      setApproveRole((prev) => ({ ...prev, [uid]: undefined }));
      alert('User approved.');
    } catch (err) {
      console.error(err);
      alert('Failed to approve: ' + err.message);
    }
  };

  const handleRejectUser = async (uid) => {
    try {
      await updateDoc(doc(db, adminUsersCollection, uid), {
        rejected: true,
        updatedAt: Timestamp.now()
      });
      setPendingUsers((prev) => prev.filter((u) => u.id !== uid));
      alert('User rejected.');
    } catch (err) {
      console.error(err);
      alert('Failed to reject: ' + err.message);
    }
  };

  // Load all data from Firestore (including in demo mode so you can see and correct all features)
  useEffect(() => {
    if (!process.env.REACT_APP_FIREBASE_PROJECT_ID) {
      setError('Firebase not configured. Add REACT_APP_FIREBASE_* variables to .env and restart the app (npm start).');
      setLoading(false);
      return;
    }
    const loadFirestoreData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        console.log('🔍 Loading Firestore data...');
        
        // Load IP logs first (unique IPs)
        const ipLogsSnapshot = await getDocs(collection(db, 'ip_logs'));
        const ipLogsData = ipLogsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        console.log(`🌐 Loaded ${ipLogsData.length} unique IP logs`);
        
        // Load users
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersData = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setUsers(usersData);
        console.log(`👥 Loaded ${usersData.length} users`);
        
        // Load transactions with real-time updates
        const transactionsQuery = query(
          collection(db, 'transactions'),
          orderBy('timestamp', 'desc'),
          limit(100)
        );
        
        const unsubscribe = onSnapshot(transactionsQuery, 
          async (snapshot) => {
            console.log(`📊 Found ${snapshot.docs.length} transactions`);
            
            const transactionData = await Promise.all(
              snapshot.docs.map(async (docSnapshot) => {
                const data = docSnapshot.data();
                let enrichedData = {
                  id: docSnapshot.id,
                  ...data,
                  timestamp: data.timestamp?.toDate() || new Date()
                };

                // Fetch location data if locationLogId exists
                if (data.locationLogId) {
                  try {
                    const locationDoc = await getDoc(doc(db, 'location_logs', data.locationLogId));
                    if (locationDoc.exists()) {
                      enrichedData.locationData = locationDoc.data();
                    }
                  } catch (err) {
                    console.log('Location not found for:', data.locationLogId);
                  }
                }

                // Fetch IP data if ipLogId exists
                if (data.ipLogId) {
                  try {
                    const ipDoc = await getDoc(doc(db, 'ip_logs', data.ipLogId));
                    if (ipDoc.exists()) {
                      enrichedData.ipData = {
                        id: data.ipLogId,
                        ...ipDoc.data()
                      };
                    }
                  } catch (err) {
                    console.log('IP not found for:', data.ipLogId);
                  }
                }

                return enrichedData;
              })
            );
            
            setTransactions(transactionData);
            
            // Aggregate IP data with transaction counts
            const aggregatedIpData = aggregateIpData(transactionData, ipLogsData);
            setIpLogs(aggregatedIpData);
            
            setLoading(false);
            console.log('✅ Transactions and IP data loaded successfully');
          },
          (err) => {
            console.error('❌ Error loading transactions:', err);
            const msg = err?.message || '';
            const hint = msg.includes('index') || err?.code === 'failed-precondition'
              ? ' Add the index from the error link in the console (transactions collection, timestamp descending).'
              : msg.includes('permission') || err?.code === 'permission-denied'
                ? ' Firestore rules may be blocking read. Allow read for authenticated users.'
                : '';
            setError('Failed to load transactions: ' + err.message + (hint ? ' — ' + hint : ''));
            setLoading(false);
          }
        );

        return unsubscribe;
        
      } catch (err) {
        console.error('❌ Error loading data:', err);
        const msg = err?.message || '';
        const hint = msg.includes('index') || err?.code === 'failed-precondition'
          ? ' Create a Firestore index for transactions (timestamp desc). Check the browser console for the index link.'
          : msg.includes('permission') || err?.code === 'permission-denied'
            ? ' Check Firestore rules: allow read for authenticated users or your collections.'
            : '';
        setError('Failed to connect to database: ' + err.message + (hint ? ' — ' + hint : ''));
        setLoading(false);
      }
    };

    const unsubscribe = loadFirestoreData();
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Calculate analytics from real data
  useEffect(() => {
    if (transactions.length > 0) {
      const totalTransactions = transactions.length;
      const fraudDetected = transactions.filter(t => t.modelDecision === true).length;
      const totalUsers = users.length;
      
      const avgAmount = transactions.reduce((sum, t) => sum + (t.amount || 0), 0) / totalTransactions;
      
      const suspiciousLocations = transactions.filter(t => 
        t.locationData?.isSuspicious === true
      ).length;
      
      const blockedIPs = ipLogs.filter(ip => ip.isBlocked === true).length;
      
      setAnalytics({
        totalTransactions,
        fraudDetected,
        totalUsers,
        avgTransactionAmount: Math.round(avgAmount),
        suspiciousLocations,
        blockedIPs
      });
    }
  }, [transactions, users, ipLogs]);

  // Get fraud severity based on your schema
  const getFraudSeverity = (transaction) => {
    if (!transaction.modelDecision) {
      return { level: 'Safe', color: 'safe', risk: 'low' };
    }
    
    const fraudScore = transaction.fraudScore || 0;
    const amount = transaction.amount || 0;
    
    // High risk: High fraud score OR large amount OR suspicious location + blocked IP
    if (fraudScore > 0.7 || amount > 50000 || 
        (transaction.locationData?.isSuspicious && transaction.ipData?.isBlocked)) {
      return { level: 'High', color: 'high', risk: 'high' };
    }
    // Medium risk: Medium fraud score OR medium amount OR suspicious indicators
    else if (fraudScore > 0.4 || amount > 20000 || 
             transaction.locationData?.isSuspicious || transaction.ipData?.isBlocked) {
      return { level: 'Medium', color: 'medium', risk: 'medium' };
    }
    // Low risk: Low fraud score but still flagged
    else {
      return { level: 'Low', color: 'low', risk: 'low' };
    }
  };

  // Helper function to update user balance
  const updateUserBalance = async (userId, amount, isDebit = false) => {
    try {
      const userRef = doc(db, 'users', userId);
      const balanceChange = isDebit ? -Math.abs(amount) : Math.abs(amount);
      
      await updateDoc(userRef, {
        balance: increment(balanceChange),
        lastTransaction: Timestamp.now()
      });
      
      console.log(`💰 Updated balance for user ${userId}: ${isDebit ? '-' : '+'}₹${Math.abs(amount)}`);
      return true;
    } catch (error) {
      console.error(`❌ Error updating balance for user ${userId}:`, error);
      return false;
    }
  };

  // Update transaction status with balance changes
  const updateTransactionStatus = async (transactionId, status) => {
    try {
      const transaction = transactions.find(t => t.id === transactionId);
      if (!transaction) {
        alert('❌ Transaction not found');
        return;
      }

      const amount = transaction.amount || 0;
      const payerUserId = transaction.payerUserId;
      const receiverUserId = transaction.receiverUserId;

      // Update transaction status in Firestore
      await updateDoc(doc(db, 'transactions', transactionId), {
        status: status.toLowerCase(),
        reviewedAt: Timestamp.now(),
        reviewedBy: 'admin'
      });

      // Handle balance updates based on status
      if (status.toLowerCase() === 'approved') {
        // For approved transactions: debit from payer, credit to receiver
        console.log(`✅ Approving transaction: ₹${amount} from ${payerUserId} to ${receiverUserId}`);
        
        const payerUpdated = await updateUserBalance(payerUserId, amount, true); // Debit
        const receiverUpdated = await updateUserBalance(receiverUserId, amount, false); // Credit
        
        if (!payerUpdated || !receiverUpdated) {
          alert('⚠️ Transaction approved but balance update failed for some users');
        } else {
          console.log('💰 Balance updates completed successfully');
        }
      } else if (status.toLowerCase() === 'blocked') {
        const payerUpdated = await updateUserBalance(payerUserId, amount, false); // Credit
        const receiverUpdated = await updateUserBalance(receiverUserId, amount, true); // Debit
        
        if (!payerUpdated || !receiverUpdated) {
          alert('⚠️ Transaction blocked but balance update failed for some users');
        } else {
          console.log('💰 Balance updates completed successfully');
        }

        // Chronos ledger commit (non-blocking; user can retry via Confirm Fraud button)
        const payerBank = getBankFromVpa(transaction.payerVpa);
        const ledgerResult = await commitFraudDecision(
          transactionId,
          'FRAUD_CONFIRMED',
          'ADMIN_BLOCKED',
          [],
          profile?.email || 'admin',
          payerBank.code
        );
        if (!ledgerResult.ok) {
          console.warn('Chronos ledger commit failed:', ledgerResult.error);
        }
      }
      
      // Update local state
      setTransactions(prev => 
        prev.map(t => t.id === transactionId ? { ...t, status: status.toLowerCase() } : t)
      );
      
      if (selectedTransaction?.id === transactionId) {
        setSelectedTransaction(prev => ({ ...prev, status: status.toLowerCase() }));
      }

      if (status.toLowerCase() === 'blocked') {
        setScribeAutoDoneCount(null);
        setScribeAutoDoneReports(null);
        setScribeAutoDoneIncidentId(null);
        setScribeAutoError(null);
        setScribeAutoPromptTransactionId(transactionId);
      } else {
        alert(`✅ Transaction ${status} successfully!${status.toLowerCase() === 'approved' ? ' Balances updated.' : ''}`);
      }
    } catch (error) {
      console.error('❌ Error updating transaction:', error);
      alert('❌ Error updating transaction: ' + error.message);
    }
  };

  const handleScribeAutoGenerate = async () => {
    if (!scribeAutoPromptTransactionId) return;
    setScribeAutoGenerating(true);
    setScribeAutoError(null);
    try {
      const results = await generateRequiredReportsForIncident(db, scribeAutoPromptTransactionId);
      setScribeAutoDoneCount(results.length);
      setScribeAutoDoneReports(results);
      setScribeAutoDoneIncidentId(scribeAutoPromptTransactionId);
      setScribeAutoPromptTransactionId(null);
    } catch (err) {
      console.error('Scribe auto-generate failed', err);
      setScribeAutoError(err.message || 'Failed to generate reports.');
    } finally {
      setScribeAutoGenerating(false);
    }
  };

  const dismissScribeAutoPrompt = () => {
    setScribeAutoPromptTransactionId(null);
    setScribeAutoError(null);
    if (!scribeAutoGenerating) {
      alert('✅ Transaction blocked successfully!');
    }
  };

  /** Fetch Scribe reports for an incident (objectPath, sha256, reportType) for Chronos commit */
  const getScribeReportsForIncident = async (incidentId) => {
    try {
      const q = query(
        collection(db, 'scribe_reports'),
        where('incidentId', '==', incidentId)
      );
      const snap = await getDocs(q);
      return snap.docs
        .filter(d => {
          const d2 = d.data();
          return d2.gcsObjectPath && d2.gcsSha256;
        })
        .map(d => {
          const d2 = d.data();
          return {
            objectPath: d2.gcsObjectPath,
            sha256: d2.gcsSha256,
            reportType: d2.reportType
          };
        });
    } catch (err) {
      console.error('Failed to fetch scribe reports for incident', err);
      return [];
    }
  };

  /** Confirm fraud and commit decision to Chronos ledger */
  const handleConfirmFraudAndCommitLedger = async (transaction) => {
    if (!transaction?.id) return;
    setCommitLedgerLoading(true);
    setCommitLedgerError(null);
    try {
      const reports = await getScribeReportsForIncident(transaction.id);
      const payerBank = getBankFromVpa(transaction.payerVpa);
      const result = await commitFraudDecision(
        transaction.id,
        'FRAUD_CONFIRMED',
        'ADMIN_CONFIRMED',
        reports,
        profile?.email || 'admin',
        payerBank.code
      );
      if (result.ok) {
        setLedgerCommittedFor(transaction.id);
        setIncidentHistory(prev => prev?.incidentId === transaction.id ? null : prev);
        const hist = await getIncidentHistory(transaction.id);
        if (hist.ok && hist.data) setIncidentHistory(hist.data);
      } else {
        setCommitLedgerError(result.error || 'Ledger commit failed');
      }
    } catch (err) {
      setCommitLedgerError(err.message || 'Ledger commit failed');
    } finally {
      setCommitLedgerLoading(false);
    }
  };

  /** Load incident history and evidence reports when Case Review transaction changes */
  const loadIncidentHistory = async (incidentId) => {
    if (!incidentId) {
      setIncidentHistory(null);
      setEvidenceReports([]);
      return;
    }
    const [histRes, reports] = await Promise.all([
      getIncidentHistory(incidentId),
      getScribeReportsForIncident(incidentId)
    ]);
    setIncidentHistory(histRes.ok ? histRes.data : null);
    setEvidenceReports(reports);
  };

  // Block/Unblock IP
  const toggleIpBlock = async (ipId, currentStatus) => {
    try {
      const newStatus = !currentStatus;
      
      // Update in Firestore
      await updateDoc(doc(db, 'ip_logs', ipId), {
        isBlocked: newStatus
      });
      
      // Update local state
      setIpLogs(prev => 
        prev.map(ip => ip.id === ipId ? { ...ip, isBlocked: newStatus } : ip)
      );
      
      // Update transactions with this IP
      const targetIp = ipLogs.find(ip => ip.id === ipId);
      if (targetIp) {
        setTransactions(prev => 
          prev.map(t => 
            t.ipData?.ipAddress === targetIp.ipAddress 
              ? { ...t, ipData: { ...t.ipData, isBlocked: newStatus } }
              : t
          )
        );
      }
      
      alert(`✅ IP ${newStatus ? 'blocked' : 'unblocked'} successfully!`);
      
    } catch (error) {
      console.error('❌ Error updating IP status:', error);
      alert('❌ Error updating IP status: ' + error.message);
    }
  };

  // FIXED: Filter transactions based on search and filters
  const getFilteredTransactions = () => {
    return transactions.filter(transaction => {
      const severity = getFraudSeverity(transaction);
      
      // Search filter
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        const matchesSearch = 
          transaction.id.toLowerCase().includes(searchLower) ||
          transaction.payerVpa?.toLowerCase().includes(searchLower) ||
          transaction.receiverVpa?.toLowerCase().includes(searchLower) ||
          transaction.amount?.toString().includes(searchLower) ||
          transaction.ipData?.ipAddress?.includes(searchLower);
        
        if (!matchesSearch) return false;
      }
      
      // FIXED: Remove the restrictive filter that only showed fraudulent transactions
      // Now show all transactions based on severity and status filters
      
      if (filters.severity !== 'all' && severity.level.toLowerCase() !== filters.severity) {
        return false;
      }
      
      if (filters.status !== 'all') {
        const transactionStatus = transaction.status?.toLowerCase() || 'pending';
        if (transactionStatus !== filters.status) {
          return false;
        }
      }
      
      return true;
    });
  };

  // Filter transactions for map
  const getMapFilteredTransactions = () => {
    return transactions.filter(transaction => {
      // Must have location data
      if (!transaction.locationData?.latitude || !transaction.locationData?.longitude) {
        return false;
      }

      // Search filter
      if (mapSearchQuery) {
        const searchLower = mapSearchQuery.toLowerCase();
        const matchesSearch = 
          transaction.id.toLowerCase().includes(searchLower) ||
          transaction.payerVpa?.toLowerCase().includes(searchLower) ||
          transaction.receiverVpa?.toLowerCase().includes(searchLower) ||
          transaction.ipData?.country?.toLowerCase().includes(searchLower);
        
        if (!matchesSearch) return false;
      }

      // Risk level filter
      if (mapFilters.riskLevel !== 'all') {
        const severity = getFraudSeverity(transaction);
        if (severity.level.toLowerCase() !== mapFilters.riskLevel) {
          return false;
        }
      }

      // Transaction type filter
      if (mapFilters.transactionType !== 'all') {
        if (mapFilters.transactionType === 'fraud' && !transaction.modelDecision) {
          return false;
        }
        if (mapFilters.transactionType === 'safe' && transaction.modelDecision) {
          return false;
        }
      }

      return true;
    });
  };

  // Filter IP logs
  const getFilteredIpLogs = () => {
    return ipLogs.filter(ip => {
      // Search filter
      if (ipSearchQuery) {
        const searchLower = ipSearchQuery.toLowerCase();
        const matchesSearch = 
          ip.ipAddress.toLowerCase().includes(searchLower) ||
          ip.country?.toLowerCase().includes(searchLower) ||
          ip.isp?.toLowerCase().includes(searchLower);
        
        if (!matchesSearch) return false;
      }

      // Risk level filter
      if (ipFilters.riskLevel !== 'all') {
        if (ipFilters.riskLevel === 'high' && ip.riskScore < 70) return false;
        if (ipFilters.riskLevel === 'medium' && (ip.riskScore < 30 || ip.riskScore >= 70)) return false;
        if (ipFilters.riskLevel === 'low' && ip.riskScore >= 30) return false;
      }

      // Status filter
      if (ipFilters.status !== 'all') {
        if (ipFilters.status === 'blocked' && !ip.isBlocked) return false;
        if (ipFilters.status === 'active' && ip.isBlocked) return false;
      }

      // Country filter
      if (ipFilters.country !== 'all' && ip.country !== ipFilters.country) {
        return false;
      }

      return true;
    });
  };

  // Get user details for a transaction
  const getUserDetails = (userId) => {
    return users.find(user => user.userId === userId) || { 
      username: 'Unknown User', 
      email: 'N/A',
      bankVPA: 'N/A'
    };
  };

  // Leaflet Map Component
  const LeafletMap = ({ transactions }) => {
    const mapRef = React.useRef(null);
    const mapContainerRef = React.useRef(null);
    const [isLeafletLoaded, setLeafletLoaded] = React.useState(!!window.L);

    React.useEffect(() => {
      if (window.L) return;
      
      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(cssLink);
      
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => setLeafletLoaded(true);
      document.head.appendChild(script);
      
      return () => {
        if (document.head.contains(cssLink)) {
          document.head.removeChild(cssLink);
        }
      };
    }, []);

    React.useEffect(() => {
      if (isLeafletLoaded && mapContainerRef.current && !mapRef.current) {
        mapRef.current = window.L.map(mapContainerRef.current).setView([20.5937, 78.9629], 5);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(mapRef.current);
      }

      if (mapRef.current && isLeafletLoaded) {
        // Clear existing markers
        mapRef.current.eachLayer(layer => {
          if (layer instanceof window.L.Marker) {
            layer.remove();
          }
        });

        // Filter valid transactions
        const validTransactions = transactions.filter(t => 
          t.locationData?.latitude && 
          t.locationData?.longitude &&
          !isNaN(t.locationData.latitude) &&
          !isNaN(t.locationData.longitude)
        );

        // Add new markers
        validTransactions.forEach(t => {
          const severity = getFraudSeverity(t);
          const payerUser = getUserDetails(t.payerUserId);
          const receiverUser = getUserDetails(t.receiverUserId);
          
          const markerHtml = `<div style="background-color: ${getSeverityColor(severity.level)}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.5);"></div>`;
          
          const customIcon = window.L.divIcon({
            html: markerHtml,
            className: 'custom-map-marker',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          });

          const payerBankMap = getBankFromVpa(t.payerVpa);
          const receiverBankMap = getBankFromVpa(t.receiverVpa);
          const popupContent = `
            <div style="min-width: 200px;">
              <h4 style="margin: 0 0 8px 0; color: #1f2937;">Transaction Details</h4>
              <p style="margin: 4px 0;"><b>ID:</b> ${t.id.substring(0, 8)}...</p>
              <p style="margin: 4px 0;"><b>Amount:</b> ₹${t.amount?.toLocaleString()}</p>
              <p style="margin: 4px 0;"><b>Risk Level:</b> <span style="color: ${getSeverityColor(severity.level)};">${severity.level}</span></p>
              <p style="margin: 4px 0;"><b>From:</b> ${t.payerVpa || payerUser.bankVPA || 'N/A'} <span style="background:${payerBankMap.color};color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px;">${payerBankMap.code}</span></p>
              <p style="margin: 4px 0;"><b>To:</b> ${t.receiverVpa || receiverUser.bankVPA || 'N/A'} <span style="background:${receiverBankMap.color};color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px;">${receiverBankMap.code}</span></p>
              <p style="margin: 4px 0;"><b>Status:</b> ${t.status || 'PENDING'}</p>
              <p style="margin: 4px 0;"><b>Time:</b> ${t.timestamp.toLocaleString()}</p>
            </div>
          `;

          window.L.marker([t.locationData.latitude, t.locationData.longitude], { icon: customIcon })
            .addTo(mapRef.current)
            .bindPopup(popupContent);
        });

        // Fit map to show all markers if there are any
        if (validTransactions.length > 0) {
          const group = new window.L.featureGroup(
            validTransactions.map(t => 
              window.L.marker([t.locationData.latitude, t.locationData.longitude])
            )
          );
          mapRef.current.fitBounds(group.getBounds().pad(0.1));
        }
      }
    }, [isLeafletLoaded, transactions]);

    if (!isLeafletLoaded) {
      return (
        <div style={{
          height: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #e5e7eb'
        }}>
          <p style={{ color: '#6b7280' }}>Loading Map...</p>
        </div>
      );
    }

    return (
      <div 
        ref={mapContainerRef} 
        style={{ 
          height: '60vh', 
          borderRadius: '8px',
          border: '1px solid #e5e7eb'
        }}
      />
    );
  };

  // Map View Component
  const MapView = () => {
    const mapTransactions = getMapFilteredTransactions();
    
    return (
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h2 style={cardTitleStyle}>
            <Map size={20} color="#3b82f6" />
            Real-Time Transaction Map ({mapTransactions.length} locations)
          </h2>
          <div style={mapControlsStyle}>
            <div style={searchContainerStyle}>
              <Search size={16} color="#6b7280" />
              <input
                type="text"
                placeholder="Search transactions..."
                value={mapSearchQuery}
                onChange={(e) => setMapSearchQuery(e.target.value)}
                style={searchInputStyle}
              />
            </div>
            <select 
              value={mapFilters.riskLevel} 
              onChange={(e) => setMapFilters({...mapFilters, riskLevel: e.target.value})}
              style={selectStyle}
            >
              <option value="all">All Risk Levels</option>
              <option value="high">High Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="low">Low Risk</option>
              <option value="safe">Safe</option>
            </select>
            <select 
              value={mapFilters.transactionType} 
              onChange={(e) => setMapFilters({...mapFilters, transactionType: e.target.value})}
              style={selectStyle}
            >
              <option value="all">All Types</option>
              <option value="fraud">Fraud Only</option>
              <option value="safe">Safe Only</option>
            </select>
          </div>
        </div>
        
        <div style={mapContainerStyle}>
          <LeafletMap transactions={mapTransactions} />
        </div>

        {mapTransactions.length === 0 && (
          <div style={emptyStateStyle}>
            <p>No transactions found matching your search criteria.</p>
          </div>
        )}

        <div style={mapStatsStyle}>
          <div style={mapStatItemStyle}>
            <span style={mapStatLabelStyle}>Visible Transactions:</span>
            <span style={mapStatValueStyle}>{mapTransactions.length}</span>
          </div>
          <div style={mapStatItemStyle}>
            <span style={mapStatLabelStyle}>High Risk:</span>
            <span style={{...mapStatValueStyle, color: '#ef4444'}}>
              {mapTransactions.filter(t => getFraudSeverity(t).level === 'High').length}
            </span>
          </div>
          <div style={mapStatItemStyle}>
            <span style={mapStatLabelStyle}>Medium Risk:</span>
            <span style={{...mapStatValueStyle, color: '#f59e0b'}}>
              {mapTransactions.filter(t => getFraudSeverity(t).level === 'Medium').length}
            </span>
          </div>
          <div style={mapStatItemStyle}>
            <span style={mapStatLabelStyle}>Total Value:</span>
            <span style={mapStatValueStyle}>
              ₹{mapTransactions.reduce((sum, t) => sum + (t.amount || 0), 0).toLocaleString()}
            </span>
          </div>
        </div>

        <div style={legendContainerStyle}>
          <h4 style={legendTitleStyle}>Risk Level Legend</h4>
          <div style={legendItemsContainerStyle}>
            {[
              { level: 'High', color: '#ef4444' },
              { level: 'Medium', color: '#f59e0b' },
              { level: 'Low', color: '#f97316' },
              { level: 'Safe', color: '#10b981' }
            ].map(item => (
              <div key={item.level} style={legendItemStyle}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: item.color,
                  border: '2px solid white',
                  boxShadow: '0 0 3px rgba(0,0,0,0.3)'
                }}></div>
                <span style={legendTextStyle}>{item.level} Risk</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // IP Management Component
  const IPManagement = () => {
    const filteredIpLogs = getFilteredIpLogs();
    const countries = [...new Set(ipLogs.map(ip => ip.country).filter(Boolean))];

    return (
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h2 style={cardTitleStyle}>
            <Wifi size={20} color="#3b82f6" />
            IP Address Management ({filteredIpLogs.length} IPs)
          </h2>
          <div style={ipControlsStyle}>
            <div style={searchContainerStyle}>
              <Search size={16} color="#6b7280" />
              <input
                type="text"
                placeholder="Search IP addresses..."
                value={ipSearchQuery}
                onChange={(e) => setIpSearchQuery(e.target.value)}
                style={searchInputStyle}
              />
            </div>
            <select 
              value={ipFilters.riskLevel} 
              onChange={(e) => setIpFilters({...ipFilters, riskLevel: e.target.value})}
              style={selectStyle}
            >
              <option value="all">All Risk Levels</option>
              <option value="high">High Risk (70+)</option>
              <option value="medium">Medium Risk (30-69)</option>
              <option value="low">Low Risk (&lt;30)</option>
            </select>
            <select 
              value={ipFilters.status} 
              onChange={(e) => setIpFilters({...ipFilters, status: e.target.value})}
              style={selectStyle}
            >
              <option value="all">All Status</option>
              <option value="blocked">Blocked</option>
              <option value="active">Active</option>
            </select>
            <select 
              value={ipFilters.country} 
              onChange={(e) => setIpFilters({...ipFilters, country: e.target.value})}
              style={selectStyle}
            >
              <option value="all">All Countries</option>
              {countries.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={ipListContainerStyle}>
          {filteredIpLogs.map(ip => (
            <div key={ip.id} style={ipItemStyle}>
              <div style={ipItemLeftStyle}>
                <div style={ipAddressStyle}>
                  <span style={ipAddressTextStyle}>{ip.ipAddress}</span>
                  <span style={{
                    ...ipStatusBadgeStyle,
                    backgroundColor: ip.isBlocked ? '#fecaca' : '#bbf7d0',
                    color: ip.isBlocked ? '#dc2626' : '#16a34a'
                  }}>
                    {ip.isBlocked ? 'BLOCKED' : 'ACTIVE'}
                  </span>
                </div>
                <div style={ipDetailsStyle}>
                  <span><Globe size={14} style={{marginRight: '4px'}} />{ip.country || 'Unknown'}</span>
                  <span>ISP: {ip.isp || 'Unknown'}</span>
                  <span>Risk: {ip.riskScore}%</span>
                  <span>Transactions: {ip.transactionCount || 0}</span>
                  <span>Blocked: {ip.blockedTransactions || 0}</span>
                </div>
              </div>
              <div style={ipItemRightStyle}>
                <div style={ipRiskMeterStyle}>
                  <div 
                    style={{
                      ...ipRiskBarStyle,
                      width: `${ip.riskScore}%`,
                      backgroundColor: ip.riskScore >= 70 ? '#ef4444' : ip.riskScore >= 30 ? '#f59e0b' : '#10b981'
                    }}
                  />
                </div>
                <button
                  onClick={() => toggleIpBlock(ip.id, ip.isBlocked)}
                  style={{
                    ...ipActionButtonStyle,
                    backgroundColor: ip.isBlocked ? '#10b981' : '#ef4444'
                  }}
                >
                  {ip.isBlocked ? (
                    <>
                      <CheckCircle size={16} />
                      Unblock
                    </>
                  ) : (
                    <>
                      <Ban size={16} />
                      Block
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {filteredIpLogs.length === 0 && (
          <div style={emptyStateStyle}>
            <p>No IP addresses found matching your search criteria.</p>
          </div>
        )}

        <div style={ipStatsStyle}>
          <div style={ipStatItemStyle}>
            <span style={ipStatLabelStyle}>Total IPs:</span>
            <span style={ipStatValueStyle}>{ipLogs.length}</span>
          </div>
          <div style={ipStatItemStyle}>
            <span style={ipStatLabelStyle}>Blocked:</span>
            <span style={{...ipStatValueStyle, color: '#ef4444'}}>
              {ipLogs.filter(ip => ip.isBlocked).length}
            </span>
          </div>
          <div style={ipStatItemStyle}>
            <span style={ipStatLabelStyle}>High Risk:</span>
            <span style={{...ipStatValueStyle, color: '#f59e0b'}}>
              {ipLogs.filter(ip => ip.riskScore >= 70).length}
            </span>
          </div>
          <div style={ipStatItemStyle}>
            <span style={ipStatLabelStyle}>Countries:</span>
            <span style={ipStatValueStyle}>{countries.length}</span>
          </div>
        </div>
      </div>
    );
  };

  // Enhanced Live Alerts Feed Component with Search
  const LiveAlertsFeed = () => {
    const filteredTransactions = getFilteredTransactions();
    
    return (
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <h2 style={cardTitleStyle}>
            <AlertTriangle size={20} color="#ef4444" />
            Live Fraud Alerts ({filteredTransactions.length})
          </h2>
          <div style={alertsControlsStyle}>
            <div style={searchContainerStyle}>
              <Search size={16} color="#6b7280" />
              <input
                type="text"
                placeholder="Search transactions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={searchInputStyle}
              />
            </div>
            <div style={filtersStyle}>
              <select 
                value={filters.severity} 
                onChange={(e) => setFilters({...filters, severity: e.target.value})}
                style={selectStyle}
              >
                <option value="all">All Severities</option>
                <option value="high">High Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="low">Low Risk</option>
                <option value="safe">Safe</option>
              </select>
              <select 
                value={filters.status} 
                onChange={(e) => setFilters({...filters, status: e.target.value})}
                style={selectStyle}
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="blocked">Blocked</option>
                <option value="approved">Approved</option>
              </select>
            </div>
          </div>
        </div>
        
        {error && (
          <div style={errorStyle}>
            <p>❌ {error}</p>
            <button onClick={() => window.location.reload()} style={primaryButtonStyle}>
              Retry
            </button>
          </div>
        )}
        
        {filteredTransactions.length === 0 && !loading && !error ? (
          <div style={emptyStateStyle}>
            {transactions.length === 0 && !isDemo ? (
              <>
                <p><strong>Connected to Firebase.</strong> No transactions in the database yet.</p>
                <p style={{ fontSize: 13, marginTop: 8 }}>Add documents to the <code>transactions</code> collection in Firestore, or check that your Firestore rules allow read access. If you use <code>orderBy('timestamp', 'desc')</code>, ensure the required index exists (see console for link).</p>
              </>
            ) : (
              <>
                <p>No transactions found matching your search.</p>
                <p>Total transactions in DB: {transactions.length}</p>
                <p>Fraud detected: {transactions.filter(t => t.modelDecision).length}</p>
              </>
            )}
          </div>
        ) : (
          <div style={transactionListStyle}>
            {filteredTransactions.map(transaction => {
              const severity = getFraudSeverity(transaction);
              const payerUser = getUserDetails(transaction.payerUserId);
              const receiverUser = getUserDetails(transaction.receiverUserId);
              
              return (
                <div 
                  key={transaction.id}
                  style={transactionItemStyle}
                  onClick={() => setSelectedTransaction(transaction)}
                >
                  <div>
                    <div style={transactionHeaderStyle}>
                      <span style={{
                        ...severityBadgeStyle,
                        backgroundColor: getSeverityColor(severity.level)
                      }}>
                        {severity.level}
                      </span>
                      <span style={timestampStyle}>
                        {transaction.timestamp.toLocaleString()}
                      </span>
                    </div>
                    <div style={transactionDetailsStyle}>
                      <div>
                        <strong>From:</strong> {transaction.payerVpa || payerUser.bankVPA || 'N/A'}
                        <span style={{ ...getBankBadgeStyle(getBankFromVpa(transaction.payerVpa)), marginLeft: 6 }}>{getBankFromVpa(transaction.payerVpa).code}</span>
                      </div>
                      <div>
                        <strong>To:</strong> {transaction.receiverVpa || receiverUser.bankVPA || 'N/A'}
                        <span style={{ ...getBankBadgeStyle(getBankFromVpa(transaction.receiverVpa)), marginLeft: 6 }}>{getBankFromVpa(transaction.receiverVpa).code}</span>
                      </div>
                      <div>
                        <strong>Amount:</strong> ₹{transaction.amount?.toLocaleString() || 'N/A'}
                      </div>
                      <div>
                        <strong>Fraud Score:</strong> {((transaction.fraudScore || 0) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  <div style={transactionActionsStyle}>
                    <span style={{
                      ...statusBadgeStyle,
                      backgroundColor: getStatusColor(transaction.status)
                    }}>
                      {transaction.status || 'PENDING'}
                    </span>
                    <Eye size={16} color="#9ca3af" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Case Review Component
  const CaseReview = ({
    transaction,
    onTransactionChange,
    incidentHistory,
    evidenceReports,
    onConfirmFraudCommitLedger,
    commitLedgerLoading,
    commitLedgerError,
    ledgerCommittedFor
  }) => {
    React.useEffect(() => {
      if (transaction?.id && onTransactionChange) {
        onTransactionChange(transaction.id);
      }
    }, [transaction?.id, onTransactionChange]);

    if (!transaction) {
      return (
        <div style={cardStyle}>
          <div style={emptyReviewStyle}>
            <p>Select a transaction to review</p>
          </div>
        </div>
      );
    }

    const severity = getFraudSeverity(transaction);
    const payerUser = getUserDetails(transaction.payerUserId);
    const receiverUser = getUserDetails(transaction.receiverUserId);
    const payerBank = getBankFromVpa(transaction.payerVpa);
    const receiverBank = getBankFromVpa(transaction.receiverVpa);
    const detectionDate = transaction.timestamp;
    let slaDeadline = null;
    if (detectionDate) {
      slaDeadline = new Date(detectionDate);
      slaDeadline.setDate(slaDeadline.getDate() + 21);
    }
    const withinSLA = slaDeadline ? new Date() <= slaDeadline : null;

    return (
      <div style={cardStyle}>
        <div style={reviewHeaderStyle}>
          <div>
            <h2>Transaction Review</h2>
            <div style={reviewInfoStyle}>
              <span style={{
                ...severityBadgeStyle,
                backgroundColor: getSeverityColor(severity.level)
              }}>
                {severity.level} Risk
              </span>
              <span style={transactionIdStyle}>
                ID: {transaction.id}
              </span>
            </div>
          </div>
          <div style={actionButtonsStyle}>
            <button 
              onClick={() => updateTransactionStatus(transaction.id, 'approved')}
              style={{...buttonStyle, backgroundColor: '#10b981', opacity: transaction.status === 'approved' ? 0.5 : 1,
                        cursor: transaction.status === 'approved' ? 'not-allowed' : 'pointer'}}
              disabled={transaction.status === 'approved'}
            >
              <CheckCircle size={16} />
              Approve
            </button>
            <button 
              onClick={() => updateTransactionStatus(transaction.id, 'blocked')}
              style={{...buttonStyle, backgroundColor: '#ef4444', opacity: transaction.status === 'blocked' ? 0.5 : 1,
                cursor: transaction.status === 'blocked' ? 'not-allowed' : 'pointer'}}
              disabled={transaction.status === 'blocked'}
            >
              <XCircle size={16} />
              Block
            </button>
            {(transaction.status === 'blocked' || transaction.modelDecision) && (
              <button
                type="button"
                onClick={() => openNCRPReportFlow(transaction)}
                style={{ ...buttonStyle, backgroundColor: '#7c3aed' }}
                title="Report to National Cyber Crime Portal (I4C)"
              >
                <FileWarning size={16} />
                Report to NCRP
              </button>
            )}
            {(transaction.status === 'blocked' || transaction.modelDecision) && (
              <button
                type="button"
                onClick={() => onConfirmFraudCommitLedger?.(transaction)}
                disabled={commitLedgerLoading || ledgerCommittedFor === transaction.id}
                style={{
                  ...buttonStyle,
                  backgroundColor: ledgerCommittedFor === transaction.id ? '#059669' : '#0d9488',
                  opacity: commitLedgerLoading ? 0.7 : 1
                }}
                title="Record immutable fraud decision on Chronos audit ledger for RBI"
              >
                {commitLedgerLoading ? (
                  'Committing…'
                ) : ledgerCommittedFor === transaction.id ? (
                  '✓ Committed to Ledger'
                ) : (
                  'Confirm Fraud & Commit to Ledger'
                )}
              </button>
            )}
          </div>
        </div>

        {commitLedgerError && (
          <div style={{ ...errorStyle, marginBottom: 16 }}>Ledger commit failed: {commitLedgerError}</div>
        )}

        {ledgerCommittedFor === transaction.id && (
          <div style={{ padding: '12px 16px', backgroundColor: '#d1fae5', borderRadius: 8, marginBottom: 16, color: '#065f46', fontSize: 14 }}>
            ✓ Immutable fraud decision recorded for RBI audit.
          </div>
        )}

        <div style={infoSectionStyle}>
          <h3 style={sectionTitleStyle}>Regulatory & Ledger Status</h3>
          <div style={infoListStyle}>
            <div style={infoItemStyle}>
              <span>Detection date:</span>
              <span>{detectionDate?.toLocaleString?.() || 'N/A'}</span>
            </div>
            <div style={infoItemStyle}>
              <span>RBI SLA deadline (T+21):</span>
              <span>{slaDeadline?.toLocaleDateString?.() || 'N/A'}</span>
            </div>
            <div style={infoItemStyle}>
              <span>SLA status:</span>
              <span>
                {withinSLA === null ? (
                  'N/A'
                ) : withinSLA ? (
                  <span style={{ color: '#059669', fontWeight: 600 }}>Within SLA</span>
                ) : (
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>SLA breach</span>
                )}
              </span>
            </div>
            <div style={infoItemStyle}>
              <span>Ledger status:</span>
              <span>
                {incidentHistory?.committedAt
                  ? `Anchored to Chronos audit ledger (${new Date(incidentHistory.committedAt).toLocaleString()})`
                  : ledgerCommittedFor === transaction.id
                    ? 'Anchored to Chronos audit ledger'
                    : 'Not yet committed'}
              </span>
            </div>
            {(incidentHistory?.evidenceHash || incidentHistory?.reports?.[0]?.sha256) && (
              <div style={infoItemStyle}>
                <span>Evidence hash:</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {incidentHistory.evidenceHash || incidentHistory.reports?.[0]?.sha256 || '—'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div style={reviewContentStyle}>
          <div style={reviewColumnStyle}>
            <div style={infoSectionStyle}>
              <h3 style={sectionTitleStyle}>
                <User size={18} />
                Transaction Details
              </h3>
              <div style={infoListStyle}>
                <div style={infoItemStyle}>
                  <span>Payer:</span>
                  <span>{payerUser.username || 'N/A'}</span>
                </div>
                <div style={infoItemStyle}>
                  <span>Payer VPA:</span>
                  <span>
                    {transaction.payerVpa || 'N/A'}
                    <span style={{ ...getBankBadgeStyle(payerBank), marginLeft: 6 }}>{payerBank.code}</span>
                  </span>
                </div>
                <div style={infoItemStyle}>
                  <span>Payer IFSC:</span>
                  <span>{transaction.payerIFSC || 'N/A'}</span>
                </div>
                <div style={infoItemStyle}>
                  <span>Receiver:</span>
                  <span>{receiverUser.username || 'N/A'}</span>
                </div>
                <div style={infoItemStyle}>
                  <span>Receiver VPA:</span>
                  <span>
                    {transaction.receiverVpa || 'N/A'}
                    <span style={{ ...getBankBadgeStyle(receiverBank), marginLeft: 6 }}>{receiverBank.code}</span>
                  </span>
                </div>
                <div style={infoItemStyle}>
                  <span>Amount:</span>
                  <span>₹{transaction.amount?.toLocaleString() || 'N/A'}</span>
                </div>
                <div style={infoItemStyle}>
                  <span>Status:</span>
                  <span style={{
                    color: transaction.status === 'blocked' ? '#dc2626' : 
                           transaction.status === 'approved' ? '#16a34a' : '#f59e0b'
                  }}>
                    {transaction.status || 'PENDING'}
                  </span>
                </div>
              </div>
            </div>

            <div style={infoSectionStyle}>
              <h3 style={sectionTitleStyle}>
                <MapPin size={18} />
                Location Analysis
              </h3>
              <div style={infoListStyle}>
                {transaction.locationData ? (
                  <>
                    <div style={infoItemStyle}>
                      <span>Latitude:</span>
                      <span>{transaction.locationData.latitude?.toFixed(4)}</span>
                    </div>
                    <div style={infoItemStyle}>
                      <span>Longitude:</span>
                      <span>{transaction.locationData.longitude?.toFixed(4)}</span>
                    </div>
                    <div style={infoItemStyle}>
                      <span>Deviation:</span>
                      <span>{transaction.locationData.deviationFromLast?.toFixed(2)} km</span>
                    </div>
                    <div style={infoItemStyle}>
                      <span>Suspicious:</span>
                      <span style={{
                        color: transaction.locationData.isSuspicious ? '#dc2626' : '#16a34a'
                      }}>
                        {transaction.locationData.isSuspicious ? 'YES' : 'NO'}
                      </span>
                    </div>
                  </>
                ) : (
                  <p>No location data available</p>
                )}
              </div>
            </div>
          </div>

          <div style={reviewColumnStyle}>
            <div style={infoSectionStyle}>
              <h3 style={sectionTitleStyle}>
                <Shield size={18} />
                Risk Analysis
              </h3>
              <div style={infoListStyle}>
                <div style={infoItemStyle}>
                  <span>Fraud Score:</span>
                  <span>{((transaction.fraudScore || 0) * 100).toFixed(1)}%</span>
                </div>
                <div style={infoItemStyle}>
                  <span>IP Risk Score:</span>
                  <span>{((transaction.ipRiskScore || 0) * 100).toFixed(1)}%</span>
                </div>
                <div style={infoItemStyle}>
                  <span>Location Risk Score:</span>
                  <span>{((transaction.locationRiskScore || 0) * 100).toFixed(1)}%</span>
                </div>
                <div style={infoItemStyle}>
                  <span>Model Decision:</span>
                  <span style={{
                    color: transaction.modelDecision ? '#dc2626' : '#16a34a'
                  }}>
                    {transaction.modelDecision ? 'FRAUD DETECTED' : 'SAFE'}
                  </span>
                </div>
              </div>
            </div>

            <div style={infoSectionStyle}>
              <h3 style={sectionTitleStyle}>
                <Database size={18} />
                IP Analysis
              </h3>
              <div style={infoListStyle}>
                {transaction.ipData ? (
                  <>
                    <div style={infoItemStyle}>
                      <span>IP Address:</span>
                      <span>{transaction.ipData.ipAddress}</span>
                    </div>
                    <div style={infoItemStyle}>
                      <span>Risk Score:</span>
                      <span>{transaction.ipData.riskScore}%</span>
                    </div>
                    <div style={infoItemStyle}>
                      <span>Country:</span>
                      <span>{transaction.ipData.country || 'N/A'}</span>
                    </div>
                    <div style={infoItemStyle}>
                      <span>ISP:</span>
                      <span>{transaction.ipData.isp || 'N/A'}</span>
                    </div>
                    <div style={infoItemStyle}>
                      <span>Blocked:</span>
                      <span style={{
                        color: transaction.ipData.isBlocked ? '#dc2626' : '#16a34a'
                      }}>
                        {transaction.ipData.isBlocked ? 'YES' : 'NO'}
                      </span>
                    </div>
                  </>
                ) : (
                  <p>No IP data available</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...infoSectionStyle, marginTop: 24 }}>
          <h3 style={sectionTitleStyle}>
            <Shield size={18} />
            Evidence & Stakeholders
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, backgroundColor: '#f9fafb' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#374151' }}>RBI / Financial</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                UTR: {transaction.utr || 'N/A'} · VPA: {transaction.payerVpa || 'N/A'} · ₹{transaction.amount?.toLocaleString()}
              </div>
              <Link to={`/reports?incidentId=${transaction.id}`} style={{ ...primaryButtonStyle, display: 'inline-flex', fontSize: 12, padding: '6px 12px' }}>
                Generate RBI Compliance Pack
              </Link>
            </div>
            <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, backgroundColor: '#f9fafb' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#374151' }}>CERT-In / Technical</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                IP: {transaction.ipData?.ipAddress || 'N/A'} · Device ID: {transaction.deviceId || 'N/A'}
              </div>
              <Link to={`/reports?incidentId=${transaction.id}`} style={{ ...primaryButtonStyle, display: 'inline-flex', fontSize: 12, padding: '6px 12px' }}>
                Generate CERT-In Annex
              </Link>
            </div>
            <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, backgroundColor: '#f9fafb' }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#374151' }}>Police / NCRP</div>
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
                Victim narrative available in NCRP report
              </div>
              <button type="button" onClick={() => openNCRPReportFlow(transaction)} style={{ ...primaryButtonStyle, display: 'inline-flex', fontSize: 12, padding: '6px 12px' }}>
                Generate NCRP Legal Dossier
              </button>
            </div>
          </div>
          {evidenceReports && evidenceReports.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#374151' }}>Artifacts</div>
              {evidenceReports.map((r, i) => (
                <div key={i} style={{ fontSize: 13, padding: 8, backgroundColor: '#f3f4f6', borderRadius: 6, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span><strong>{r.reportType || 'Report'}</strong> · {r.objectPath || '—'}</span>
                  <span>
                    <code style={{ fontSize: 11 }}>{r.sha256?.substring?.(0, 16)}…</code>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await verifyDocument(transaction.id, r.sha256);
                        alert(res.ok ? 'Hash verified.' : (res.error || 'Verification failed.'));
                      }}
                      style={{ marginLeft: 8, ...buttonStyle, padding: '4px 8px', fontSize: 11, backgroundColor: '#374151' }}
                    >
                      Verify hash
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Analytics Dashboard (unchanged from original)
  const AnalyticsDashboard = () => {
    // Generate chart data from real transactions
    const last7Days = Array.from({length: 7}, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return date;
    }).reverse();

    const chartData = last7Days.map(date => {
      const dayTransactions = transactions.filter(t => 
        t.timestamp.toDateString() === date.toDateString()
      );
      
      return {
        date: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        transactions: dayTransactions.length,
        fraud: dayTransactions.filter(t => t.modelDecision).length,
        amount: dayTransactions.reduce((sum, t) => sum + (t.amount || 0), 0)
      };
    });

    const riskDistribution = [
      { 
        name: 'High Risk', 
        value: transactions.filter(t => getFraudSeverity(t).level === 'High').length,
        color: '#ef4444'
      },
      { 
        name: 'Medium Risk', 
        value: transactions.filter(t => getFraudSeverity(t).level === 'Medium').length,
        color: '#f59e0b'
      },
      { 
        name: 'Low Risk', 
        value: transactions.filter(t => getFraudSeverity(t).level === 'Low').length,
        color: '#f97316'
      },
      { 
        name: 'Safe', 
        value: transactions.filter(t => getFraudSeverity(t).level === 'Safe').length,
        color: '#10b981'
      }
    ];

    return (
      <div style={analyticsContainerStyle}>
        {/* KPI Cards */}
        <div style={kpiGridStyle}>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Total Transactions</p>
                <p style={kpiValueStyle}>{analytics.totalTransactions}</p>
              </div>
              <TrendingUp size={24} color="#3b82f6" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Fraud Detected</p>
                <p style={{...kpiValueStyle, color: '#dc2626'}}>{analytics.fraudDetected}</p>
              </div>
              <Shield size={24} color="#ef4444" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Total Users</p>
                <p style={kpiValueStyle}>{analytics.totalUsers}</p>
              </div>
              <User size={24} color="#10b981" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Avg Amount</p>
                <p style={kpiValueStyle}>₹{analytics.avgTransactionAmount.toLocaleString()}</p>
              </div>
              <TrendingUp size={24} color="#3b82f6" />
            </div>
          </div>
        </div>

        {/* Charts */}
        <div style={chartsGridStyle}>
          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Transaction Volume (Last 7 Days)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="transactions" fill="#3b82f6" name="Total Transactions" />
                <Bar dataKey="fraud" fill="#ef4444" name="Fraud Detected" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={chartCardStyle}>
            <h3 style={chartTitleStyle}>Risk Distribution</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={riskDistribution.filter(item => item.value > 0)}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {riskDistribution.filter(item => item.value > 0).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Compliance & Operational Risk */}
        <div style={{ ...kpiGridStyle, marginTop: 8 }}>
          <h3 style={{ ...chartTitleStyle, gridColumn: '1 / -1' }}>Compliance & Operational Risk</h3>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Blocked Fraud (RBI 21-day window)</p>
                <p style={kpiValueStyle}>
                  {transactions.filter(t => t.status === 'blocked').filter(t => {
                    if (!t.timestamp) return false;
                    const d = new Date(t.timestamp);
                    d.setDate(d.getDate() + 21);
                    return new Date() <= d;
                  }).length} / {transactions.filter(t => t.status === 'blocked').length}
                </p>
              </div>
              <Shield size={24} color="#059669" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Blocked with Evidence</p>
                <p style={kpiValueStyle}>
                  {transactions.filter(t => t.status === 'blocked').length} incidents
                </p>
              </div>
              <Database size={24} color="#3b82f6" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Chronos Ledger</p>
                <p style={{ ...kpiValueStyle, fontSize: 14 }}>VM / Cloud Run</p>
              </div>
              <CheckCircle size={24} color="#10b981" />
            </div>
          </div>
        </div>

        {/* Additional Analytics */}
        <div style={kpiGridStyle}>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Suspicious Locations</p>
                <p style={{...kpiValueStyle, color: '#dc2626'}}>{analytics.suspiciousLocations}</p>
              </div>
              <MapPin size={24} color="#ef4444" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Blocked IPs</p>
                <p style={{...kpiValueStyle, color: '#dc2626'}}>{analytics.blockedIPs}</p>
              </div>
              <Shield size={24} color="#ef4444" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Fraud Rate</p>
                <p style={{...kpiValueStyle, color: '#f59e0b'}}>
                  {analytics.totalTransactions > 0 ? 
                    ((analytics.fraudDetected / analytics.totalTransactions) * 100).toFixed(1) + '%' : 
                    '0%'
                  }
                </p>
              </div>
              <TrendingUp size={24} color="#f59e0b" />
            </div>
          </div>
          <div style={kpiCardStyle}>
            <div style={kpiContentStyle}>
              <div>
                <p style={kpiLabelStyle}>Database Status</p>
                <p style={{...kpiValueStyle, color: '#10b981'}}>Connected</p>
              </div>
              <Database size={24} color="#10b981" />
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Helper functions for styling
  const getSeverityColor = (level) => {
    switch(level) {
      case 'High': return '#ef4444';
      case 'Medium': return '#f59e0b';
      case 'Low': return '#f97316';
      case 'Safe': return '#10b981';
      default: return '#6b7280';
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'blocked': return '#fecaca';
      case 'approved': return '#bbf7d0';
      default: return '#fef3c7';
    }
  };

  if (loading) {
    return (
      <div style={loadingContainerStyle}>
        <div style={loadingContentStyle}>
          <RefreshCw style={{animation: 'spin 1s linear infinite'}} size={32} />
          <p>Loading FraudLens Admin Panel...</p>
          <p style={{fontSize: '14px', color: '#6b7280', marginTop: '8px'}}>
            Connecting to Firestore...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={appStyle}>
      {isDemo && (
        <div style={demoBannerStyle}>
          You're viewing in <strong>demo mode</strong> — real Firebase data is loaded so you can see and correct all features. Sign out and sign in to use your real account.
        </div>
      )}
      {/* Header */}
      <header style={headerStyle}>
        <div style={headerContentStyle}>
          <div style={headerLeftStyle}>
            <Shield size={32} color="#2563eb" />
            <h1 style={headerTitleStyle}>FraudLens Admin Panel</h1>
            <span style={dbStatusStyle}>
              {error ? '🔴 Error' : '🟢 Connected'} ({transactions.length} transactions)
            </span>
          </div>
          <div style={headerRightStyle}>
            {isDemo && <span style={{ ...dbStatusStyle, backgroundColor: '#fef3c7', color: '#92400e', marginRight: 8 }}>Demo</span>}
            <span style={{ fontSize: 13, color: '#6b7280' }}>
              {profile?.displayName || profile?.email} <span style={{ ...dbStatusStyle, marginLeft: 8 }}>{profile?.role === 'it_admin' ? 'IT Admin' : 'IT'}</span>
            </span>
            <Link to="/reports" style={scribeNavButtonStyle}>
              Scribe Reports
            </Link>
            <div style={liveIndicatorStyle}>
              <div style={liveDotStyle}></div>
              Live Firestore
            </div>
            <button onClick={() => window.location.reload()} style={iconButtonStyle}>
              <RefreshCw size={20} />
            </button>
            <button onClick={signOut} style={iconButtonStyle} title="Sign out">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav style={navStyle}>
        <div style={navContentStyle}>
          <div style={navTabsStyle}>
            {[
              { id: 'alerts', label: 'Live Alerts', icon: AlertTriangle },
              { id: 'map', label: 'Map View', icon: Map },
              { id: 'ip-management', label: 'IP Management', icon: Wifi },
              { id: 'analytics', label: 'Analytics', icon: TrendingUp },
              { id: 'users', label: 'Database Info', icon: Database },
              ...(isIT ? [{ id: 'users-mgmt', label: 'User Management', icon: Users }] : []),
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  ...navTabStyle,
                  ...(activeTab === id ? activeNavTabStyle : {})
                }}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main style={mainStyle}>
        {activeTab === 'alerts' && (
          <div>
            {(() => {
              const selectedBank = getBankPersonaFromUrl();
              const consortiumIncoming = selectedBank
                ? transactions.filter(
                    t =>
                      t.status === 'blocked' &&
                      getBankFromVpa(t.receiverVpa).code === selectedBank &&
                      getBankFromVpa(t.payerVpa).code !== selectedBank
                  )
                : [];
              return consortiumIncoming.length > 0 ? (
                <div style={consortiumBannerStyle}>
                  <AlertTriangle size={20} />
                  <div>
                    <strong>Consortium Alert:</strong> Incoming funds from {consortiumIncoming.length} incident(s) flagged as FRAUD by sender bank(s). Accounts frozen via consortium policy.
                    {consortiumIncoming.slice(0, 3).map(t => (
                      <div key={t.id} style={{ marginTop: 4, fontSize: 13 }}>
                        Incident #{t.id.substring(0, 8)}… — FRAUD by {getBankFromVpa(t.payerVpa).name}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
            <div style={alertsLayoutStyle}>
            <LiveAlertsFeed />
            <CaseReview
              transaction={selectedTransaction}
              onTransactionChange={loadIncidentHistory}
              incidentHistory={incidentHistory}
              evidenceReports={evidenceReports}
              onConfirmFraudCommitLedger={handleConfirmFraudAndCommitLedger}
              commitLedgerLoading={commitLedgerLoading}
              commitLedgerError={commitLedgerError}
              ledgerCommittedFor={ledgerCommittedFor}
            />
            </div>
          </div>
        )}
        
        {activeTab === 'map' && <MapView />}
        
        {activeTab === 'ip-management' && <IPManagement />}
        
        {activeTab === 'analytics' && <AnalyticsDashboard />}

        {activeTab === 'users-mgmt' && isIT && (
          <div style={cardStyle}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', color: '#1f2937' }}>
              <Users size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              User Management — Pending approvals
            </h2>
            <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
              Approve or reject access requests. Assign role: IT Admin, IT Analyst, or Leadership (Exec).
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    <th style={{ ...thCellStyle, textAlign: 'left' }}>Email</th>
                    <th style={thCellStyle}>Name</th>
                    <th style={thCellStyle}>Requested</th>
                    <th style={thCellStyle}>Requested at</th>
                    <th style={thCellStyle}>Assign role</th>
                    <th style={thCellStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.length === 0 ? (
                    <tr><td colSpan={6} style={{ ...tdCellStyle, textAlign: 'center', color: '#6b7280' }}>No pending requests.</td></tr>
                  ) : (
                    pendingUsers.map((u) => (
                      <tr key={u.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={tdCellStyle}>{u.email}</td>
                        <td style={tdCellStyle}>{u.displayName || '—'}</td>
                        <td style={tdCellStyle}>{u.requestedRole || '—'}</td>
                        <td style={tdCellStyle}>{u.createdAt?.toDate?.()?.toLocaleString?.() || '—'}</td>
                        <td style={tdCellStyle}>
                          <select
                            value={approveRole[u.id] || 'it_analyst'}
                            onChange={(e) => setApproveRole((prev) => ({ ...prev, [u.id]: e.target.value }))}
                            style={selectStyle}
                          >
                            <option value="it_admin">IT Admin</option>
                            <option value="it_analyst">IT Analyst</option>
                            <option value="exec">Leadership (Exec)</option>
                          </select>
                        </td>
                        <td style={tdCellStyle}>
                          <button
                            type="button"
                            onClick={() => handleApproveUser(u.id, approveRole[u.id] || 'it_analyst')}
                            style={{ ...primaryButtonStyle, marginRight: 8 }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectUser(u.id)}
                            style={{ ...buttonStyle, backgroundColor: '#ef4444', color: 'white' }}
                          >
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        
        {activeTab === 'users' && (
          <div style={cardStyle}>
            <h2 style={{fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', color: '#1f2937'}}>Database Information</h2>
            
            <div style={kpiGridStyle}>
              <div style={kpiCardStyle}>
                <div style={kpiContentStyle}>
                  <div>
                    <p style={kpiLabelStyle}>Transactions Collection</p>
                    <p style={kpiValueStyle}>{transactions.length} documents</p>
                  </div>
                  <Database size={24} color="#3b82f6" />
                </div>
              </div>
              <div style={kpiCardStyle}>
                <div style={kpiContentStyle}>
                  <div>
                    <p style={kpiLabelStyle}>Users Collection</p>
                    <p style={kpiValueStyle}>{users.length} documents</p>
                  </div>
                  <User size={24} color="#10b981" />
                </div>
              </div>
              <div style={kpiCardStyle}>
                <div style={kpiContentStyle}>
                  <div>
                    <p style={kpiLabelStyle}>IP Logs Collection</p>
                    <p style={kpiValueStyle}>{ipLogs.length} documents</p>
                  </div>
                  <Wifi size={24} color="#f59e0b" />
                </div>
              </div>
              <div style={kpiCardStyle}>
                <div style={kpiContentStyle}>
                  <div>
                    <p style={kpiLabelStyle}>Connection Status</p>
                    <p style={{...kpiValueStyle, color: error ? '#ef4444' : '#10b981'}}>
                      {error ? 'Error' : 'Connected'}
                    </p>
                  </div>
                  <Database size={24} color={error ? '#ef4444' : '#10b981'} />
                </div>
              </div>
            </div>

            {error && (
              <div style={errorStyle}>
                <h3>Connection Error</h3>
                <p>{error}</p>
                <button onClick={() => window.location.reload()} style={primaryButtonStyle}>
                  Retry Connection
                </button>
              </div>
            )}

            <div style={{marginTop: '32px'}}>
              <h3 style={{fontSize: '20px', fontWeight: '600', marginBottom: '20px', color: '#374151'}}>
                Recent Transactions Sample
              </h3>
              <div style={recentTransactionsGridStyle}>
                {transactions.slice(0, 6).map(transaction => {
                  const payerUser = getUserDetails(transaction.payerUserId);
                  const receiverUser = getUserDetails(transaction.receiverUserId);
                  
                  return (
                    <div key={transaction.id} style={transactionCardStyle}>
                      <div style={transactionCardHeaderStyle}>
                        <div style={transactionIdBadgeStyle}>
                          ID: {transaction.id.substring(0, 8)}...
                        </div>
                        <div style={{
                          ...transactionStatusBadgeStyle,
                          backgroundColor: transaction.modelDecision ? '#fef2f2' : '#f0fdf4',
                          color: transaction.modelDecision ? '#dc2626' : '#16a34a',
                          border: `1px solid ${transaction.modelDecision ? '#fecaca' : '#bbf7d0'}`
                        }}>
                          {transaction.modelDecision ? '🚨 FRAUD' : '✅ SAFE'}
                        </div>
                      </div>
                      
                      <div style={transactionAmountStyle}>
                        ₹{transaction.amount?.toLocaleString()}
                      </div>
                      
                      <div style={transactionVpaContainerStyle}>
                        <div style={vpaItemStyle}>
                          <span style={vpaLabelStyle}>From:</span>
                          <span style={vpaValueStyle}>
                            {transaction.payerVpa || payerUser.bankVPA || 'N/A'}
                            <span style={{ ...getBankBadgeStyle(getBankFromVpa(transaction.payerVpa)), marginLeft: 6 }}>{getBankFromVpa(transaction.payerVpa).code}</span>
                          </span>
                        </div>
                        <div style={vpaArrowStyle}>→</div>
                        <div style={vpaItemStyle}>
                          <span style={vpaLabelStyle}>To:</span>
                          <span style={vpaValueStyle}>
                            {transaction.receiverVpa || receiverUser.bankVPA || 'N/A'}
                            <span style={{ ...getBankBadgeStyle(getBankFromVpa(transaction.receiverVpa)), marginLeft: 6 }}>{getBankFromVpa(transaction.receiverVpa).code}</span>
                          </span>
                        </div>
                      </div>
                      
                      <div style={transactionFooterStyle}>
                        <div style={timestampStyle}>
                          {transaction.timestamp.toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })} at {transaction.timestamp.toLocaleTimeString('en-GB', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                        {transaction.fraudScore && (
                          <div style={fraudScoreBadgeStyle}>
                            Risk: {(transaction.fraudScore * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                      
                      {transaction.status && (
                        <div style={{
                          ...transactionStatusFooterStyle,
                          backgroundColor: transaction.status === 'blocked' ? '#fef2f2' : 
                                         transaction.status === 'approved' ? '#f0fdf4' : '#fefbf0',
                          color: transaction.status === 'blocked' ? '#dc2626' : 
                                 transaction.status === 'approved' ? '#16a34a' : '#d97706'
                        }}>
                          Status: {transaction.status}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {transactions.length > 6 && (
                <div style={showMoreStyle}>
                  <p style={{color: '#6b7280', fontSize: '14px', margin: 0}}>
                    Showing 6 of {transactions.length} total transactions
                  </p>
                  <button 
                    onClick={() => setActiveTab('alerts')}
                    style={viewAllButtonStyle}
                  >
                    View All Transactions
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {ncrpModalOpen && ncrpReportTransaction && (
        <div style={ncrpModalBackdropStyle} onClick={() => setNcrpModalOpen(false)}>
          <div style={ncrpModalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Shield size={22} color="#7c3aed" />
                Report to National Cyber Crime Portal (I4C)
              </h3>
              <button type="button" onClick={() => setNcrpModalOpen(false)} style={{ ...iconButtonStyle, fontSize: 24, lineHeight: 1 }} aria-label="Close">×</button>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 12px 0' }}>
              The portal has opened in a new tab. Copy the text below and paste it into the complaint description (min 200 characters).
            </p>
            <textarea
              readOnly
              value={buildNCRPReportText(ncrpReportTransaction)}
              style={ncrpReportTextareaStyle}
              rows={12}
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" onClick={copyNCRPReportToClipboard} style={{ ...primaryButtonStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Copy size={18} />
                Copy report text
              </button>
              <button type="button" onClick={() => window.open(NCRP_PORTAL_URL, '_blank')} style={{ ...buttonStyle, backgroundColor: '#374151', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                <ExternalLink size={18} />
                Open NCRP portal
              </button>
              <button type="button" onClick={() => setNcrpModalOpen(false)} style={{ ...buttonStyle, backgroundColor: '#e5e7eb', color: '#374151' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {scribeAutoPromptTransactionId && (
        <div style={ncrpModalBackdropStyle} onClick={dismissScribeAutoPrompt}>
          <div style={ncrpModalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileWarning size={22} color="#059669" />
                Generate compliance reports (Scribe)
              </h3>
              {!scribeAutoGenerating && (
                <button type="button" onClick={dismissScribeAutoPrompt} style={{ ...iconButtonStyle, fontSize: 24, lineHeight: 1 }} aria-label="Close">×</button>
              )}
            </div>
            <p style={{ fontSize: 14, color: '#374151', margin: '0 0 12px 0' }}>
              Transaction blocked. Create the required reports for this incident so they can be sent to the concerned authorities (IT/Compliance, Leadership)?
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px 0' }}>
              Will generate: <strong>RBI Fraud Report</strong>, <strong>CERT-In Incident Report</strong>, <strong>Executive Summary</strong>. You can then open Scribe to send them to the right recipients.
            </p>
            {scribeAutoError && (
              <p style={{ fontSize: 13, color: '#dc2626', margin: '0 0 12px 0' }}>{scribeAutoError}</p>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleScribeAutoGenerate}
                disabled={scribeAutoGenerating}
                style={{ ...primaryButtonStyle, display: 'flex', alignItems: 'center', gap: 8, opacity: scribeAutoGenerating ? 0.7 : 1 }}
              >
                {scribeAutoGenerating ? 'Generating reports…' : 'Generate reports'}
              </button>
              <button type="button" onClick={dismissScribeAutoPrompt} disabled={scribeAutoGenerating} style={{ ...buttonStyle, backgroundColor: '#e5e7eb', color: '#374151' }}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {scribeAutoDoneCount != null && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: '#059669', color: 'white', padding: '12px 20px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <CheckCircle size={20} />
          <span>{scribeAutoDoneCount} reports generated. Open Scribe to send to authorities.</span>
          <Link
            to={`/reports?reportIds=${encodeURIComponent(
              (scribeAutoDoneReports || []).map(r => r.reportId).filter(Boolean).join(',')
            )}&incidentId=${encodeURIComponent(scribeAutoDoneIncidentId || '')}`}
            style={{ color: 'white', fontWeight: 600, textDecoration: 'underline' }}
          >
            Open latest reports
          </Link>
          <button
            type="button"
            onClick={() => {
              setScribeAutoDoneCount(null);
              setScribeAutoDoneReports(null);
              setScribeAutoDoneIncidentId(null);
            }}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

const App = () => (
  <Router>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/pending" element={<PendingApproval />} />
      <Route path="/" element={<ProtectedRoute role="it"><FraudLensAdminPanel /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute role="it"><ScribeDashboard /></ProtectedRoute>} />
      <Route path="/exec" element={<ProtectedRoute role="exec"><ExecDashboard /></ProtectedRoute>} />
      <Route path="/exec/reports" element={<ProtectedRoute role="exec"><ScribeDashboard /></ProtectedRoute>} />
    </Routes>
  </Router>
);

const legendContainerStyle = {
  marginTop: '20px',
  padding: '16px',
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  border: '1px solid #e5e7eb'
};

const legendTitleStyle = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#374151',
  margin: '0 0 12px 0'
};

const legendItemsContainerStyle = {
  display: 'flex',
  gap: '20px',
  flexWrap: 'wrap'
};

const legendItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
};

const legendTextStyle = {
  fontSize: '13px',
  color: '#6b7280',
  fontWeight: '500'
};

// New styles for enhanced Database Information page
const recentTransactionsGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
  gap: '20px',
  marginBottom: '24px'
};

const transactionCardStyle = {
  backgroundColor: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
  transition: 'all 0.2s ease',
  position: 'relative',
  overflow: 'hidden'
};

const transactionCardHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px'
};

const transactionIdBadgeStyle = {
  backgroundColor: '#f3f4f6',
  color: '#374151',
  fontSize: '12px',
  fontWeight: '500',
  padding: '4px 8px',
  borderRadius: '6px',
  fontFamily: 'monospace'
};

const transactionStatusBadgeStyle = {
  fontSize: '12px',
  fontWeight: '600',
  padding: '4px 8px',
  borderRadius: '6px'
};

const transactionAmountStyle = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#1f2937',
  marginBottom: '16px',
  textAlign: 'center'
};

const transactionVpaContainerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '16px',
  padding: '12px',
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  border: '1px solid #f3f4f6'
};

const vpaItemStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const vpaLabelStyle = {
  fontSize: '11px',
  fontWeight: '500',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
};

const vpaValueStyle = {
  fontSize: '13px',
  fontWeight: '600',
  color: '#374151',
  fontFamily: 'monospace',
  wordBreak: 'break-all'
};

const vpaArrowStyle = {
  fontSize: '16px',
  color: '#9ca3af',
  fontWeight: 'bold'
};

const transactionFooterStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingTop: '12px',
  borderTop: '1px solid #f3f4f6'
};

const fraudScoreBadgeStyle = {
  backgroundColor: '#fef3c7',
  color: '#d97706',
  fontSize: '11px',
  fontWeight: '600',
  padding: '4px 8px',
  borderRadius: '6px'
};

const transactionStatusFooterStyle = {
  marginTop: '12px',
  padding: '8px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: '600',
  textAlign: 'center'
};

const showMoreStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px',
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
  border: '1px solid #e5e7eb'
};

const viewAllButtonStyle = {
  padding: '8px 16px',
  backgroundColor: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'background-color 0.2s'
};

// Existing styles
const appStyle = {
  minHeight: '100vh',
  backgroundColor: '#f5f5f5',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
};

const headerStyle = {
  backgroundColor: 'white',
  borderBottom: '1px solid #e5e7eb',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
};

const headerContentStyle = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '16px 24px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
};

const headerLeftStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px'
};

const headerTitleStyle = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#1f2937',
  margin: 0
};

const dbStatusStyle = {
  fontSize: '12px',
  color: '#6b7280',
  padding: '4px 8px',
  backgroundColor: '#f3f4f6',
  borderRadius: '4px'
};

const headerRightStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px'
};

const scribeNavButtonStyle = {
  padding: '8px 14px',
  borderRadius: '6px',
  border: '1px solid #2563eb',
  color: '#2563eb',
  fontWeight: 600,
  textDecoration: 'none'
};

const liveIndicatorStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  color: '#6b7280'
};

const liveDotStyle = {
  width: '8px',
  height: '8px',
  backgroundColor: '#10b981',
  borderRadius: '50%',
  animation: 'pulse 2s infinite'
};

const iconButtonStyle = {
  padding: '8px',
  border: 'none',
  background: 'none',
  color: '#9ca3af',
  cursor: 'pointer',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center'
};

const navStyle = {
  backgroundColor: 'white',
  borderBottom: '1px solid #e5e7eb'
};

const navContentStyle = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 24px'
};

const navTabsStyle = {
  display: 'flex',
  gap: '32px'
};

const navTabStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '16px 0',
  border: 'none',
  background: 'none',
  color: '#6b7280',
  fontSize: '14px',
  fontWeight: '500',
  cursor: 'pointer',
  borderBottom: '2px solid transparent'
};

const activeNavTabStyle = {
  color: '#2563eb',
  borderBottomColor: '#2563eb'
};

const mainStyle = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '32px 24px'
};

const cardStyle = {
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  padding: '24px'
};

const cardHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px'
};

const cardTitleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '20px',
  fontWeight: 'bold',
  color: '#1f2937',
  margin: 0
};

// New Styles for Enhanced Features
const searchContainerStyle = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  padding: '8px 12px',
  minWidth: '200px'
};

const searchInputStyle = {
  border: 'none',
  background: 'none',
  outline: 'none',
  marginLeft: '8px',
  fontSize: '14px',
  width: '100%'
};

const alertsControlsStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  alignItems: 'flex-end'
};

const mapControlsStyle = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  flexWrap: 'wrap'
};

const ipControlsStyle = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
  flexWrap: 'wrap'
};

const mapContainerStyle = {
  marginBottom: '20px'
};

const mapStatsStyle = {
  display: 'flex',
  gap: '24px',
  padding: '16px',
  backgroundColor: '#f9fafb',
  borderRadius: '6px',
  marginTop: '16px'
};

const mapStatItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const mapStatLabelStyle = {
  fontSize: '12px',
  color: '#6b7280',
  fontWeight: '500'
};

const mapStatValueStyle = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#1f2937'
};

const ipListContainerStyle = {
  maxHeight: '600px',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  marginBottom: '20px'
};

const ipItemStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  transition: 'box-shadow 0.2s',
  cursor: 'pointer'
};

const ipItemLeftStyle = {
  flex: 1
};

const ipAddressStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  marginBottom: '8px'
};

const ipAddressTextStyle = {
  fontSize: '16px',
  fontWeight: 'bold',
  fontFamily: 'monospace',
  color: '#1f2937'
};

const ipStatusBadgeStyle = {
  padding: '4px 8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontWeight: '600'
};

const ipDetailsStyle = {
  display: 'flex',
  gap: '16px',
  fontSize: '14px',
  color: '#6b7280',
  alignItems: 'center'
};

const ipItemRightStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '16px'
};

const ipRiskMeterStyle = {
  width: '100px',
  height: '8px',
  backgroundColor: '#e5e7eb',
  borderRadius: '4px',
  overflow: 'hidden',
  position: 'relative'
};

const ipRiskBarStyle = {
  height: '100%',
  transition: 'width 0.3s ease'
};

const ipActionButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 12px',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: '500',
  cursor: 'pointer',
  color: 'white',
  transition: 'opacity 0.2s'
};

const ipStatsStyle = {
  display: 'flex',
  gap: '24px',
  padding: '16px',
  backgroundColor: '#f9fafb',
  borderRadius: '6px'
};

const ipStatItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px'
};

const ipStatLabelStyle = {
  fontSize: '12px',
  color: '#6b7280',
  fontWeight: '500'
};

const ipStatValueStyle = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#1f2937'
};

// Existing styles
const filtersStyle = {
  display: 'flex',
  gap: '8px'
};

const selectStyle = {
  padding: '4px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  fontSize: '14px',
  cursor: 'pointer'
};

const errorStyle = {
  textAlign: 'center',
  padding: '20px',
  backgroundColor: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '8px',
  color: '#991b1b'
};

const emptyStateStyle = {
  textAlign: 'center',
  padding: '40px 20px',
  color: '#6b7280'
};

const transactionListStyle = {
  maxHeight: '400px',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
};

const transactionItemStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '12px',
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  transition: 'background-color 0.2s'
};

const transactionHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '8px'
};

const severityBadgeStyle = {
  padding: '4px 8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontWeight: '500',
  color: 'white'
};

const timestampStyle = {
  fontSize: '14px',
  color: '#6b7280'
};

const transactionDetailsStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '8px',
  fontSize: '14px'
};

const transactionActionsStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px'
};

const statusBadgeStyle = {
  padding: '4px 8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontWeight: '500',
  color: '#374151'
};

const emptyReviewStyle = {
  textAlign: 'center',
  padding: '40px 20px',
  color: '#6b7280'
};

const reviewHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: '24px'
};

const reviewInfoStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginTop: '8px'
};

const transactionIdStyle = {
  fontSize: '14px',
  color: '#6b7280'
};

const actionButtonsStyle = {
  display: 'flex',
  gap: '8px'
};

const buttonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 16px',
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: '500',
  cursor: 'pointer',
  color: 'white'
};

const reviewContentStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '24px'
};

const reviewColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px'
};

const infoSectionStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px'
};

const sectionTitleStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '16px',
  fontWeight: '600',
  marginBottom: '12px',
  color: '#374151',
  margin: '0 0 12px 0'
};

const infoListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontSize: '14px'
};

const infoItemStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center'
};

const analyticsContainerStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px'
};

const kpiGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
  gap: '16px'
};

const kpiCardStyle = {
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  padding: '24px'
};

const kpiContentStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between'
};

const kpiLabelStyle = {
  fontSize: '14px',
  fontWeight: '500',
  color: '#6b7280',
  marginBottom: '4px',
  margin: '0 0 4px 0'
};

const kpiValueStyle = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#1f2937',
  margin: 0
};

const chartsGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '24px'
};

const chartCardStyle = {
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  padding: '24px'
};

const chartTitleStyle = {
  fontSize: '16px',
  fontWeight: '600',
  marginBottom: '16px',
  color: '#374151',
  margin: '0 0 16px 0'
};

const alertsLayoutStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '32px'
};

const loadingContainerStyle = {
  minHeight: '100vh',
  backgroundColor: '#f5f5f5',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const loadingContentStyle = {
  textAlign: 'center'
};

const primaryButtonStyle = {
  padding: '8px 16px',
  backgroundColor: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer'
};

const thCellStyle = { padding: '12px 16px', fontWeight: 600, color: '#374151' };
const tdCellStyle = { padding: '12px 16px' };

const consortiumBannerStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: 16,
  marginBottom: 16,
  backgroundColor: '#fef3c7',
  border: '1px solid #f59e0b',
  borderRadius: 8,
  color: '#92400e'
};

const demoBannerStyle = {
  backgroundColor: '#fef3c7',
  borderBottom: '1px solid #f59e0b',
  padding: '10px 24px',
  textAlign: 'center',
  fontSize: 14,
  color: '#92400e'
};

const ncrpModalBackdropStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 24
};
const ncrpModalContentStyle = {
  backgroundColor: 'white',
  borderRadius: 12,
  padding: 24,
  maxWidth: 560,
  width: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
};
const ncrpReportTextareaStyle = {
  width: '100%',
  minHeight: 200,
  padding: 12,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  fontSize: 13,
  fontFamily: 'monospace',
  resize: 'vertical',
  boxSizing: 'border-box'
};

export default App;