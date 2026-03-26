# Insurance Claim Risk Analyzer (Backend Workspace)

This workspace contains the **Express backend** for the Insurance Claim Risk Analyzer application.

For the full end-to-end working flow (login → upload CSV → dashboard/queue/detail), configuration notes, and seed CSV usage, see:

- `../insurance-claim-risk-analyzer-4302/README.md`

## Backend responsibilities

The backend:

- Accepts claim CSV uploads and validates rows
- Computes deterministic, rule-based risk scoring (risk score + risk level)
- Computes cross-claim fraud signals using an in-memory store
- Stores claims in memory (non-persistent)
- Exposes REST APIs for upload, listing, and detail retrieval
- Serves OpenAPI JSON and Swagger UI

## Key paths

- API routes: `fraud_detection_backend/src/routes/index.js`
- CSV parsing and validation: `fraud_detection_backend/src/services/csvClaims.js`
- Risk scoring rules: `fraud_detection_backend/src/services/riskScoring.js`
- In-memory store + cross-claim signal indexes: `fraud_detection_backend/src/services/claimsStore.js`

## Running

From `fraud_detection_backend`:

```bash
npm install
npm run dev
```

Environment variables commonly used:

- `PORT` (default: 3000)
- `HOST` (default: 0.0.0.0)
- `ALLOWED_ORIGINS` (comma-separated list or `*`)
- `FRONTEND_URL` (legacy single origin)
