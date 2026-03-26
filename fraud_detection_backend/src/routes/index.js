const express = require('express');
const healthController = require('../controllers/health');
const claimsController = require('../controllers/claims');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     ClaimSummary:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Server-generated claim identifier (in-memory).
 *           example: "1"
 *         claimId:
 *           type: string
 *           description: Original claim identifier from CSV.
 *           example: "CLM-10001"
 *         claimAmount:
 *           type: number
 *           example: 12500
 *         incidentType:
 *           type: string
 *           example: theft
 *         daysSinceIncident:
 *           type: number
 *           example: 45
 *         policyTenureMonths:
 *           type: number
 *           example: 2
 *         priorClaimsCount:
 *           type: number
 *           example: 3
 *         riskLevel:
 *           type: string
 *           enum: [High, Medium, Low]
 *           example: High
 *         createdAt:
 *           type: string
 *           format: date-time
 *     Claim:
 *       allOf:
 *         - $ref: '#/components/schemas/ClaimSummary'
 *         - type: object
 *           properties:
 *             description:
 *               type: string
 *             riskScore:
 *               type: number
 *               description: Numeric score used to derive risk level.
 *               example: 9
 *             explanations:
 *               type: array
 *               items:
 *                 type: string
 *               example:
 *                 - "Very high claim amount (>= 25,000)."
 *                 - "Late filing: more than 30 days since incident."
 */

/**
 * @swagger
 * /:
 *   get:
 *     summary: Health endpoint
 *     responses:
 *       200:
 *         description: Service health check passed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: Service is healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 environment:
 *                   type: string
 *                   example: development
 */
router.get('/', healthController.check.bind(healthController));

/**
 * @swagger
 * /api/claims/upload:
 *   post:
 *     summary: Upload claims CSV, validate, score risk, and store in memory
 *     description: |
 *       Accepts either:
 *       - Content-Type text/csv with the raw CSV text as request body
 *       - Content-Type application/json with payload {"csv": "..."}
 *     requestBody:
 *       required: true
 *       content:
 *         text/csv:
 *           schema:
 *             type: string
 *           example: |
 *             claim_id,claim_amount,incident_type,days_since_incident,policy_tenure_months,prior_claims_count,description
 *             CLM-1,25000,theft,45,2,3,"urgent cash needed, no receipt"
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               csv:
 *                 type: string
 *             required: [csv]
 *     responses:
 *       201:
 *         description: Claims uploaded (some rows may be rejected and returned in warnings)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 message: { type: string }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     rows: { type: number }
 *                     accepted: { type: number }
 *                     rejected: { type: number }
 *                 warnings:
 *                   type: array
 *                   items: { type: string }
 *                 claims:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ClaimSummary'
 *       400:
 *         description: CSV validation failed (no rows accepted)
 */
router.post('/api/claims/upload', claimsController.upload.bind(claimsController));

/**
 * @swagger
 * /api/claims:
 *   get:
 *     summary: List stored claims
 *     parameters:
 *       - in: query
 *         name: risk
 *         schema:
 *           type: string
 *           enum: [High, Medium, Low]
 *         description: Optional risk level filter.
 *     responses:
 *       200:
 *         description: List of claims
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 total: { type: number }
 *                 claims:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ClaimSummary'
 */
router.get('/api/claims', claimsController.list.bind(claimsController));

/**
 * @swagger
 * /api/claims/{id}:
 *   get:
 *     summary: Get claim details by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Claim detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 claim:
 *                   $ref: '#/components/schemas/Claim'
 *       404:
 *         description: Claim not found
 */
router.get('/api/claims/:id', claimsController.getById.bind(claimsController));

module.exports = router;
