const cors = require('cors');
const express = require('express');
const routes = require('./routes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../swagger');

// Initialize express app
const app = express();

const allowedOrigins = (() => {
  /**
   * Compute allowed origins for CORS.
   *
   * Priority:
   * 1) ALLOWED_ORIGINS (comma-separated) or "*" to allow all
   * 2) FRONTEND_URL / REACT_APP_FRONTEND_URL (single origin) (legacy)
   * 3) Local dev defaults + Kavia hosted dev defaults
   *
   * IMPORTANT: Never throw from CORS origin callback; for disallowed origins,
   * return `cb(null, false)` so preflight doesn't become HTTP 500 (which browsers
   * surface as "Failed to fetch").
   */
  const env =
    process.env.ALLOWED_ORIGINS ||
    process.env.FRONTEND_URL ||
    process.env.REACT_APP_FRONTEND_URL ||
    '';

  const trimmed = String(env).trim();
  if (trimmed === '*') return '*';

  // If not configured, allow common dev origins and Kavia hosted origins.
  // This prevents "upload works via curl but fails in browser" due to missing
  // Access-Control-Allow-Origin when the frontend is served from a different
  // host/port (e.g., vscode-internal-*.cloud.kavia.ai:3000).
  if (!trimmed) {
    return [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      // Keep scheme+host matching dynamic in origin callback; these are just
      // explicit common cases.
    ];
  }

  // Support comma-separated list
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
})();

function isKaviaHostedOrigin(origin) {
  /**
   * Best-effort allow for Kavia hosted preview environments.
   * Example origin:
   *   https://vscode-internal-XXXXX-beta.beta01.cloud.kavia.ai:3000
   *
   * This is intentionally narrow (specific hostname pattern) to avoid turning
   * CORS into an accidental wildcard in production.
   */
  try {
    const u = new URL(origin);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      /^vscode-internal-.*\.cloud\.kavia\.ai$/i.test(u.hostname)
    );
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, cb) => {
    // Allow server-to-server / curl requests (no origin)
    if (!origin) return cb(null, true);

    // Explicitly configured to allow all.
    if (allowedOrigins === '*') return cb(null, true);

    // Allowed list.
    if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
      return cb(null, true);
    }

    // If not explicitly configured, allow Kavia hosted frontend origins.
    // This fixes browser CSV uploads failing due to blocked CORS.
    if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0) {
      return cb(null, false);
    }

    if (isKaviaHostedOrigin(origin)) return cb(null, true);

    // Disallow without throwing (prevents 500 on preflight).
    return cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

/**
 * IMPORTANT:
 * Browsers send a CORS preflight OPTIONS request for cross-origin requests with
 * non-simple headers (e.g., Content-Type: text/csv). If Express answers OPTIONS
 * without CORS headers, the browser blocks the real request and surfaces it as
 * "Failed to fetch".
 *
 * Explicitly handling OPTIONS with the same cors() middleware guarantees the
 * correct Access-Control-* headers are present for preflight.
 */
app.options('*', cors(corsOptions));
app.set('trust proxy', true);
app.use('/docs', swaggerUi.serve, (req, res, next) => {
  const host = req.get('host');           // may or may not include port
  let protocol = req.protocol;          // http or https

  const actualPort = req.socket.localPort;
  const hasPort = host.includes(':');
  
  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) ||
     (protocol === 'https' && actualPort !== 443));
  const fullHost = needsPort ? `${host}:${actualPort}` : host;
  protocol = req.secure ? 'https' : protocol;

  const dynamicSpec = {
    ...swaggerSpec,
    servers: [
      {
        url: `${protocol}://${fullHost}`,
      },
    ],
  };
  swaggerUi.setup(dynamicSpec)(req, res, next);
});

/**
 * Body parsing:
 * - JSON for most endpoints
 * - text/csv for CSV upload endpoint
 */
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/*', 'text/csv'], limit: '10mb' }));

const openApiRoute = require('./routes/openapi');

// Mount routes
app.use('/', openApiRoute);
app.use('/', routes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Internal Server Error',
  });
});

module.exports = app;
