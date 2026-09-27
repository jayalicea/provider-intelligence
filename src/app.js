require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { logger } = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const apiKeyAuth = require('./middleware/apiKeyAuth');
const cacheControl = require('./middleware/cacheControl');
const apiKeyService = require('./services/apiKeyService').shared;
const providerRoutes = require('./routes/providerRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const intelligenceRoutes = require('./routes/intelligenceRoutes');
const adminRoutes = require('./routes/adminRoutes');
const cannabisRoutes = require('./routes/cannabisRoutes');
const cliaRoutes = require('./routes/cliaRoutes');
const facilityRoutes = require('./routes/facilityRoutes');
const { getRefreshStatus } = require('./services/refreshStatusService');

class App {
  constructor() {
    this.app = express();
    this.configureMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  configureMiddleware() {
    // Behind a reverse proxy/load balancer, req.ip (the rate-limiter key) is
    // the proxy's address unless Express trusts X-Forwarded-For. Opt-in via
    // TRUST_PROXY (hop count such as 1, true/false, or an Express trust-proxy
    // string such as 'loopback' or a subnet list): trusting it with no proxy
    // in front would let clients spoof their IP.
    const trustProxy = (process.env.TRUST_PROXY || '').trim();
    if (trustProxy) {
      const lower = trustProxy.toLowerCase();
      const hops = Number(trustProxy);
      let value = trustProxy;
      if (lower === 'true') value = true;
      else if (lower === 'false') value = false;
      else if (Number.isInteger(hops)) value = hops;
      this.app.set('trust proxy', value);
    }

    // Security headers
    this.app.use(helmet());

    // CORS configuration
    // CORS_ORIGIN: '*' (default) or a comma-separated allow-list of origins.
    // '*' is safe here: the API uses no cookies, and cross-origin requests
    // cannot send X-API-Key (it is not in allowedHeaders).
    const corsOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(o => o.trim()).filter(Boolean);
    this.app.use(cors({
      origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Request parsing
    // The largest body is a 1,000-row roster screen (~200 KB).
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Compression
    this.app.use(compression());

    // Request logging: one line per request, written when it completes.
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        logger.info({
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration: `${Date.now() - start}ms`,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      });

      next();
    });
  }

  setupRoutes() {
    // Package C: writes (and /api/v1/admin) require an API key; GETs stay open.
    this.app.use('/api/v1', apiKeyAuth);
    this.app.use('/api/v1', cacheControl());

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.APP_VERSION || '1.0.0'
      });
    });

    // Scheduled data-refresh health: 200 when every job's last run succeeded
    // within its expected interval, 503 otherwise, so an external uptime
    // monitor can alert on missed or failing refreshes.
    this.app.get('/health/data', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const status = await getRefreshStatus();
        res.status(status.healthy ? 200 : 503).json(status);
      } catch (error) {
        logger.error({ message: 'refresh status query failed', error: error.message });
        res.status(503).json({ healthy: false, error: 'Refresh status unavailable' });
      }
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
          '/intelligence/cohort': 'Joined providers, latest MIPS, and LEIE verdicts for a state',
          '/cannabis/summary': 'Per-state cannabis-certification counts (listed vs linked to provider profiles)'
        }
      });
    });

    // Provider routes
    this.app.use('/api/v1/providers', providerRoutes);

    // Cannabis hub routes
    this.app.use('/api/v1/cannabis', cannabisRoutes);
    this.app.use('/api/v1/labs', cliaRoutes);
    this.app.use('/api/v1/facilities', facilityRoutes);

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
    // Hot-reload revoked/issued keys without a restart. There is no server
    // shutdown hook in this app, so stopReloading() is exposed on the
    // service for callers that manage the lifecycle themselves.
    apiKeyService.startReloading();
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
