// Bank identification from VPA handles
// For demo: supports dynamic multi-bank identification from any VPA

const VPA_BANK_MAP = {
  okhdfcbank: { code: 'HDFC', name: 'HDFC Bank', color: '#0164A3' },
  okicici: { code: 'ICICI', name: 'ICICI Bank', color: '#F37022' },
  oksbi: { code: 'SBI', name: 'State Bank of India', color: '#1B5FAA' },
  ybl: { code: 'YES', name: 'YES Bank (PhonePe)', color: '#5F259F' },
  paytm: { code: 'PAYTM', name: 'Paytm Payments Bank', color: '#00BAF2' },
  ibl: { code: 'IDBI', name: 'IDBI Bank', color: '#C7222A' },
  okaxis: { code: 'AXIS', name: 'Axis Bank', color: '#97144D' },
  axisbank: { code: 'AXIS', name: 'Axis Bank', color: '#97144D' },
  axl: { code: 'AXIS', name: 'Axis Bank', color: '#97144D' },
};

/**
 * Extract bank information from a VPA (Virtual Payment Address)
 * @param {string} vpa - VPA in format user@handle
 * @returns {Object} Bank info { code, name, color } or Unknown if not found
 */
export function getBankFromVpa(vpa) {
  if (!vpa || typeof vpa !== 'string') {
    return { code: 'UNKNOWN', name: 'Unknown Bank', color: '#6b7280' };
  }
  
  const parts = vpa.split('@');
  if (parts.length !== 2) {
    return { code: 'UNKNOWN', name: 'Unknown Bank', color: '#6b7280' };
  }
  
  const handle = parts[1].toLowerCase();
  const bankInfo = VPA_BANK_MAP[handle];
  
  if (bankInfo) {
    return bankInfo;
  }
  
  // Fallback: use handle itself as bank code
  return {
    code: handle.toUpperCase(),
    name: `${handle.toUpperCase()} Bank`,
    color: '#4b5563'
  };
}

/**
 * Check if a VPA is valid (not null/undefined and has @ symbol)
 * @param {string} vpa 
 * @returns {boolean}
 */
export function isValidVpa(vpa) {
  return vpa && typeof vpa === 'string' && vpa.includes('@');
}

/**
 * Get bank persona from query params (for multi-bank demo)
 * @returns {string|null} Bank code or null
 */
export function getBankPersonaFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('bank')?.toUpperCase() || null;
}

/**
 * Check if a transaction is inter-bank based on VPAs
 * @param {string} payerVpa 
 * @param {string} receiverVpa 
 * @returns {boolean}
 */
export function isInterBankTransaction(payerVpa, receiverVpa) {
  if (!isValidVpa(payerVpa) || !isValidVpa(receiverVpa)) {
    return false;
  }
  
  const payerBank = getBankFromVpa(payerVpa);
  const receiverBank = getBankFromVpa(receiverVpa);
  
  return payerBank.code !== receiverBank.code;
}

/**
 * Format bank badge component props
 * @param {Object} bank - Bank info from getBankFromVpa
 * @returns {Object} Style props for badge
 */
export function getBankBadgeStyle(bank) {
  return {
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    backgroundColor: bank.color,
    color: 'white',
    display: 'inline-block',
    marginLeft: '6px'
  };
}
