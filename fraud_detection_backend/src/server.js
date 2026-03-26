const express = require("express");
const cors = require("cors");
const { parse } = require("csv-parse/sync");

/**
 * In-memory claims store. Resets on server restart.
 * Shape of stored claim:
 * {
 *   id: string,
 *   raw: object,         // normalized raw input row
 *   riskScore: number,
 *   riskLevel: "High"|"Medium"|"Low",
 *   explanations: string[]
 * }
 */
const claimsStore = new Map();
let nextId = 1;

const app = express();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

app.use(
  cors({
    origin: CORS_ORIGIN,
  })
);

// Accept JSON bodies for upload variant: { csv: "..." }
app.use(express.json({ limit: "5mb" }));

// Accept raw text/csv uploads
app.use(
  express.text({
    type: ["text/*", "application/csv", "text/csv"],
    limit: "10mb",
  })
);

/**
 * Normalize header keys to a canonical schema, accepting common variants.
 */
function normalizeRow(row) {
  const get = (keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
        return row[k];
      }
    }
    return undefined;
  };

  // Canonical fields used by scoring:
  // claim_amount, incident_type, days_since_incident, policy_tenure_months, prior_claims_count, description
  return {
    claim_amount: get(["claim_amount", "claimAmount", "amount", "Claim Amount", "claimAmountUSD"]),
    incident_type: get(["incident_type", "incidentType", "type", "Incident Type"]),
    days_since_incident: get(["days_since_incident", "daysSinceIncident", "days_late", "Days Since Incident"]),
    policy_tenure_months: get(["policy_tenure_months", "policyTenureMonths", "tenure_months", "Policy Tenure (Months)"]),
    prior_claims_count: get(["prior_claims_count", "priorClaimsCount", "priorClaims", "Prior Claims Count"]),
    description: get(["description", "details", "Description"])
  };
}

/**
 * Parse a value to number with validation.
 */
function parseNumber(value) {
  if (value === undefined) return { ok: false, value: null };
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return { ok: false, value: null };
  return { ok: true, value: n };
}

/**
 * Compute deterministic risk score and explanations.
 */
function scoreClaim(normalized) {
  let score = 0;
  const explanations = [];

  const amountRes = parseNumber(normalized.claim_amount);
  const daysRes = parseNumber(normalized.days_since_incident);
  const tenureRes = parseNumber(normalized.policy_tenure_months);
  const priorRes = parseNumber(normalized.prior_claims_count);

  const incidentType = (normalized.incident_type || "").toString().trim().toLowerCase();
  const description = (normalized.description || "").toString().trim().toLowerCase();

  if (amountRes.ok) {
    if (amountRes.value >= 25000) {
      score += 4;
      explanations.push("High claim amount (>= 25,000).");
    } else if (amountRes.value >= 10000) {
      score += 2;
      explanations.push("Elevated claim amount (>= 10,000).");
    }
  }

  if (daysRes.ok && daysRes.value > 30) {
    score += 2;
    explanations.push("Late filing: more than 30 days since incident.");
  }

  if (tenureRes.ok && tenureRes.value < 3) {
    score += 2;
    explanations.push("New policy: tenure less than 3 months.");
  }

  if (priorRes.ok) {
    if (priorRes.value >= 5) {
      score += 3;
      explanations.push("Frequent claimant: 5+ prior claims.");
    } else if (priorRes.value >= 3) {
      score += 2;
      explanations.push("Frequent claimant: 3+ prior claims.");
    }
  }

  if (incidentType === "theft" || incidentType === "fire") {
    score += 2;
    explanations.push(`Higher-risk incident type: ${incidentType}.`);
  }

  const suspiciousKeywords = ["cash", "urgent", "no receipt", "wire", "lost", "stolen", "immediately", "asap"];
  const matched = suspiciousKeywords.filter((kw) => description.includes(kw));
  if (matched.length > 0) {
    score += 2;
    explanations.push(`Suspicious wording in description (${matched.join(", ")}).`);
  }

  let riskLevel = "Low";
  if (score >= 8) riskLevel = "High";
  else if (score >= 4) riskLevel = "Medium";

  if (explanations.length === 0) {
    explanations.push("No high-risk indicators detected by current rules.");
  }

  return { score, riskLevel, explanations };
}

/**
 * Validate required fields. Returns { ok, errors }.
 */
function validateRow(normalized) {
  const errors = [];

  const amountRes = parseNumber(normalized.claim_amount);
  if (!amountRes.ok) errors.push("claim_amount is required and must be numeric.");

  const incidentType = (normalized.incident_type || "").toString().trim();
  if (!incidentType) errors.push("incident_type is required.");

  const daysRes = parseNumber(normalized.days_since_incident);
  if (!daysRes.ok) errors.push("days_since_incident is required and must be numeric.");

  const tenureRes = parseNumber(normalized.policy_tenure_months);
  if (!tenureRes.ok) errors.push("policy_tenure_months is required and must be numeric.");

  const priorRes = parseNumber(normalized.prior_claims_count);
  if (!priorRes.ok) errors.push("prior_claims_count is required and must be numeric.");

  // description is optional

  return { ok: errors.length === 0, errors };
}

// Health endpoint for readiness checks / container monitors
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "fraud_detection_backend" });
});

/**
 * POST /api/claims/upload
 * Accepts:
 * - Content-Type: text/csv with raw CSV body
 * - Content-Type: application/json with body { csv: "..." }
 */
app.post("/api/claims/upload", (req, res) => {
  let csvText = "";

  if (typeof req.body === "string") {
    csvText = req.body;
  } else if (req.body && typeof req.body.csv === "string") {
    csvText = req.body.csv;
  }

  if (!csvText || !csvText.trim()) {
    return res.status(400).json({ error: "CSV payload is required." });
  }

  let records;
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (e) {
    return res.status(400).json({ error: "Invalid CSV format.", details: String(e && e.message ? e.message : e) });
  }

  const accepted = [];
  const warnings = [];

  records.forEach((row, index) => {
    const normalized = normalizeRow(row);
    const validation = validateRow(normalized);

    if (!validation.ok) {
      warnings.push({
        row: index + 2, // +2 (1-based, plus header row)
        errors: validation.errors,
      });
      return;
    }

    const { score, riskLevel, explanations } = scoreClaim(normalized);

    const id = String(nextId++);
    const stored = {
      id,
      ...normalized,
      riskScore: score,
      riskLevel,
      explanations,
    };

    claimsStore.set(id, stored);
    accepted.push(stored);
  });

  if (accepted.length === 0) {
    return res.status(400).json({ error: "All rows were invalid.", warnings });
  }

  return res.status(201).json({ claims: accepted, warnings });
});

app.get("/api/claims", (req, res) => {
  const claims = Array.from(claimsStore.values());
  res.json({ claims });
});

app.get("/api/claims/:id", (req, res) => {
  const claim = claimsStore.get(String(req.params.id));
  if (!claim) return res.status(404).json({ error: "Claim not found." });
  res.json({ claim });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`fraud_detection_backend listening on port ${PORT}`);
});
