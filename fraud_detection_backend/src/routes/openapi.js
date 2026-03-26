'use strict';

const express = require('express');
const swaggerSpec = require('../../swagger');

const router = express.Router();

// PUBLIC_INTERFACE
router.get('/openapi.json', (req, res) => {
  /** Serve OpenAPI spec JSON. */
  res.status(200).json(swaggerSpec);
});

module.exports = router;
