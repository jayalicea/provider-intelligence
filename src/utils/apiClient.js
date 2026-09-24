const axios = require('axios');
const { logger } = require('./logger');

class ApiClient {
  constructor(config) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout || 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ProviderIntelligencePlatform/1.0'
      }
    });

    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        config.metadata = { startTime: Date.now() };
        return config;
      },
      (error) => {
        logger.error('Request error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        const duration = Date.now() - response.config.metadata.startTime;
        logger.info({
          method: response.config.method,
          url: response.config.url,
          status: response.status,
          duration
        });
        return response;
      },
      (error) => {
        logger.error('Response error:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  async get(endpoint, params = {}) {
    try {
      const response = await this.client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      throw new ApiError(
        `API request failed: ${endpoint}`,
        error.response?.status || 500,
        error.message
      );
    }
  }

  async getWithPagination(endpoint, params = {}, maxPages = 10, delayMs = 100) {
    const allResults = [];
    let page = 0;
    let hasMoreData = true;

    while (hasMoreData && page < maxPages) {
      try {
        const paginatedParams = {
          ...params,
          offset: params.offset || page * (params.size || 100),
          size: params.size || 100
        };

        const response = await this.get(endpoint, paginatedParams);

        // Handle different API response formats
        let results;
        if (response.data) {
          results = Array.isArray(response.data) ? response.data : [response.data];
        } else if (Array.isArray(response)) {
          results = response;
        } else {
          results = [];
        }

        allResults.push(...results);

        // Check if more data available
        hasMoreData = results.length >= (params.size || 100);
        page++;

        // Rate limiting delay (0 in tests)
        await this.delay(delayMs);
      } catch (error) {
        logger.error(`Pagination error at page ${page}:`, error);
        break;
      }
    }

    return allResults;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class ApiError extends Error {
  constructor(message, status = 500, details = '') {
    super(message);
    this.status = status;
    this.details = details;
  }
}

module.exports = { ApiClient, ApiError };
