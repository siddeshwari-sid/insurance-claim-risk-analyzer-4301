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
 * Rules (example deterministic heuristics):
 * - claimAmount >= 10000 => +4
 * - claimAmount >= 25000 => +6 (instead of +4; highest applicable)
 * - daysSinceIncident > 30 => +2
 * - policyTenureMonths < 3 => +2
 * - priorClaimsCount >= 3 => +3
 * - priorClaimsCount >= 5 => +4 (instead of +3; highest applicable)
 * - incidentType in [theft, fire] => +2
 * - suspiciousKeywords in description => +2 (e.g., "cash", "urgent", "no receipt", "lost", "stolen")
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

// PUBLIC_INTERFACE
function scoreClaim(claim) {
  /**
   * Compute risk scoring and explanations for a claim.
   * @param {object} claim
   * @returns {{riskLevel: 'High'|'Medium'|'Low', score: number, explanations: string[]}}
   */
  let score = 0;
  /** @type {string[]} */
  const explanations = [];

  const claimAmount = Number(claim.claimAmount);
  const daysSinceIncident = Number(claim.daysSinceIncident);
  const policyTenureMonths = Number(claim.policyTenureMonths);
  const priorClaimsCount = Number(claim.priorClaimsCount);
  const incidentType = (claim.incidentType || '').toString().trim().toLowerCase();
  const description = (claim.description || '').toString().toLowerCase();

  if (!Number.isNaN(claimAmount)) {
    if (claimAmount >= 25000) {
      score += 6;
      explanations.push('Very high claim amount (>= 25,000).');
    } else if (claimAmount >= 10000) {
      score += 4;
      explanations.push('High claim amount (>= 10,000).');
    }
  }

  if (!Number.isNaN(daysSinceIncident) && daysSinceIncident > 30) {
    score += 2;
    explanations.push('Late filing: more than 30 days since incident.');
  }

  if (!Number.isNaN(policyTenureMonths) && policyTenureMonths < 3) {
    score += 2;
    explanations.push('New policy: tenure less than 3 months.');
  }

  if (!Number.isNaN(priorClaimsCount)) {
    if (priorClaimsCount >= 5) {
      score += 4;
      explanations.push('Very frequent claimant: 5+ prior claims.');
    } else if (priorClaimsCount >= 3) {
      score += 3;
      explanations.push('Frequent claimant: 3+ prior claims.');
    }
  }

  if (incidentType === 'theft' || incidentType === 'fire') {
    score += 2;
    explanations.push(`Higher-risk incident type: ${incidentType}.`);
  }

  const matchedKeywords = SUSPICIOUS_KEYWORDS.filter((kw) => description.includes(kw));
  if (matchedKeywords.length > 0) {
    score += 2;
    explanations.push(`Suspicious wording in description (${matchedKeywords.slice(0, 3).join(', ')}).`);
  }

  /** @type {'High'|'Medium'|'Low'} */
  let riskLevel = 'Low';
  if (score >= 8) riskLevel = 'High';
  else if (score >= 4) riskLevel = 'Medium';

  if (explanations.length === 0) {
    explanations.push('No high-risk indicators detected by current rules.');
  }

  return { riskLevel, score, explanations };
}

module.exports = { scoreClaim };
