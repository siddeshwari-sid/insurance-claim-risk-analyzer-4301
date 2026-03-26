'use strict';

/**
 * Minimal CSV parsing without external dependencies.
 * Assumptions:
 * - Comma-separated
 * - First line is header
 * - Supports quoted fields with commas and escaped quotes ("")
 *
 * This module accepts multiple "header schemas" and normalizes them into the
 * canonical claim fields used by the rest of the backend (risk scoring + store).
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
  /**
   * Normalize CSV headers to a stable snake_case form.
   *
   * Supports:
   * - snake_case: claim_id
   * - spaced: "Claim Id" -> claim_id
   * - camelCase/PascalCase: claimId / ClaimId -> claim_id
   */
  const raw = String(h || '').trim();

  const withUnderscores = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_');

  return withUnderscores.toLowerCase();
}

/**
 * Header aliases supported by the backend.
 * Keys are canonical snake_case header tokens produced by normalizeHeader().
 */
const HEADER_ALIASES = {
  // canonical -> [aliases...]
  claim_id: ['claim_id', 'claimid', 'claim', 'id'],
  claim_amount: ['claim_amount', 'amount', 'claimamount', 'total_amount'],
  incident_type: ['incident_type', 'incidenttype', 'loss_type', 'type'],
  prior_claims_count: ['prior_claims_count', 'priorclaims', 'prior_claims', 'prior', 'priorclaimscount'],
  incident_date: ['incident_date', 'incidentdate', 'loss_date', 'date_of_loss'],
  filed_date: ['filed_date', 'fileddate', 'reported_date', 'report_date', 'submission_date'],
  location: ['location', 'incident_location', 'loss_location'],
  claimant_name: ['claimant_name', 'claimantname', 'claimant', 'insured_name', 'insured'],
  provider_name: ['provider_name', 'providername', 'provider', 'repair_shop', 'facility'],
  policy_number: ['policy_number', 'policynumber', 'policy', 'policy_no'],
  description: ['description', 'notes', 'note', 'details', 'comment'],
  // pre-derived numeric fields (old schema)
  days_since_incident: ['days_since_incident', 'dayssinceincident'],
  policy_tenure_months: ['policy_tenure_months', 'policytenuremonths'],
};

function buildHeaderResolver(headers) {
  /** @type {Map<string, number>} */
  const indexByHeader = new Map();
  headers.forEach((h, idx) => indexByHeader.set(h, idx));

  /**
   * Return the raw field string for any of the alias headers (if present), else ''.
   * @param {string[]} aliases
   * @param {string[]} fields
   * @returns {string}
   */
  const getByAliases = (aliases, fields) => {
    for (const a of aliases) {
      const idx = indexByHeader.get(a);
      if (idx !== undefined) {
        return fields[idx] !== undefined ? fields[idx] : '';
      }
    }
    return '';
  };

  return { getByAliases };
}

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
 * Parse YYYY-MM-DD safely (treat as UTC midnight to avoid timezone drift).
 * @param {string} value
 * @returns {Date|null}
 */
function toDateOrNull(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  // Accept ISO-like "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Fallback to Date parsing (less reliable, but better than rejecting common exports)
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whole-day difference between two dates: max(0, floor((b-a)/day))
 * @param {Date} earlier
 * @param {Date} later
 * @returns {number}
 */
function diffDays(earlier, later) {
  const ms = later.getTime() - earlier.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

/**
 * Approximate whole-month difference between two dates (year-month based).
 * @param {Date} earlier
 * @param {Date} later
 * @returns {number}
 */
function diffMonths(earlier, later) {
  const y1 = earlier.getUTCFullYear();
  const m1 = earlier.getUTCMonth();
  const y2 = later.getUTCFullYear();
  const m2 = later.getUTCMonth();
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1));
}

/**
 * Validate and coerce a parsed row into a claim domain object.
 * Supports:
 * - Legacy header set:
 *   claim_id, claim_amount, incident_type, days_since_incident, policy_tenure_months, prior_claims_count, description
 * - User-provided header set:
 *   claimId, claimantName, providerName, amount, incidentDate, filedDate, priorClaims, incidentType, location, policyNumber
 *
 * @param {object} row - canonical claim object produced by row-to-claim mapping.
 * @param {number} rowIndex1 - 1-based row index in CSV excluding header (for errors)
 * @returns {{claim: object|null, errors: string[]}}
 */
