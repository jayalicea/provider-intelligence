const express = require('express');
const AdminController = require('../controllers/adminController');

const router = express.Router();
const controller = new AdminController();
const bound = method => controller[method].bind(controller);

router.get('/usage', bound('getUsage'));

module.exports = router;
