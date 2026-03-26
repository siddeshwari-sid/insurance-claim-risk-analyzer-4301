'use strict';

const { parseClaimsCsv } = require('../services/csvClaims');
const claimsStore = require('../services/claimsStore');
const { scoreClaim } = require('../services/riskScoring');

class ClaimsController {
  // PUBLIC_INTERFACE
  upload(req, res) {
    /**
     * Upload a CSV of claims and store them in memory.
     *
     * Accepts:
     * - Content-Type: text/csv with raw CSV body
     * - Content-Type: application/json with {"csv": "..."}
     *
     * This endpoint applies both single-claim heuristics and cross-claim fraud
     * signals based on the current in-memory store (duplicate claim ids, repeated
     * claimant/provider/location patterns).
     */
    const contentType = (req.headers['content-type'] || '').toLowerCase();

    let csvText = '';
    if (contentType.includes('text/csv')) {
      // Raw text body
      csvText = typeof req.body === 'string' ? req.body : '';
    } else {
      // JSON body
      csvText = req.body && req.body.csv ? String(req.body.csv) : '';
    }

    const parsed = parseClaimsCsv(csvText);
    if (parsed.errors.length > 0 && parsed.claims.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'CSV validation failed.',
        errors: parsed.errors,
        meta: parsed.meta,
      });
    }

    const stored = parsed.claims.map((claim) => {
      // Cross-claim fraud signals must be computed BEFORE inserting this claim,
      // so the claim doesn't count itself.
      const signals = claimsStore.getCrossClaimSignals(claim);
      const scoring = scoreClaim(claim, signals);

      return claimsStore.createClaim({
        ...claim,
        riskLevel: scoring.riskLevel,
        riskScore: scoring.score,
        explanations: scoring.explanations,
        fraudSignals: scoring.fraudSignals,
      });
    });

    return res.status(201).json({
      status: 'ok',
      message: 'Claims uploaded.',
      meta: parsed.meta,
      warnings: parsed.errors, // keep row-level errors as warnings when some rows succeeded
      claims: stored.map((c) => ({
        id: c.id,
        claimId: c.claimId,
        claimAmount: c.claimAmount,
        incidentType: c.incidentType,
        daysSinceIncident: c.daysSinceIncident,
        policyTenureMonths: c.policyTenureMonths,
        priorClaimsCount: c.priorClaimsCount,
        riskLevel: c.riskLevel,

        // Include claimant/provider metadata in summary responses so list UIs
        // (Dashboard/Queue) can render names without calling the detail endpoint.
        claimantName: c.claimantName,
        providerName: c.providerName,
        location: c.location,
        policyNumber: c.policyNumber,

        // Include these in the upload response so the frontend can immediately surface new signals.
        riskScore: c.riskScore,
        explanations: c.explanations,
        fraudSignals: c.fraudSignals,
        createdAt: c.createdAt,
      })),
    });
  }

  // PUBLIC_INTERFACE
  list(req, res) {
    /**
     * List all stored claims with optional filtering.
     * Query params:
     * - risk=High|Medium|Low
     */
    const risk = req.query.risk ? String(req.query.risk) : null;
    const all = claimsStore.listClaims();
    const filtered = risk ? all.filter((c) => c.riskLevel === risk) : all;

    return res.status(200).json({
      status: 'ok',
      total: filtered.length,
      claims: filtered.map((c) => ({
        id: c.id,
        claimId: c.claimId,
        claimAmount: c.claimAmount,
        incidentType: c.incidentType,
        daysSinceIncident: c.daysSinceIncident,
        policyTenureMonths: c.policyTenureMonths,
        priorClaimsCount: c.priorClaimsCount,
        riskLevel: c.riskLevel,
        createdAt: c.createdAt,

        // Critical for rendering claimant correctly in list/table views.
        claimantName: c.claimantName,
        providerName: c.providerName,
        location: c.location,
        policyNumber: c.policyNumber,

        // Provide a short explanation preview for queue display/search.
        explanations: c.explanations,
        fraudSignals: c.fraudSignals,
      })),
    });
  }

  // PUBLIC_INTERFACE
  getById(req, res) {
    /**
     * Get claim details by id.
     */
    const id = String(req.params.id);
    const claim = claimsStore.getClaimById(id);
    if (!claim) {
      return res.status(404).json({
        status: 'error',
        message: 'Claim not found.',
      });
    }

    return res.status(200).json({
      status: 'ok',
      claim,
    });
  }
}

module.exports = new ClaimsController();
