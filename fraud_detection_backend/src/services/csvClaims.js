'use strict';

/**
 * Minimal CSV parsing without external dependencies.
 * Assumptions:
 * - Comma-separated
 * - First line is header
 * - Supports quoted fields with commas and escaped quotes ("")
 */

/**
 * Parse one CSV line into fields.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          // Escaped quote
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else if (ch === '"') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

const REQUIRED_FIELDS = [
  'claim_id',
  'claim_amount',
  'incident_type',
  'days_since_incident',
  'policy_tenure_months',
  'prior_claims_count',
  'description',
];

/**
 * @param {any} value
 * @returns {number|null}
 */
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate and coerce a parsed row into a claim domain object.
 * @param {Record<string, string>} row
 * @param {number} rowIndex1 - 1-based row index in CSV excluding header (for errors)
 * @returns {{claim: object|null, errors: string[]}}
 */
function validateRow(row, rowIndex1) {
  /** @type {string[]} */
  const errors = [];

  for (const f of REQUIRED_FIELDS) {
    if (row[f] === undefined || String(row[f]).trim() === '') {
      errors.push(`Row ${rowIndex1}: missing required field "${f}".`);
    }
  }

  const claimAmount = toNumberOrNull(row.claim_amount);
  if (claimAmount === null || claimAmount < 0) {
    errors.push(`Row ${rowIndex1}: "claim_amount" must be a non-negative number.`);
  }

  const daysSinceIncident = toNumberOrNull(row.days_since_incident);
  if (daysSinceIncident === null || daysSinceIncident < 0) {
    errors.push(`Row ${rowIndex1}: "days_since_incident" must be a non-negative number.`);
  }

  const policyTenureMonths = toNumberOrNull(row.policy_tenure_months);
  if (policyTenureMonths === null || policyTenureMonths < 0) {
    errors.push(`Row ${rowIndex1}: "policy_tenure_months" must be a non-negative number.`);
  }

  const priorClaimsCount = toNumberOrNull(row.prior_claims_count);
  if (priorClaimsCount === null || priorClaimsCount < 0) {
    errors.push(`Row ${rowIndex1}: "prior_claims_count" must be a non-negative number.`);
  }

  if (errors.length > 0) return { claim: null, errors };

  const claim = {
    // Keep original claim_id from CSV for UI reference
    claimId: String(row.claim_id).trim(),
    claimAmount,
    incidentType: String(row.incident_type).trim(),
    daysSinceIncident,
    policyTenureMonths,
    priorClaimsCount,
    description: String(row.description || '').trim(),
  };

  return { claim, errors: [] };
}

// PUBLIC_INTERFACE
function parseClaimsCsv(csvText) {
  /**
   * Parse and validate a CSV payload into claims.
   * @param {string} csvText
   * @returns {{claims: object[], errors: string[], meta: {rows: number, accepted: number, rejected: number}}}
   */
  const text = String(csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) {
    return {
      claims: [],
      errors: ['CSV payload is empty.'],
      meta: { rows: 0, accepted: 0, rejected: 0 },
    };
  }

  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    return {
      claims: [],
      errors: ['CSV must include a header row and at least one data row.'],
      meta: { rows: Math.max(0, lines.length - 1), accepted: 0, rejected: Math.max(0, lines.length - 1) },
    };
  }

  const rawHeaders = parseCsvLine(lines[0]);
  const headers = rawHeaders.map(normalizeHeader);

  /** @type {string[]} */
  const errors = [];
  for (const required of REQUIRED_FIELDS) {
    if (!headers.includes(required)) {
      errors.push(`Missing required header "${required}".`);
    }
  }
  if (errors.length > 0) {
    return { claims: [], errors, meta: { rows: lines.length - 1, accepted: 0, rejected: lines.length - 1 } };
  }

  /** @type {object[]} */
  const claims = [];
  let rejected = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = fields[c] !== undefined ? fields[c] : '';
    }
    const { claim, errors: rowErrors } = validateRow(row, i);
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      rejected += 1;
    } else {
      claims.push(claim);
    }
  }

  return {
    claims,
    errors,
    meta: { rows: lines.length - 1, accepted: claims.length, rejected },
  };
}

module.exports = { parseClaimsCsv };
