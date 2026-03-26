'use strict';

/**
 * Simple in-memory claim store.
 * Note: This is intentionally non-persistent and will reset on server restart.
 *
 * This store also maintains lightweight indexes so we can compute cross-claim
 * fraud signals (duplicates / repeats) at scoring time without a database.
 */

let _seq = 1;
/** @type {Map<string, any>} */
const _claimsById = new Map();
/** @type {string[]} */
const _claimIds = [];

/**
 * Cross-claim indexes:
 * - claimId => [internalIds...]
 * - claimant => [internalIds...]
 * - provider => [internalIds...]
 * - location => [internalIds...]
 *
 * These indexes let us detect:
 * - duplicate claims (same CSV claim_id) already in store
 * - repeated claimant/provider/location patterns across many claims
 */
/** @type {Map<string, string[]>} */
const _idsByClaimId = new Map();
/** @type {Map<string, string[]>} */
const _idsByClaimant = new Map();
/** @type {Map<string, string[]>} */
const _idsByProvider = new Map();
/** @type {Map<string, string[]>} */
const _idsByLocation = new Map();

function normalizeKey(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function pushIndex(map, key, id) {
  if (!key) return;
  const arr = map.get(key) || [];
  arr.push(id);
  map.set(key, arr);
}

// PUBLIC_INTERFACE
function reset() {
  /** Reset store (useful for tests / dev). */
  _seq = 1;
  _claimsById.clear();
  _claimIds.length = 0;

  _idsByClaimId.clear();
  _idsByClaimant.clear();
  _idsByProvider.clear();
  _idsByLocation.clear();
}

// PUBLIC_INTERFACE
function createClaim(claim) {
  /**
   * Create and store a claim.
   * @param {object} claim - Claim object to store
   * @returns {object} Stored claim with id and createdAt
   */
  const id = String(_seq++);
  const stored = {
    ...claim,
    id,
    createdAt: new Date().toISOString(),
  };

  _claimsById.set(id, stored);
  _claimIds.push(id);

  // Update indexes for cross-claim fraud checks.
  pushIndex(_idsByClaimId, normalizeKey(stored.claimId), id);

  // We support multiple possible field names (CSV may evolve). These are optional.
  const claimantKey = normalizeKey(
    stored.claimantId || stored.claimant || stored.claimantName
  );
  const providerKey = normalizeKey(
    stored.providerId || stored.provider || stored.providerName
  );

  // Location can be expressed in different forms; we intentionally keep it simple.
  const locationKey = normalizeKey(
    stored.location ||
      stored.incidentLocation ||
      stored.lossLocation ||
      stored.address ||
      stored.zip ||
      stored.postalCode
  );

  pushIndex(_idsByClaimant, claimantKey, id);
  pushIndex(_idsByProvider, providerKey, id);
  pushIndex(_idsByLocation, locationKey, id);

  return stored;
}

// PUBLIC_INTERFACE
function listClaims() {
  /**
   * List claims in insertion order.
   * @returns {object[]} list
   */
  return _claimIds.map((id) => _claimsById.get(id)).filter(Boolean);
}

// PUBLIC_INTERFACE
function getClaimById(id) {
  /**
   * Get a claim by id.
   * @param {string} id
   * @returns {object|null}
   */
  return _claimsById.get(String(id)) || null;
}

/**
 * Compute lightweight cross-claim fraud signals for a would-be new claim.
 * This does not require the claim to already exist in the store.
 *
 * The caller is responsible for passing in a "candidate" claim object
 * using the same shape as createClaim().
 */

// PUBLIC_INTERFACE
function getCrossClaimSignals(candidateClaim) {
  /**
   * Return cross-claim signals derived from the current in-memory store.
   *
   * @param {object} candidateClaim
   * @returns {{
   *   duplicateClaimIdCount: number,
   *   priorClaimantCount: number,
   *   priorProviderCount: number,
   *   priorLocationCount: number
   * }}
   */
  const claimIdKey = normalizeKey(candidateClaim?.claimId);
  const claimantKey = normalizeKey(
    candidateClaim?.claimantId ||
      candidateClaim?.claimant ||
      candidateClaim?.claimantName
  );
  const providerKey = normalizeKey(
    candidateClaim?.providerId ||
      candidateClaim?.provider ||
      candidateClaim?.providerName
  );
  const locationKey = normalizeKey(
    candidateClaim?.location ||
      candidateClaim?.incidentLocation ||
      candidateClaim?.lossLocation ||
      candidateClaim?.address ||
      candidateClaim?.zip ||
      candidateClaim?.postalCode
  );

  const duplicateClaimIdCount = claimIdKey
    ? (_idsByClaimId.get(claimIdKey) || []).length
    : 0;

  const priorClaimantCount = claimantKey
    ? (_idsByClaimant.get(claimantKey) || []).length
    : 0;

  const priorProviderCount = providerKey
    ? (_idsByProvider.get(providerKey) || []).length
    : 0;

  const priorLocationCount = locationKey
    ? (_idsByLocation.get(locationKey) || []).length
    : 0;

  return {
    duplicateClaimIdCount,
    priorClaimantCount,
    priorProviderCount,
    priorLocationCount,
  };
}

module.exports = {
  reset,
  createClaim,
  listClaims,
  getClaimById,
  getCrossClaimSignals,
};
