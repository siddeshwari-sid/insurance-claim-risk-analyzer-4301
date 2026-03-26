const cors = require('cors');
const express = require('express');
const routes = require('./routes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../swagger');

// Initialize express app
const app = express();

const allowedOrigins = (() => {
  const env = process.env.REACT_APP_FRONTEND_URL || process.env.FRONTEND_URL || '';
  // If not configured, allow common dev origins (and still allow non-browser requests with no Origin).
  if (!env) {
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
  }
  // Support comma-separated list
  return env.split(',').map((s) => s.trim()).filter(Boolean);
})();

app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server / curl requests (no origin)
    if (!origin) return cb(null, true);

    // If explicitly configured with "*", allow everything.
    if (allowedOrigins === '*') return cb(null, true);

    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
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
