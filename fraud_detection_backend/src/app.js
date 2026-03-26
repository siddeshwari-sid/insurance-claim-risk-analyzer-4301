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
   * 2) FRONTEND_URL (single origin) (legacy)
   * 3) Local dev defaults
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

  // If not configured, allow common dev origins (and still allow non-browser requests with no Origin).
  if (!trimmed) {
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }

  // Support comma-separated list
  return trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
})();

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow server-to-server / curl requests (no origin)
      if (!origin) return cb(null, true);

      // Explicitly configured to allow all.
      if (allowedOrigins === '*') return cb(null, true);

      // Allowed list.
      if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
        return cb(null, true);
      }

      // Disallow without throwing (prevents 500 on preflight).
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
  })
);
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