function validateClaimObject(row, rowIndex1) {
  /** @type {string[]} */
  const errors = [];

  // Required for our internal scoring pipeline
  const required = ['claimId', 'claimAmount', 'incidentType', 'daysSinceIncident', 'policyTenureMonths', 'priorClaimsCount'];

  for (const f of required) {
    if (row[f] === undefined || row[f] === null || String(row[f]).trim() === '') {
      errors.push(`Row ${rowIndex1}: missing required field "${f}".`);
    }
  }

  if (typeof row.claimId !== 'string' || row.claimId.trim() === '') {
    errors.push(`Row ${rowIndex1}: "claimId" must be a non-empty string.`);
  }

  if (!Number.isFinite(row.claimAmount) || row.claimAmount < 0) {
    errors.push(`Row ${rowIndex1}: "claimAmount" must be a non-negative number.`);
  }

  if (typeof row.incidentType !== 'string' || row.incidentType.trim() === '') {
    errors.push(`Row ${rowIndex1}: "incidentType" must be a non-empty string.`);
  }

  if (!Number.isFinite(row.daysSinceIncident) || row.daysSinceIncident < 0) {
    errors.push(`Row ${rowIndex1}: "daysSinceIncident" must be a non-negative number.`);
  }

  if (!Number.isFinite(row.policyTenureMonths) || row.policyTenureMonths < 0) {
    errors.push(`Row ${rowIndex1}: "policyTenureMonths" must be a non-negative number.`);
  }

  if (!Number.isFinite(row.priorClaimsCount) || row.priorClaimsCount < 0) {
    errors.push(`Row ${rowIndex1}: "priorClaimsCount" must be a non-negative number.`);
  }

  return errors.length > 0 ? { claim: null, errors } : { claim: row, errors: [] };
}

/**
 * Create the canonical claim object used by scoring/storage from a CSV row.
 * @param {{getByAliases: (aliases: string[], fields: string[]) => string}} resolver
 * @param {string[]} fields
 * @param {number} rowIndex1
 * @returns {{claim: object|null, errors: string[]}}
 */
function mapFieldsToClaim(resolver, fields, rowIndex1) {
  /** @type {string[]} */
  const errors = [];

  const claimIdRaw = resolver.getByAliases(HEADER_ALIASES.claim_id, fields);
  const amountRaw = resolver.getByAliases(HEADER_ALIASES.claim_amount, fields);
  const incidentTypeRaw = resolver.getByAliases(HEADER_ALIASES.incident_type, fields);
  const priorClaimsRaw = resolver.getByAliases(HEADER_ALIASES.prior_claims_count, fields);

  // Optional metadata fields (used for cross-claim signals / future UI enhancements)
  const claimantNameRaw = resolver.getByAliases(HEADER_ALIASES.claimant_name, fields);
  const providerNameRaw = resolver.getByAliases(HEADER_ALIASES.provider_name, fields);
  const locationRaw = resolver.getByAliases(HEADER_ALIASES.location, fields);
  const policyNumberRaw = resolver.getByAliases(HEADER_ALIASES.policy_number, fields);

  // Dates (used to derive daysSinceIncident + approximate policy tenure)
  const incidentDateRaw = resolver.getByAliases(HEADER_ALIASES.incident_date, fields);
  const filedDateRaw = resolver.getByAliases(HEADER_ALIASES.filed_date, fields);

  // Pre-derived numeric values (legacy schema)
  const daysSinceIncidentRaw = resolver.getByAliases(HEADER_ALIASES.days_since_incident, fields);
  const policyTenureMonthsRaw = resolver.getByAliases(HEADER_ALIASES.policy_tenure_months, fields);

  const descriptionRaw = resolver.getByAliases(HEADER_ALIASES.description, fields);

  const claimAmount = toNumberOrNull(amountRaw);
  const priorClaimsCount = toNumberOrNull(priorClaimsRaw);

  // Prefer explicitly provided numeric columns when present.
  let daysSinceIncident = toNumberOrNull(daysSinceIncidentRaw);
  let policyTenureMonths = toNumberOrNull(policyTenureMonthsRaw);

  // Derive from dates if necessary.
  const incidentDate = toDateOrNull(incidentDateRaw);
  const filedDate = toDateOrNull(filedDateRaw);

  if (daysSinceIncident === null) {
    if (incidentDate && filedDate) {
      daysSinceIncident = diffDays(incidentDate, filedDate);
    }
  }

  if (policyTenureMonths === null) {
    // We don't have policy start date in the user's sample.
    // Use a pragmatic approximation:
    // - If we have incident+filed dates, treat policy tenure as months since incident to filing (often small)
    //   which still exercises "new policy" risk rule when appropriate.
    // - Otherwise default to 12 (neutral-ish, avoids falsely flagging "new policy").
    if (incidentDate && filedDate) policyTenureMonths = diffMonths(incidentDate, filedDate);
    else policyTenureMonths = 12;
  }

  if (claimIdRaw === undefined || String(claimIdRaw).trim() === '') {
    errors.push(`Row ${rowIndex1}: missing required field "claimId/claim_id".`);
  }

  if (claimAmount === null || claimAmount < 0) {
    errors.push(`Row ${rowIndex1}: "amount/claim_amount" must be a non-negative number.`);
  }

  if (incidentTypeRaw === undefined || String(incidentTypeRaw).trim() === '') {
    errors.push(`Row ${rowIndex1}: missing required field "incidentType/incident_type".`);
  }

  if (priorClaimsCount === null || priorClaimsCount < 0) {
    errors.push(`Row ${rowIndex1}: "priorClaims/prior_claims_count" must be a non-negative number.`);
  }

  if (daysSinceIncident === null || daysSinceIncident < 0) {
    errors.push(
      `Row ${rowIndex1}: could not derive "daysSinceIncident" (provide daysSinceIncident or incidentDate+filedDate).`
    );
  }

  if (policyTenureMonths === null || policyTenureMonths < 0) {
    errors.push(`Row ${rowIndex1}: could not derive "policyTenureMonths" (provide policyTenureMonths).`);
  }

  if (errors.length > 0) return { claim: null, errors };

  const claim = {
    // Core fields used by scoring + required by API
    claimId: String(claimIdRaw).trim(),
    claimAmount,
    incidentType: String(incidentTypeRaw).trim(),
    daysSinceIncident,
    policyTenureMonths,
    priorClaimsCount,

    // Optional descriptive fields (used by keyword rule; default empty)
    description: String(descriptionRaw || '').trim(),

    // Extra fields for cross-claim signals and richer UI
    claimantName: String(claimantNameRaw || '').trim() || undefined,
    providerName: String(providerNameRaw || '').trim() || undefined,
    location: String(locationRaw || '').trim() || undefined,
    policyNumber: String(policyNumberRaw || '').trim() || undefined,

    // Keep the raw dates if provided (not currently required by API schema, but harmless)
    incidentDate: incidentDate ? incidentDate.toISOString().slice(0, 10) : (incidentDateRaw ? String(incidentDateRaw).trim() : undefined),
    filedDate: filedDate ? filedDate.toISOString().slice(0, 10) : (filedDateRaw ? String(filedDateRaw).trim() : undefined),
  };

  return validateClaimObject(claim, rowIndex1);
}

