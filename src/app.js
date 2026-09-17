require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { logger } = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const apiKeyAuth = require('./middleware/apiKeyAuth');
const apiKeyService = require('./services/apiKeyService').shared;
const providerRoutes = require('./routes/providerRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const intelligenceRoutes = require('./routes/intelligenceRoutes');
const adminRoutes = require('./routes/adminRoutes');

class App {
  constructor() {
    this.app = express();
    this.configureMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  configureMiddleware() {
    // Security headers
    this.app.use(helmet());

    // CORS configuration
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Request parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Compression
    this.app.use(compression());

    // Request logging
    this.app.use((req, res, next) => {
      logger.info({
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      const start = Date.now();
      res.on('finish', () => {
        logger.info({
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${Date.now() - start}ms`
        });
      });

      next();
    });
  }

  setupRoutes() {
    // Package C: writes (and /api/v1/admin) require an API key; GETs stay open.
    this.app.use('/api/v1', apiKeyAuth);

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '1.0.0'
      });
    });

    // API documentation
    this.app.get('/api-docs', (req, res) => {
      res.json({
        name: 'Provider Intelligence Platform API',
        version: '1.0.0',
        description: 'API for accessing NPI Registry and MIPS Quality Reporting data',
        endpoints: {
          '/providers/search': 'Search for healthcare providers',
          '/providers/:npi': 'Get provider details by NPI number',
          '/providers/:npi/mips-performance': 'Get MIPS performance data',
          '/providers/:npi/mips-trends': 'Get MIPS performance trends over time',
          '/quality-measures/:facilityId': 'Get quality measures for a facility',
          '/analytics/group-performance': 'Group MIPS statistics for a set of NPIs',
          '/analytics/ranking/:npi': 'Provider rank/percentile vs peers, optionally by taxonomy',
          '/analytics/trends/:npi': 'Multi-year MIPS scores with trend analysis',
          '/analytics/benchmark/:npi': 'Provider score vs national average and quartiles',
          '/intelligence/cohort': 'Joined providers, latest MIPS, and LEIE verdicts for a state'
        }
      });
    });

    // Provider routes
    this.app.use('/api/v1/providers', providerRoutes);

    // Analytics routes
    this.app.use('/api/v1/analytics', analyticsRoutes);

    // Intelligence routes
    this.app.use('/api/v1/intelligence', intelligenceRoutes);

    // Admin routes (key-protected on every method by apiKeyAuth)
    this.app.use('/api/v1/admin', adminRoutes);
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use(errorHandler);

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    });
  }

  start(port = process.env.PORT || 3000) {
    // Load active api_keys rows into memory; on failure the service keeps
    // serving from the API_KEYS env set.
    apiKeyService.loadFromDatabase();
    const server = this.app.listen(port, () => {
      logger.info(`Server started on port ${port}`);
    });

    return server;
  }
}

// The doc only exports the class; this guard makes `npm start` (`node src/app.js`)
// actually boot the server while leaving `require('./app')` untouched.
if (require.main === module) {
  new App().start();
}

module.exports = App;
