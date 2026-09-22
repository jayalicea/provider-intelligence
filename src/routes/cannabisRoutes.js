const express = require('express');
const ProviderController = require('../controllers/providerController');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();
const controller = new ProviderController();

// Bind controller methods so `this` is defined when Express invokes them
// (passing `controller.method` as a bare reference loses the receiver).
const bound = (method) => controller[method].bind(controller);

// Same limit as the provider routes these reads complement.
router.use(rateLimiter({ windowMs: 60 * 1000, max: 100 }));

// Cannabis hub: per-state certification summary. Mounted at /api/v1/cannabis
// (the provider router owns /api/v1/providers, so this lives on its own
// top-level path).
router.get('/summary', bound('getCannabisSummary'));

// The registry lists themselves: one row per listed physician, with the
// NPI whenever one is known (enriched rows).
router.get('/physicians', bound('getCannabisPhysicians'));

module.exports = router;