function findMissingRequiredHeaders(headers) {
  /**
   * We accept either:
   * - canonical legacy columns (claim_id, claim_amount, incident_type, days_since_incident, policy_tenure_months, prior_claims_count)
   * OR
   * - user sample columns (claimid, amount, incidentdate, fileddate, priorclaims, incidenttype)
   *
   * The goal is to avoid rejecting valid uploads just because they use the newer set.
   */
  const hasAny = (aliases) => aliases.some((a) => headers.includes(a));

  // claimId
  if (!hasAny(HEADER_ALIASES.claim_id)) return ['claimId/claim_id'];

  // amount
  if (!hasAny(HEADER_ALIASES.claim_amount)) return ['amount/claim_amount'];

  // incident type
  if (!hasAny(HEADER_ALIASES.incident_type)) return ['incidentType/incident_type'];

  // prior claims
  if (!hasAny(HEADER_ALIASES.prior_claims_count)) return ['priorClaims/prior_claims_count'];

  // daysSinceIncident OR (incidentDate + filedDate)
  const hasDays = hasAny(HEADER_ALIASES.days_since_incident);
  const hasIncidentDate = hasAny(HEADER_ALIASES.incident_date);
  const hasFiledDate = hasAny(HEADER_ALIASES.filed_date);
  if (!hasDays && !(hasIncidentDate && hasFiledDate)) {
    return ['daysSinceIncident OR (incidentDate + filedDate)'];
  }

  // policyTenureMonths is optional in the user's schema; we will default/derive.
  // So we do NOT require it at header-level.

  return [];
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

  const missing = findMissingRequiredHeaders(headers);
  if (missing.length > 0) {
    errors.push(
      `Missing required header(s): ${missing.join(', ')}. Received headers: ${rawHeaders
        .map((h) => `"${String(h).trim()}"`)
        .join(', ')}.`
    );
    return { claims: [], errors, meta: { rows: lines.length - 1, accepted: 0, rejected: lines.length - 1 } };
  }

  const resolver = buildHeaderResolver(headers);

  /** @type {object[]} */
  const claims = [];
  let rejected = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);

    const { claim, errors: rowErrors } = mapFieldsToClaim(resolver, fields, i);
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
