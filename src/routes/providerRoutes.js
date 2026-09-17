const express = require('express');
const ProviderController = require('../controllers/providerController');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();
const controller = new ProviderController();

// Bind controller methods so `this` is defined when Express invokes them
// (passing `controller.method` as a bare reference loses the receiver).
const bound = (method) => controller[method].bind(controller);

// Apply rate limiting to all routes
router.use(rateLimiter({ windowMs: 60 * 1000, max: 100 })); // 100 requests per minute

// Provider search and retrieval
router.get('/search', bound('searchProviders'));
router.get('/:npi', bound('getProvider'));
router.get('/:npi/verification', bound('getVerification'));

// MIPS Performance data
router.get('/:npi/mips-performance', bound('getMipsPerformance'));
router.get('/:npi/mips-trends', bound('getMipsTrends'));

// Quality measures
router.get('/quality-measures/:facilityId', bound('getQualityMeasures'));

module.exports = router;
