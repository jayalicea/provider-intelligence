const express = require('express');
const AnalyticsController = require('../controllers/analyticsController');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();
const controller = new AnalyticsController();

// Bind controller methods so `this` is defined when Express invokes them
const bound = (method) => controller[method].bind(controller);

// Apply rate limiting to all routes
router.use(rateLimiter({ windowMs: 60 * 1000, max: 100 })); // 100 requests per minute

// Analytics endpoints
router.get('/taxonomy-benchmark', bound('getTaxonomyBenchmark'));
router.get('/group-performance', bound('getGroupPerformance'));
router.get('/ranking/:npi', bound('getRanking'));
router.get('/trends/:npi', bound('getTrends'));
router.get('/benchmark/:npi', bound('getBenchmark'));
router.get('/percentile-trends/:npi', bound('getPercentileTrends'));

module.exports = router;
