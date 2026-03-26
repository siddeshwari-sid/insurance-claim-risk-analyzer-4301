'use strict';

/**
 * Simple in-memory claim store.
 * Note: This is intentionally non-persistent and will reset on server restart.
 */

let _seq = 1;
/** @type {Map<string, any>} */
const _claimsById = new Map();
/** @type {string[]} */
const _claimIds = [];

// PUBLIC_INTERFACE
function reset() {
  /** Reset store (useful for tests / dev). */
  _seq = 1;
  _claimsById.clear();
  _claimIds.length = 0;
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

module.exports = {
  reset,
  createClaim,
  listClaims,
  getClaimById,
};
