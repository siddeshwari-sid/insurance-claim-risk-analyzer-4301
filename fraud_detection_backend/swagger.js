const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Insurance Claim Risk Analyzer API',
      version: '1.0.0',
      description: 'Backend API for uploading insurance claims via CSV and retrieving rule-based fraud risk scoring.',
    },
    tags: [
      { name: 'Health', description: 'Service health and diagnostics' },
      { name: 'Claims', description: 'Upload and retrieve claims with risk scoring' },
    ],
  },
  apis: ['./src/routes/*.js'], // Path to the API docs
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = swaggerSpec;
