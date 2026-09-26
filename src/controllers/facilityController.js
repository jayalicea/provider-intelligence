const FacilityService = require('../services/facilityService');
const { logger } = require('../utils/logger');

class FacilityController {
  constructor() {
    this.facilityService = new FacilityService();
  }

  async searchFacilities(req, res) {
    try {
      const { name, state, type, city } = req.query;
      if (state !== undefined && !/^[A-Za-z]{2}$/.test(state)) {
        return res.status(400).json({ success: false, error: 'state must be a two-letter code' });
      }
      if (!name && !state && !type && !city) {
        return res.status(400).json({
          success: false,
          error: 'At least one search criterion is required (name, state, type, or city)'
        });
      }
      const { rows, total } = await this.facilityService.searchFacilities({
        name, state, type, city, limit: req.query.limit, offset: req.query.offset
      });
      res.json({ success: true, data: rows, count: rows.length, total });
    } catch (error) {
      logger.error('Error in searchFacilities:', error);
      res.status(500).json({ success: false, error: 'Failed to search facilities' });
    }
  }

  async getFacility(req, res) {
    try {
      const { ccn } = req.params;
      if (!this.facilityService.validateCcnFormat(ccn)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid CCN format (6-digit CMS prefix plus alphanumeric suffix)'
        });
      }
      const facility = await this.facilityService.getFacilityByCcn(ccn.toUpperCase());
      if (!facility) {
        return res.status(404).json({ success: false, error: 'Facility not found' });
      }
      res.json({ success: true, data: facility });
    } catch (error) {
      logger.error('Error in getFacility:', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve facility' });
    }
  }
}

module.exports = FacilityController;
