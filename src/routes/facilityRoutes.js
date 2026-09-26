const express = require('express');
const FacilityController = require('../controllers/facilityController');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();
const controller = new FacilityController();
const bound = (method) => controller[method].bind(controller);

router.use(rateLimiter({ windowMs: 60 * 1000, max: 100 }));

router.get('/search', bound('searchFacilities'));
router.get('/:ccn', bound('getFacility'));

module.exports = router;
