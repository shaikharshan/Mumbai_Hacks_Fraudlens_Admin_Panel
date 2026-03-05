/**
 * Chronos API service – fraud decision commit, incident history, document verification.
 * Uses REACT_APP_CHRONOS_API_URL (GCP VM) when set; falls back to REACT_APP_CHRONOS_API.
 */

const getBaseUrl = () => {
  const vm = process.env.REACT_APP_CHRONOS_API_URL?.trim();
  const cloudRun = process.env.REACT_APP_CHRONOS_API?.trim();
  return vm || cloudRun || '';
};

/**
 * @param {string} incidentId
 * @param {string} decision - e.g. 'FRAUD_CONFIRMED', 'APPROVED'
 * @param {string} [reasonCode] - optional
 * @param {Array<{objectPath:string, sha256:string, reportType?:string}>} [reports]
 * @param {string} [decidedBy]
 * @param {string} [bankCode]
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
export async function commitFraudDecision(incidentId, decision, reasonCode, reports = [], decidedBy, bankCode) {
  const base = getBaseUrl();
  if (!base) {
    return { ok: false, error: 'Chronos API URL not configured (REACT_APP_CHRONOS_API_URL or REACT_APP_CHRONOS_API)' };
  }

  try {
    const url = `${base.replace(/\/$/, '')}/api/chronos/decision`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incidentId,
        decision,
        reasonCode: reasonCode || undefined,
        reports: Array.isArray(reports) ? reports : [],
        decidedBy: decidedBy || undefined,
        bankCode: bankCode || undefined
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || data?.error || `HTTP ${res.status}`,
        data
      };
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Network error',
      data: null
    };
  }
}

/**
 * @param {string} incidentId
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
export async function getIncidentHistory(incidentId) {
  const base = getBaseUrl();
  if (!base) {
    return { ok: false, error: 'Chronos API URL not configured' };
  }

  try {
    const url = `${base.replace(/\/$/, '')}/api/chronos/incident/${encodeURIComponent(incidentId)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || data?.error || `HTTP ${res.status}`,
        data: null
      };
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Network error',
      data: null
    };
  }
}

/**
 * @param {string} incidentId
 * @param {string} sha256
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
export async function verifyDocument(incidentId, sha256) {
  const base = getBaseUrl();
  if (!base) {
    return { ok: false, error: 'Chronos API URL not configured' };
  }

  try {
    const params = new URLSearchParams({ incidentId, sha256 });
    const url = `${base.replace(/\/$/, '')}/api/docs/verify-doc?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || data?.error || `HTTP ${res.status}`,
        data: null
      };
    }

    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err.message || 'Network error',
      data: null
    };
  }
}

/**
 * Health check
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
export async function checkChronosHealth() {
  const base = getBaseUrl();
  if (!base) {
    return { ok: false, error: 'Chronos API URL not configured' };
  }

  try {
    const url = `${base.replace(/\/$/, '')}/api/chronos/health`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { ok: false, error: data?.message || `HTTP ${res.status}`, data };
    }

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message || 'Network error', data: null };
  }
}

/** Export for scribe/docs upload – use same base URL */
export { getBaseUrl };
