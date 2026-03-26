'use strict';

/**
 * Risk scoring rules (deterministic):
 * - Start score at 0.
 * - Add points based on rule matches; choose risk by score thresholds.
 *
 * Thresholds:
 * - High: score >= 8
 * - Medium: score >= 4
 * - Low: otherwise
 *
 * Base single-claim rules:
 * - claimAmount >= 10000 => +4
 * - claimAmount > 50000 => +6 (instead of +4; highest applicable)
 * - daysSinceIncident > 30 => +2
 * - policyTenureMonths < 3 => +2
 * - priorClaimsCount >= 3 => +3
 * - priorClaimsCount >= 5 => +4 (instead of +3; highest applicable)
 * - incidentType in [theft, fire] => +2
 * - suspiciousKeywords in description => +2 (e.g., "cash", "urgent", "no receipt", "lost", "stolen")
 *
 * Cross-claim signals (using the in-memory store):
 * - Duplicate claim id (same claimId previously seen) => +8 (force High by default thresholds)
 * - Repeat claimant across many stored claims:
 *      2-3 prior => +1, 4+ prior => +2
 * - Repeat provider across many stored claims:
 *      2-3 prior => +1, 4+ prior => +2
 * - Repeat location across many stored claims:
 *      2-3 prior => +1, 4+ prior => +2
 *
 * Cross-claim scoring is intended as an additional signal layer and is explained
 * explicitly in the returned explanations.
 */

const SUSPICIOUS_KEYWORDS = [
  'cash',
  'urgent',
  'no receipt',
  'no-receipt',
  'lost',
  'stolen',
  'gift card',
  'giftcard',
  'wire',
];

function addRepetitionScore(kind, priorCount, scoreAndExplain) {
  const { add } = scoreAndExplain;
  // priorCount is the number of existing claims in store that share the same key
  // (claimant/provider/location). We only score when we have at least 2+ occurrences.
  if (!Number.isFinite(priorCount) || priorCount <= 1) return;

  if (priorCount >= 4) {
    add(
      2,
      `Repeated ${kind} pattern: this ${kind} appears in ${priorCount} stored claim(s).`
    );
  } else {
    add(
      1,
      `Repeated ${kind} pattern: this ${kind} appears in ${priorCount} stored claim(s).`
    );
  }
}

// PUBLIC_INTERFACE
function scoreClaim(claim, crossClaimSignals = null) {
  /**
   * Compute risk scoring and explanations for a claim.
   *
   * @param {object} claim
   * @param {object|null} crossClaimSignals - Optional signals derived from the in-memory store.
   * @returns {{
   *   riskLevel: 'High'|'Medium'|'Low',
   *   score: number,
   *   explanations: string[],
   *   fraudSignals: object
   * }}
   */
  let score = 0;
  /** @type {string[]} */
  const explanations = [];

  const add = (points, explanation) => {
    score += points;
    explanations.push(explanation);
  };

  const claimAmount = Number(claim.claimAmount);
  const daysSinceIncident = Number(claim.daysSinceIncident);
  const policyTenureMonths = Number(claim.policyTenureMonths);
  const priorClaimsCount = Number(claim.priorClaimsCount);
  const incidentType = (claim.incidentType || '').toString().trim().toLowerCase();
  const description = (claim.description || '').toString().toLowerCase();

  // ---- Base, single-claim rules ----
  if (!Number.isNaN(claimAmount)) {
    if (claimAmount > 50000) {
      add(6, 'Very high claim amount (> 50,000).');
    } else if (claimAmount >= 10000) {
      add(4, 'High claim amount (>= 10,000).');
    }
  }

  if (!Number.isNaN(daysSinceIncident) && daysSinceIncident > 30) {
    add(2, 'Late filing: more than 30 days since incident.');
  }

  if (!Number.isNaN(policyTenureMonths) && policyTenureMonths < 3) {
    add(2, 'New policy: tenure less than 3 months.');
  }

  if (!Number.isNaN(priorClaimsCount)) {
    if (priorClaimsCount >= 5) {
      add(4, 'Very frequent claimant: 5+ prior claims.');
    } else if (priorClaimsCount >= 3) {
      add(3, 'Frequent claimant: 3+ prior claims.');
    }
  }

  if (incidentType === 'theft' || incidentType === 'fire') {
    add(2, `Higher-risk incident type: ${incidentType}.`);
  }

  const matchedKeywords = SUSPICIOUS_KEYWORDS.filter((kw) =>
    description.includes(kw)
  );
  if (matchedKeywords.length > 0) {
    add(
      2,
      `Suspicious wording in description (${matchedKeywords
        .slice(0, 3)
        .join(', ')}).`
    );
  }

  // ---- Cross-claim signals ----
  const signals = {
    // default values so API shape is consistent
    duplicateClaimIdCount: 0,
    priorClaimantCount: 0,
    priorProviderCount: 0,
    priorLocationCount: 0,
  };

  if (crossClaimSignals && typeof crossClaimSignals === 'object') {
    signals.duplicateClaimIdCount = Number(
      crossClaimSignals.duplicateClaimIdCount || 0
    );
    signals.priorClaimantCount = Number(crossClaimSignals.priorClaimantCount || 0);
    signals.priorProviderCount = Number(crossClaimSignals.priorProviderCount || 0);
    signals.priorLocationCount = Number(crossClaimSignals.priorLocationCount || 0);

    if (signals.duplicateClaimIdCount >= 1) {
      // This indicates the same external claim_id was already uploaded previously.
      // We score it heavily because it's often an error or an attempted duplicate payout.
      add(
        8,
        `Possible duplicate claim: claim_id "${claim.claimId}" already exists in ${signals.duplicateClaimIdCount} stored claim(s).`
      );
    }

    addRepetitionScore('claimant', signals.priorClaimantCount, { add });
    addRepetitionScore('provider', signals.priorProviderCount, { add });
    addRepetitionScore('location', signals.priorLocationCount, { add });
  }

  /** @type {'High'|'Medium'|'Low'} */
  let riskLevel = 'Low';
  if (score >= 8) riskLevel = 'High';
  else if (score >= 4) riskLevel = 'Medium';

  if (explanations.length === 0) {
    explanations.push('No high-risk indicators detected by current rules.');
  }

  return { riskLevel, score, explanations, fraudSignals: signals };
}

module.exports = { scoreClaim };
