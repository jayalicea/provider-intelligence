const express = require('express');
const IntelligenceController = require('../controllers/intelligenceController');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();
const controller = new IntelligenceController();

// Bind controller methods so `this` is defined when Express invokes them
const bound = (method) => controller[method].bind(controller);

// Apply rate limiting to all routes
router.use(rateLimiter({ windowMs: 60 * 1000, max: 100 })); // 100 requests per minute

// Joined intelligence endpoints
router.get('/cohort', bound('getCohort'));
router.get('/exclusion-watchlist', bound('getExclusionWatchlist'));

module.exports = router;
