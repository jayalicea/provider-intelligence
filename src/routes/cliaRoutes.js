const express = require('express');
const CliaController = require('../controllers/cliaController');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();
const controller = new CliaController();

// Bind controller methods so `this` is defined when Express invokes them
// (passing `controller.method` as a bare reference loses the receiver).
const bound = (method) => controller[method].bind(controller);

router.use(rateLimiter({ windowMs: 60 * 1000, max: 100 }));

router.get('/search', bound('searchLabs'));
router.get('/:cliaNumber', bound('getLab'));

module.exports = router;
