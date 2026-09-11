require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { logger } = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const providerRoutes = require('./routes/providerRoutes');

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
          '/bulk-data': 'Bulk provider and MIPS data retrieval'
        }
      });
    });

    // Provider routes
    this.app.use('/api/v1/providers', providerRoutes);
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
