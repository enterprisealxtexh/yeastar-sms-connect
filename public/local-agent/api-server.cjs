/**
 * Local API Server for TG400 SMS Gateway
 * Serves SMS data from SQLite database to the web frontend
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const compression = require('compression');
const { execSync } = require('child_process');
const SharedDatabase = require('./shared-db.cjs');
const TG400TcpApi = require('./tg400-tcp-api.cjs');

const logger = require('./logger.cjs');
logger.info('[API Server] Using shared database singleton to prevent concurrent access issues');

const app = express();
const PORT = process.env.API_PORT || 2003;
const HOST = process.env.API_HOST || '0.0.0.0';

// Performance Optimization: Request timing and caching
const requestTimings = new Map();
const responseCache = new Map();
const CACHE_TTL = 2000; // 2 second cache for frequently accessed endpoints

// Middleware - Order matters: compression first for performance
app.use(compression({ level: 6 })); // gzip compression with level 6
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 200
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Request timing middleware for performance monitoring
app.use((req, res, next) => {
  req.startTime = Date.now();
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - req.startTime;
    res.setHeader('X-Response-Time', `${duration}ms`);
    if (duration > 1000) {
      logger.warn(`[Slow API] ${req.method} ${req.path} took ${duration}ms`);
    }
    return originalJson.call(this, data);
  };
  next();
});

// HTTP Caching middleware for GET requests
app.use((req, res, next) => {
  // Set default cache headers for GET requests
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, max-age=2');
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

// Robust logging for uncaught errors so we can investigate crashes
function logErrorToFile(err) {
  try {
    const payload = err && err.stack ? err.stack : String(err);
    logger.error(payload);
  } catch (e) {
    // fallback
    console.error('Failed to write to error log:', e && e.message ? e.message : e);
  }
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception: %s', err && err.stack ? err.stack : err);
  logErrorToFile(err);
  // Do NOT exit immediately — try to keep the agent alive for debugging
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection: %s', reason && reason.stack ? reason.stack : reason);
  logErrorToFile(reason);
});

// Initialize database using shared singleton
const dbPath = process.env.SMS_DB_PATH || path.join(__dirname, 'sms.db');
const db = SharedDatabase.getInstance(dbPath);

if (!db) {
  console.error('Failed to initialize database. Exiting.');
  process.exit(1);
}

// ========================================
// Yeastar PBX HTTPS API Integration
// ========================================

class YeastarPBXAPI {
  constructor() {
    this.token = null;
    this.tokenTimeout = null;
  }

  // Generate MD5 hash for password
  md5Hash(text) {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  // Make HTTPS request to PBX
  async makeRequest(method, endpoint, data = null) {
    const config = db.getPbxConfig();
    if (!config || !config.pbx_ip) {
      throw new Error('PBX not configured');
    }

    return new Promise((resolve, reject) => {
      const options = {
        hostname: config.pbx_ip,
        port: parseInt(config.pbx_port) || 8088,
        path: endpoint,
        method: method,
        rejectUnauthorized: false, // Accept self-signed certificates
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'YeastarConnector/1.0'
        }
      };

      if (data) {
        const postData = JSON.stringify(data);
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${responseData}`));
          }
        });
      });

      req.on('error', (error) => reject(error));
      req.on('timeout', () => reject(new Error('Request timeout')));
      req.setTimeout(10000);

      if (data) {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  // Authenticate and get token (using v1.1.0 API)
  async authenticate() {
    const config = db.getPbxConfig();
    if (!config) throw new Error('PBX not configured');

    const passwordHash = this.md5Hash(config.api_password);
    
    logger.info(`Authenticating with PBX: ${config.pbx_ip}:${config.pbx_port}`);
    
    // S-Series v1.1.0 requires port number where the app server listens for callbacks
    const response = await this.makeRequest('POST', '/api/v1.1.0/login', {
      username: config.api_username,
      password: passwordHash,
      port: '8260',  // Default port for API callbacks (not required for query-only operations)
      version: '1.0.2'  // Request well-formed JSON format
    });

    if (response.status === 'Success' && response.token) {
      this.token = response.token;
      // Clear any existing timeout
      if (this.tokenTimeout) clearTimeout(this.tokenTimeout);
      // Set token to refresh after 25 minutes (token expires after 30 minutes)
      this.tokenTimeout = setTimeout(() => {
        this.token = null;
      }, 25 * 60 * 1000);
      
      logger.info(`PBX Authentication successful, token: ${this.token.substr(0, 8)}...`);
      return this.token;
    } else {
      logger.error(`Authentication failed response:`, response);
      throw new Error(`Authentication failed: ${response.errno || response.errmsg || 'Unknown error'}`);
    }
  }

  // Get valid token (authenticate if needed)
  async getToken() {
    if (!this.token) {
      await this.authenticate();
    }
    return this.token;
  }

  // Test PBX connection
  async testConnection() {
    try {
      const token = await this.getToken();
      return { success: true, token: token.substr(0, 8) + '...', status: 'Connected' };
    } catch (error) {
      return { success: false, error: error.message, status: 'Failed' };
    }
  }

  // Query active calls
  async queryCalls() {
    const token = await this.getToken();
    // Try v2.0.0 API first, fallback to v1.0.0
    try {
      const response = await this.makeRequest('GET', `/api/v2.0.0/call/query?token=${token}`);
      return response;
    } catch (error) {
      // Fallback to v1.0.0 with access_token parameter
      const response = await this.makeRequest('GET', `/api/v1.0.0/call/query?access_token=${token}`);
      return response;
    }
  }

  // Query Call Detail Records (CDR) for historical data
  async queryCDR(startTime = null, endTime = null, limit = 100) {
    const token = await this.getToken();
    
    // Default to last 24 hours if no time specified
    if (!startTime) {
      startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }
    if (!endTime) {
      endTime = new Date().toISOString().split('T')[0];
    }

    const params = new URLSearchParams({
      access_token: token,
      starttime: startTime,
      endtime: endTime,
      limit: limit.toString()
    });

    try {
      // Try different CDR endpoints
      const endpoints = [
        `/api/v1.0.0/cdr/get?${params}`,
        `/api/v2.0.0/cdr/query?token=${token}&starttime=${startTime}&endtime=${endTime}&limit=${limit}`,
        `/api/v1.0.0/recording/get?${params}`
      ];

      for (const endpoint of endpoints) {
        try {
          logger.info(`Querying CDR: ${endpoint}`);
          const response = await this.makeRequest('GET', endpoint);
          if (response.status === 'Success' || response.errcode === 0) {
            return response;
          }
        } catch (error) {
          logger.debug(`CDR endpoint failed: ${endpoint} - ${error.message}`);
        }
      }
      
      // If all endpoints fail, return empty response
      return { status: 'Success', data: [] };
    } catch (error) {
      logger.error(`CDR Query Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Test different API endpoints to find working ones
  async discoverEndpoints() {
    const token = await this.getToken();
    const testEndpoints = [
      // System information endpoints
      { url: '/api/v1.0.0/system/info', version: 'v1.0.0', type: 'system' },
      { url: '/api/v2.0.0/system/info', version: 'v2.0.0', type: 'system' },
      
      // Call management endpoints  
      { url: '/api/v1.0.0/call/query', version: 'v1.0.0', type: 'call' },
      { url: '/api/v2.0.0/call/query', version: 'v2.0.0', type: 'call' },
      
      // CDR/Recording endpoints
      { url: '/api/v1.0.0/cdr/get', version: 'v1.0.0', type: 'cdr' },
      { url: '/api/v2.0.0/cdr/query', version: 'v2.0.0', type: 'cdr' },
      { url: '/api/v1.0.0/recording/get', version: 'v1.0.0', type: 'recording' },
      
      // Extension endpoints
      { url: '/api/v1.0.0/extension/query', version: 'v1.0.0', type: 'extension' },
      { url: '/api/v2.0.0/extension/query', version: 'v2.0.0', type: 'extension' },
      
      // Trunk endpoints
      { url: '/api/v1.0.0/trunk/query', version: 'v1.0.0', type: 'trunk' },
      { url: '/api/v2.0.0/trunk/query', version: 'v2.0.0', type: 'trunk' }
    ];

    const results = [];
    
    for (const endpoint of testEndpoints) {
      try {
        const isV2 = endpoint.version === 'v2.0.0';
        const url = isV2 ? `${endpoint.url}?token=${token}` : `${endpoint.url}?access_token=${token}`;
        
        logger.info(`🧪 Testing endpoint: ${url}`);
        const response = await this.makeRequest('GET', url);
        
        const success = (response.status === 'Success') || (response.errcode === 0);
        const hasData = response.data && (Array.isArray(response.data) ? response.data.length > 0 : Object.keys(response.data).length > 0);
        
        results.push({
          endpoint: endpoint.url,
          version: endpoint.version,
          type: endpoint.type,
          status: success ? 'working' : 'error',
          error: response.errno || response.errcode || null,
          hasData: hasData,
          dataCount: Array.isArray(response.data) ? response.data.length : (response.data ? 1 : 0),
          response: success && hasData ? response : null
        });
        
        if (success) {
          logger.info(` ${endpoint.url} - Working! Data: ${hasData ? 'Yes' : 'No'}`);
        } else {
          logger.debug(` ${endpoint.url} - Error: ${response.errno || response.errcode}`);
        }
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        results.push({
          endpoint: endpoint.url,
          version: endpoint.version,
          type: endpoint.type,
          status: 'failed',
          error: error.message,
          hasData: false
        });
        logger.debug(` ${endpoint.url} - Failed: ${error.message}`);
      }
    }
    
    return results;
  }

  // Get real system information from PBX
  async getSystemInfo() {
    const token = await this.getToken();
    
    // Try both API versions
    const endpoints = [
      `/api/v2.0.0/system/info?token=${token}`,
      `/api/v1.0.0/system/info?access_token=${token}`
    ];
    
    for (const endpoint of endpoints) {
      try {
        const response = await this.makeRequest('GET', endpoint);
        if (response.status === 'Success' || response.errcode === 0) {
          return response;
        }
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('No working system info endpoint found');
  }

  // Get extensions list from PBX
  async getExtensions() {
    const token = await this.getToken();
    
    // We know from testing that only v1.0.0 endpoint works
    const endpoint = `/api/v1.0.0/extension/query?access_token=${token}`;
    
    try {
      const response = await this.makeRequest('GET', endpoint);
      logger.info(`📞 Extensions API Response: ${JSON.stringify(response).substring(0, 200)}...`);
      
      if (response.status === 'Success' && response.extinfos) {
        return response;
      } else {
        logger.error(` Extensions API failed: ${response.errmsg || 'Unknown error'}`);
        return { status: 'Failed', error: response.errmsg || 'Extensions query failed' };
      }
    } catch (error) {
      logger.error(` Extensions API Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Make an outbound call (dial_outbound for external numbers, dial_extension for internal)
  async dialCall(caller, callee, autoanswer = 'no') {
    const token = await this.getToken();
    
    try {
      logger.info(`📞 Dialing: caller=${caller}, callee=${callee}`);
      
      // Check if callee is an extension (numeric and 4-5 digits) or external number
      const isExtension = /^\d{4,5}$/.test(String(callee));
      
      if (isExtension) {
        // Internal call between extensions
        const response = await this.makeRequest('POST', `/api/v1.1.0/extension/dial_extension?token=${token}`, {
          caller: String(caller),
          callee: String(callee),
          autoanswer: autoanswer
        });
        
        if (response.status === 'Success' || response.callid) {
          logger.info(` Internal call initiated successfully. Call ID: ${response.callid}`);
          return { status: 'Success', ...response };
        } else {
          logger.error(` Dial failed: ${response.errno || response.errmsg || 'Unknown error'}`);
          return response;
        }
      } else {
        // External call to outside number
        const response = await this.makeRequest('POST', `/api/v1.1.0/extension/dial_outbound?token=${token}`, {
          extid: String(caller),
          outto: String(callee),
          autoanswer: autoanswer
        });
        
        if (response.status === 'Success' || response.callid) {
          logger.info(` Outbound call initiated successfully. Call ID: ${response.callid}`);
          return { status: 'Success', ...response };
        } else {
          logger.error(` Dial failed: ${response.errno || response.errmsg || 'Unknown error'}`);
          return response;
        }
      }
    } catch (error) {
      logger.error(` Dial Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Hang up a call (extension/hangup) - only needs the extension ID
  async hangupCall(extid) {
    const token = await this.getToken();
    
    try {
      logger.info(`📞 Hanging up call for extension: ${extid}`);
      
      // Use the correct v1.1.0 API endpoint
      const response = await this.makeRequest('POST', `/api/v1.1.0/extension/hangup?token=${token}`, {
        extid: String(extid)
      });
      
      if (response.status === 'Success') {
        logger.info(` Call hung up successfully for extension ${extid}`);
        return { status: 'Success', ...response };
      } else {
        logger.error(` Hangup failed: ${response.errno || response.errmsg || 'Unknown error'}`);
        return response;
      }
    } catch (error) {
      logger.error(` Hangup Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Query active calls by type (inbound/outbound) or specific call ID
  async queryCallsAdvanced(type = null, callid = null) {
    const token = await this.getToken();
    
    try {
      logger.info(`📞 Querying calls: type=${type}, callid=${callid}`);
      
      let endpoint = 'inbound/query'; // default to inbound
      
      // Determine which endpoint to use
      if (type === 'outbound') {
        endpoint = 'outbound/query';
      } else if (type === 'inbound') {
        endpoint = 'inbound/query';
      }
      
      // Build request body
      const requestBody = {};
      if (callid) {
        requestBody.callid = callid;
      }
      
      // Use the correct v1.1.0 API endpoint (inbound/query or outbound/query)
      const response = await this.makeRequest('POST', `/api/v1.1.0/${endpoint}?token=${token}`, requestBody);
      
      if (response.status === 'Success' || response.Calls) {
        logger.info(` Calls queried successfully. Found ${response.Calls ? response.Calls.length : 0} calls`);
        return { status: 'Success', ...response };
      } else {
        logger.error(` Query failed: ${response.errno || response.errmsg || 'Unknown error'}`);
        return response;
      }
    } catch (error) {
      logger.error(` Query Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Query inbound calls (current active calls coming from external numbers)
  async queryInboundCalls(inboundid = null) {
    const token = await this.getToken();
    
    try {
      logger.info(`📞 Querying inbound calls${inboundid ? ` for ID: ${inboundid}` : ''}`);
      
      const requestBody = {};
      if (inboundid) {
        requestBody.inboundid = inboundid;
      }
      
      const response = await this.makeRequest('POST', `/api/v1.1.0/inbound/query?token=${token}`, requestBody);
      
      if (response.status === 'Success') {
        logger.info(`Inbound calls queried. Total: ${response.inbound ? response.inbound.length : 0}`);
        return {
          status: 'Success',
          inbound: response.inbound || [],
          totalCalls: response.inbound ? response.inbound.length : 0
        };
      } else {
        logger.warn(`Inbound query returned: ${response.errno || response.errmsg || 'No data'}`);
        return {
          status: 'Success',
          inbound: [],
          totalCalls: 0,
          message: 'No active inbound calls'
        };
      }
    } catch (error) {
      logger.error(` Inbound Query Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Query outbound calls (current active calls going to external numbers)
  async queryOutboundCalls(outboundid = null) {
    const token = await this.getToken();
    
    try {
      logger.info(`📞 Querying outbound calls${outboundid ? ` for ID: ${outboundid}` : ''}`);
      
      const requestBody = {};
      if (outboundid) {
        requestBody.outboundid = outboundid;
      }
      
      const response = await this.makeRequest('POST', `/api/v1.1.0/outbound/query?token=${token}`, requestBody);
      
      if (response.status === 'Success') {
        logger.info(`Outbound calls queried. Total: ${response.outbound ? response.outbound.length : 0}`);
        return {
          status: 'Success',
          outbound: response.outbound || [],
          totalCalls: response.outbound ? response.outbound.length : 0
        };
      } else {
        logger.warn(`Outbound query returned: ${response.errno || response.errmsg || 'No data'}`);
        return {
          status: 'Success',
          outbound: [],
          totalCalls: 0,
          message: 'No active outbound calls'
        };
      }
    } catch (error) {
      logger.error(`Outbound Query Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Query all extensions and their status
  async queryExtensions() {
    const token = await this.getToken();
    
    try {
      logger.info(`Querying all extensions from PBX`);
      
      const response = await this.makeRequest('POST', `/api/v1.1.0/extensionlist/query?token=${token}`, {});
      
      if (response.status === 'Success' && Array.isArray(response.extlist)) {
        logger.info(` Extensions queried. Total: ${response.extlist.length}`);
        return {
          status: 'Success',
          extensions: response.extlist,
          totalExtensions: response.extlist.length
        };
      } else if (response.extlist && Array.isArray(response.extlist)) {
        // Sometimes it returns list without explicit status
        logger.info(` Extensions queried. Total: ${response.extlist.length}`);
        return {
          status: 'Success',
          extensions: response.extlist,
          totalExtensions: response.extlist.length
        };
      } else {
        logger.warn(` Extensions query returned: ${JSON.stringify(response).substring(0, 100)}`);
        return {
          status: 'Failed',
          error: response.errno || response.errmsg || 'Failed to query extensions',
          extensions: [],
          totalExtensions: 0
        };
      }
    } catch (error) {
      logger.error(` PBX Info Query Error: ${error.message}`);
      return { status: 'Failed', error: error.message, extensions: [], totalExtensions: 0 };
    }
  }

  // Query PBX device information
  async queryPBXInfo() {
    const token = await this.getToken();
    
    try {
      logger.info(` Querying PBX device information`);
      
      const response = await this.makeRequest('POST', `/api/v1.1.0/deviceinfo/query?token=${token}`, {});
      
      if (response.status === 'Success' && response.deviceinfo) {
        logger.info(` PBX Info: ${response.deviceinfo.devicename} - Firmware: ${response.deviceinfo.firmwarever}`);
        return {
          status: 'Success',
          deviceinfo: response.deviceinfo
        };
      } else {
        logger.warn(` Device info query returned: ${response.errno || response.errmsg || 'No data'}`);
        return {
          status: 'Failed',
          error: response.errno || response.errmsg || 'Failed to query device info'
        };
      }
    } catch (error) {
      logger.error(` PBX Info Query Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Get CDR file download random token
  async getCDRRandom(extid = 'all', starttime, endtime) {
    const token = await this.getToken();
    
    try {
      logger.debug(`Requesting CDR random token for: extid=${extid}, starttime=${starttime}, endtime=${endtime}`);
      
      const response = await this.makeRequest('POST', `/api/v1.1.0/cdr/get_random?token=${token}`, {
        extid: String(extid),
        starttime: starttime,
        endtime: endtime
      });
      
      if (response.status === 'Success' && response.random) {
        logger.info(`CDR random token obtained`);
        return { 
          status: 'Success',
          extid: response.extid || extid,
          starttime: response.starttime || starttime,
          endtime: response.endtime || endtime,
          random: response.random,
          token: token
        };
      } else {
        const errCode = response.errno || response.errmsg || 'Unknown error';
        logger.warn(` CDR random failed: ${errCode} (This may indicate PBX permissions issue)`);
        return { status: 'Failed', error: errCode };
      }
    } catch (error) {
      logger.debug(` CDR Random error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Download CDR data using random token (v1.1.0 two-step process)
  async downloadCDRData(extid = 'all', starttime, endtime) {
    const token = await this.getToken();
    const config = db.getPbxConfig();
    
    if (!config || !config.pbx_ip) {
      throw new Error('PBX not configured');
    }
    
    try {
      logger.info(`Downloading CDR: extid=${extid}, starttime=${starttime}, endtime=${endtime}`);
      
      // Step 1: Get random token
      const randomResponse = await this.getCDRRandom(extid, starttime, endtime);
      if (randomResponse.status !== 'Success' || !randomResponse.random) {
        throw new Error(`Failed to get CDR random token: ${randomResponse.error}`);
      }
      
      const randomToken = randomResponse.random;
      
      // Step 2: Build download URL and fetch the file
      const downloadUrl = `https://${config.pbx_ip}:${parseInt(config.pbx_port) || 8088}/api/v1.1.0/cdr/download?` +
        `extid=${encodeURIComponent(extid)}` +
        `&starttime=${encodeURIComponent(starttime)}` +
        `&endtime=${encodeURIComponent(endtime)}` +
        `&token=${token}` +
        `&random=${randomToken}`;
      
      logger.info(`Downloading CDR from: ${downloadUrl.substring(0, 100)}...`);
      
      return new Promise((resolve, reject) => {
        const options = {
          hostname: config.pbx_ip,
          port: parseInt(config.pbx_port) || 8088,
          path: `/api/v1.1.0/cdr/download?extid=${encodeURIComponent(extid)}&starttime=${encodeURIComponent(starttime)}&endtime=${encodeURIComponent(endtime)}&token=${token}&random=${randomToken}`,
          method: 'GET',
          rejectUnauthorized: false,
          headers: {
            'User-Agent': 'YeastarConnector/1.0'
          }
        };
        
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode === 200) {
              logger.info(` CDR downloaded successfully, size: ${data.length} bytes`);
              const parsedCalls = this.parseCDRData(data);
              resolve({
                status: 'Success',
                csrfToken: randomToken,
                data: parsedCalls,
                count: parsedCalls.length,
                raw: data
              });
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            }
          });
        });
        
        req.on('error', (error) => reject(error));
        req.on('timeout', () => reject(new Error('CDR download timeout')));
        req.setTimeout(15000);
        req.end();
      });
    } catch (error) {
      logger.error(` CDR Download Error: ${error.message}`);
      return { status: 'Failed', error: error.message };
    }
  }

  // Parse CSV CDR data into structured format
  parseCDRData(csvText) {
    try {
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) {
        logger.warn(' CDR data has no headers or data rows');
        return [];
      }
      
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const calls = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines
        
        // Handle CSV parsing with quoted values
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          const nextChar = line[j + 1];
          
          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              current += '"';
              j++; // Skip next quote
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        
        if (values.length !== headers.length) {
          logger.debug(` Row ${i} has ${values.length} values but headers has ${headers.length}`);
          continue;
        }
        
        const call = {};
        headers.forEach((header, index) => {
          call[header] = values[index];
        });
        
        // Map CDR fields to our call record format
        calls.push({
          cdrid: call.cdrid || call.callid || `${i}`,
          timestart: call.timestart || call.starttime || new Date().toISOString(),
          callfrom: call.callfrom || call.from || '',
          callto: call.callto || call.to || '',
          callduraction: parseInt(call.callduraction) || 0,
          talkduraction: parseInt(call.talkduraction) || 0,
          srctrunkname: call.srctrunkname || '',
          desttrunkname: call.desttrunkname || '',
          status: call.status || 'UNKNOWN',
          type: call.type || 'Unknown',
          recording: call.recording || null,
          didnumber: call.didnumber || null,
          agentringtime: call.agentringtime || null,
          sn: call.sn || null,
          raw: call
        });
      }
      
      logger.info(` Parsed ${calls.length} CDR records`);
      return calls;
    } catch (error) {
      logger.error(` CDR Parse Error: ${error.message}`);
      return [];
    }
  }
}

// Initialize PBX API
const pbxAPI = new YeastarPBXAPI();

// ========================================
// Background Call Sync Job
// ========================================

let callSyncInterval = null;
let isFirstSync = true; // Track first sync for historical backfill

// Start background call synchronization
async function startCallSync() {
  try {
    const config = db.getPbxConfig();
    
    if (!config || !config.pbx_ip || !config.api_username) {
      logger.debug(' Waiting for PBX configuration for call sync...');
      setTimeout(startCallSync, 30000); // Retry after 30 seconds
      return;
    }

    if (callSyncInterval) {
      clearInterval(callSyncInterval);
    }

    logger.info(' Starting background call sync service...');
    
    // Sync immediately on start
    await syncCallRecords();
    
    // Then sync every 5 minutes for ongoing updates
    callSyncInterval = setInterval(async () => {
      try {
        await syncCallRecords();
      } catch (error) {
        logger.error(`Background call sync error: ${error.message}`);
      }
    }, 5 * 60 * 1000); // 5 minutes
    
  } catch (error) {
    logger.error(`Failed to start call sync: ${error.message}`);
    setTimeout(startCallSync, 60000); // Retry after 1 minute
  }
}

// Sync call records from PBX
async function syncCallRecords() {
  try {
    logger.info(' Syncing call records from PBX...');
    
    // On first sync (cold start), backfill last 7 days; otherwise sync last hour
    let startDate;
    if (isFirstSync) {
      logger.info(' First sync detected - backfilling historical data from last 7 days...');
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      isFirstSync = false; // Only do historical backfill once
    } else {
      startDate = new Date(Date.now() - 60 * 60 * 1000).toISOString().split('T')[0]; // Last hour for ongoing syncs
    }
    
    const now = new Date().toISOString().split('T')[0];
    
    logger.info(` Querying CDR from ${startDate} to ${now}`);
    
    // Use the downloadCDRData method which returns proper S-Series v1.1.0 format
    let cdrResult;
    try {
      cdrResult = await pbxAPI.downloadCDRData('all', `${startDate} 00:00:00`, `${now} 23:59:59`);
    } catch (error) {
      logger.warn(` CDR download failed (PBX may not have CDR module enabled or user lacks permissions): ${error.message}`);
      cdrResult = null;
    }
    
    if (cdrResult && cdrResult.status === 'Success' && cdrResult.data && Array.isArray(cdrResult.data)) {
      let savedCount = 0;
      
      logger.info(` Processing ${cdrResult.data.length} CDR records...`);
      
      for (const call of cdrResult.data) {
        // Determine extension - could be caller or callee (whichever is an extension)
        let extension = null;
        
        // First, try to find extension by looking up callerid in pbx_extensions
        const findExtensionByCallerId = (phoneNumber) => {
          if (!phoneNumber) return null;
          // Try exact match first, then try without country code
          const records = db.db.prepare(`
            SELECT extnumber FROM pbx_extensions 
            WHERE callerid = ? OR callerid LIKE ?
            LIMIT 1
          `).all(phoneNumber, `%${phoneNumber.slice(-9)}`);
          return records.length > 0 ? records[0].extnumber : null;
        };
        
        // Check if caller is an extension by callerid lookup
        let foundExtension = findExtensionByCallerId(call.callfrom);
        if (foundExtension) {
          extension = foundExtension;
        } else {
          // Check if callee is an extension by callerid lookup
          foundExtension = findExtensionByCallerId(call.callto);
          if (foundExtension) {
            extension = foundExtension;
          } else {
            // Fallback to direct digit matching for internal extensions
            if (call.callto && /^\d{1,4}$/.test(call.callto)) {
              extension = call.callto;
            } else if (call.type === 'Outbound' && call.callfrom && /^\d{1,4}$/.test(call.callfrom)) {
              extension = call.callfrom;
            }
          }
        }
        
        const callRecord = {
          external_id: call.cdrid || `${call.callfrom}_${call.callto}_${call.timestart}`,
          caller_number: call.callfrom,
          callee_number: call.callto,
          caller_name: null,
          callee_name: null,
          direction: call.type === 'Inbound' ? 'inbound' : call.type === 'Outbound' ? 'outbound' : 'internal',
          status: mapCallStatus(call.status),
          extension: extension,
          start_time: call.timestart,
          answer_time: call.talkduraction > 0 ? call.timestart : null,
          end_time: call.timestart,
          ring_duration: Math.max(0, call.callduraction - call.talkduraction),
          talk_duration: call.talkduraction,
          total_duration: call.callduraction,
          recording_url: call.recording || null,
          metadata: call
        };
        
        if (db.saveCallRecord(callRecord)) {
          savedCount++;
          
          // EVENT-DRIVEN: Send missed call alert immediately when saved
          if (['missed', 'no-answer', 'noanswer', 'failed'].includes(callRecord.status)) {
            await sendMissedCallAlert(callRecord);
          }
        }
      }
      
      if (savedCount > 0) {
        logger.info(`Synced ${savedCount} new call records from PBX (out of ${cdrResult.data.length} total)`);
        
        // Log activity
        db.logActivity('call_sync', `Synced ${savedCount} call records from PBX`, 'success', null, JSON.stringify({
          total: cdrResult.data.length,
          saved: savedCount
        }));
      } else {
        logger.debug(` No new records to save (checked ${cdrResult.data.length} CDR records)`);
      }
    } else {
      logger.warn(`No CDR data received or error: ${cdrResult?.error || 'Unknown error'}`);
    }
    
  } catch (error) {
    logger.error(`Call sync error: ${error.message}`);
    db.logActivity('call_sync', `Call sync failed: ${error.message}`, 'error');
    alertErrorImmediately('Call Sync Error', error.message);
  }
}

// Start call sync when server starts
setTimeout(startCallSync, 5000); // Start after 5 seconds

// ========================================
// Telegram Rate Limiter (for Missed Calls only)
// ========================================

const missedCallAlertQueue = [];
let isSendingMissedCallAlert = false;
const MISSED_CALL_DELAY_MS = 300; // 300ms delay between missed call sends (prevents rate limiting)

async function processMissedCallQueue() {
  if (isSendingMissedCallAlert || missedCallAlertQueue.length === 0) {
    return;
  }

  isSendingMissedCallAlert = true;
  
  try {
    const item = missedCallAlertQueue.shift();
    
    if (item && typeof item.fn === 'function') {
      await item.fn();
    }
    
    // Wait before processing next item
    await new Promise(resolve => setTimeout(resolve, MISSED_CALL_DELAY_MS));
  } catch (error) {
    logger.error(`Missed call queue error: ${error.message}`);
  } finally {
    isSendingMissedCallAlert = false;
    
    // Process next item if queue not empty
    if (missedCallAlertQueue.length > 0) {
      processMissedCallQueue();
    }
  }
}

// ========================================
// Event-Driven Missed Call Alert (No Polling)
// ========================================

const notifiedMissedCalls = new Set(); // Track which missed calls we've already alerted

async function sendMissedCallAlert(callRecord) {
  try {
    const telegramConfig = db.getTelegramConfig();
    
    // Only send if telegram is enabled and configured
    if (!telegramConfig?.enabled || !telegramConfig?.bot_token || !telegramConfig?.chat_id) {
      logger.debug(' Telegram not enabled - skipping alert');
      return;
    }

    // Skip if not a missed call or already notified
    if (!['missed', 'no-answer', 'noanswer', 'failed'].includes(callRecord.status)) {
      return;
    }

    // ✅ CHECK CHECKPOINT - Only alert for NEW calls after Telegram was enabled
    const checkpoint = db.getAlertCheckpoint('missed_call');
    if (checkpoint) {
      const callTime = new Date(callRecord.start_time).getTime();
      const checkpointTime = new Date(checkpoint).getTime();
      
      if (callTime <= checkpointTime) {
        logger.debug(`⏭️ Skipping old call (${callRecord.start_time} <= ${checkpoint})`);
        return;
      }
    }

    const callKey = callRecord.external_id || callRecord.id;
    if (notifiedMissedCalls.has(callKey)) {
      logger.debug(` Alert already sent for: ${callKey}`);
      return;
    }

    try {
      // Format Telegram message with Nairobi timezone (UTC+3)
      const callDateTime = new Date(callRecord.start_time);
      const nairobiTime = new Date(callDateTime.getTime() + 3 * 60 * 60 * 1000);
      
      const callTime = nairobiTime.toLocaleTimeString('en-KE', { 
        timeZone: 'Africa/Nairobi',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      
      const callDate = nairobiTime.toLocaleDateString('en-KE', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      
      const callerNumber = callRecord.caller_number || 'Unknown';
      const extensionNumber = callRecord.extension || 'General Queue';
      const duration = callRecord.ring_duration || 0;
      
      // Get extension username from database
      let extensionUsername = 'N/A';
      if (extensionNumber !== 'General Queue') {
        const extInfo = db.db.prepare('SELECT username FROM pbx_extensions WHERE extnumber = ? LIMIT 1').get(extensionNumber);
        if (extInfo?.username) {
          extensionUsername = extInfo.username;
        }
      }
      
      let messageText = '🔔 MISSED CALL ALERT\n\n';
      messageText += `Caller: ${callerNumber}\n`;
      messageText += `Extension: ${extensionNumber} (${extensionUsername})\n`;
      messageText += `Time: ${callTime} (Nairobi)\n`;
      messageText += `Date: ${callDate}\n`;
      messageText += `Ring Duration: ${duration}s\n`;

      const botToken = telegramConfig.bot_token;
      const chatId = telegramConfig.chat_id;
      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

      const payload = {
        chat_id: chatId,
        text: messageText
      };

      logger.info(`🔔 Queuing missed call alert: ${callerNumber} → Ext ${extensionNumber}`);

      // Queue ONLY missed call alerts (other sends bypass queue to avoid bottlenecks)
      missedCallAlertQueue.push({
        fn: async () => {
          try {
            const tgResp = await fetch(telegramApiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            const tgJson = await tgResp.json();

            if (tgResp.ok && tgJson.ok) {
              logger.info(`✅ Missed call alert delivered to ${callerNumber}`);
              notifiedMissedCalls.add(callKey);
              
              // ✅ Update checkpoint to this call's time so we only check forward from here
              db.updateAlertCheckpoint('missed_call', callRecord.start_time);
              
              db.logActivity('telegram_missed_call_alert', `Missed call alert sent: ${callerNumber} -> ${extensionNumber}`, 'success');
            } else {
              logger.warn(`⏳ Telegram rate limited (will retry): ${tgJson.description || 'Unknown error'}`);
              db.logActivity('telegram_missed_call_alert_failed', `Failed to send alert for ${callerNumber}: ${tgJson.description || tgResp.statusText}`, 'error');
            }
          } catch (error) {
            logger.error(`❌ Queue send error: ${error.message}`);
          }
        }
      });

      // Process queue
      processMissedCallQueue();
    } catch (error) {
      logger.error(`❌ Missed call alert error: ${error.message}`);
      db.logActivity('telegram_alert_exception', `Alert exception: ${error.message}`, 'error');
    }
  } catch (error) {
    logger.error(`Missed call alert wrapper error: ${error.message}`);
  }
}

// ========================================
// Deprecated: checkAndAlertMissedCalls (replaced by event-driven sendMissedCallAlert)
// ========================================
// This function is kept for backwards compatibility but is no longer called
async function checkAndAlertMissedCalls() {
  logger.info(' Legacy polling function - skipped, using event-driven alerts instead');
}

async function alertErrorImmediately(eventType, message) {
  try {
    const telegramConfig = db.getTelegramConfig();
    
    // Only send if telegram is enabled
    if (!telegramConfig?.enabled || !telegramConfig?.bot_token || !telegramConfig?.chat_id) {
      return;
    }

    // Format time in Nairobi timezone (UTC+3)
    const now = new Date();
    const nairobiTime = now.toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    let messageText = 'ERROR ALERT\n\n';
    messageText += `Type: ${eventType}\n`;
    messageText += `Message: ${message.substring(0, 200)}${message.length > 200 ? '...' : ''}\n`;
    messageText += `Time: ${nairobiTime} (Nairobi)\n`;

    const botToken = telegramConfig.bot_token;
    const chatId = telegramConfig.chat_id;
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const payload = {
      chat_id: chatId,
      text: messageText
    };

    logger.info(`Sending Telegram error alert: ${eventType}`);

    // Send to Telegram
    const tgResp = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const tgJson = await tgResp.json();

    if (tgResp.ok && tgJson.ok) {
      logger.info(`Telegram error alert sent successfully`);
      db.logActivity('error_alert_sent', `Error alert sent: ${eventType}`, 'success');
    } else {
      logger.error(`Telegram error send failed: ${tgJson.description || 'Unknown error'}`);
    }
  } catch (error) {
    logger.error(`Error alert error: ${error.message}`);
  }
}

// Start checking for missed calls independently every 3 minutes
function startMissedCallAlerts() {
  // EVENT-DRIVEN ALERT: Polling is now disabled in favor of instant alerts
  // Alerts are sent immediately when a missed call is saved in syncCallRecords()
  logger.info('✅ Missed call alert service: EVENT-DRIVEN (instant alerts on call save)');
}

// Initialize event-driven alerts
startMissedCallAlerts();

// ========================================
// SMS Gateway Service (Hardcoded Credentials)
// ========================================

const SMS_GATEWAY_CONFIG = {
  url: 'https://sms.techrasystems.com/SMSApi/send',
  userid: 'nosteqltd',
  senderid: 'NOSTEQLTD',
  apikey: 'd5333c2f579ef1115d5984475e6fbecfffa2cdff'
};

async function sendSmsReport(phoneNumbers, messageText) {
  try {
    // Handle both single number and array of numbers
    const numbers = Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers];
    
    if (!numbers || numbers.length === 0 || !messageText) {
      logger.warn('SMS Report: No phone numbers or message provided');
      return false;
    }

    // Join phone numbers with comma (no space - gateway may not like spaces)
    const mobileParam = numbers.map(n => n.trim()).join(',');
    
    logger.info(`SMS sending to: ${mobileParam}`);
    logger.info(`Message length: ${messageText.length} characters`);

    try {
      // Build and execute curl command directly using shell escaping
      const { execSync } = require('child_process');
      
      // Use single quotes to prevent shell interpretation, but escape any single quotes in the message
      const escapedMsg = messageText.replace(/'/g, "'\\''");
      
      const curlCommand = `curl -X POST 'https://sms.techrasystems.com/SMSApi/send' \
-H 'Accept: application/json' \
-H 'apikey: d5333c2f579ef1115d5984475e6fbecfffa2cdff' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-H 'Cookie: SERVERID=webC1' \
-d 'userid=nosteqltd&senderid=NOSTEQLTD&msgType=text&duplicatecheck=true&sendMethod=quick&msg=${escapedMsg}&mobile=${mobileParam}'`;

      logger.info(`Executing SMS curl...`);
      
      const response = execSync(curlCommand, { 
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash' 
      });

      logger.info(`SMS Gateway Response: ${response}`);
      
      // Any response from gateway is typically success - they respond with JSON
      if (response && response.trim()) {
        logger.info(`SMS sent successfully to ${numbers.length} recipient(s): ${mobileParam}`);
        db.logActivity('sms_report_sent', `SMS sent to ${mobileParam}`, 'success');
        return true;
      } else {
        logger.warn(`SMS Gateway empty response for: ${mobileParam}`);
        return false;
      }
    } catch (execError) {
      logger.error(`Curl execution failed: ${execError.message}`);
      if (execError.stderr) {
        logger.error(`Stderr: ${execError.stderr}`);
      }
      if (execError.stdout) {
        logger.error(`Stdout: ${execError.stdout}`);
      }
      db.logActivity('sms_report_error', `SMS error to ${mobileParam}: ${execError.message}`, 'error');
      return false;
    }
  } catch (error) {
    logger.error(`SMS Report Exception: ${error.message}`);
    db.logActivity('sms_report_error', `SMS exception: ${error.message}`, 'error');
    return false;
  }
}

// ========================================
// Daily Report Service
// ========================================

let dailyReportInterval = null;
let lastReportTimes = {}; // Track last send times for morning and evening reports

async function sendDailyReport() {
  try {
    // Get today's date
    const today = new Date().toISOString().split('T')[0];

    // === CALL STATISTICS (AGGREGATED) ===
    const callStats = db.db.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') THEN 1 ELSE 0 END) as missed,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') AND is_returned = 0 THEN 1 ELSE 0 END) as unreturned_missed,
        SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) as busy,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        COUNT(DISTINCT extension) as total_extensions
      FROM call_records
      WHERE SUBSTR(start_time, 1, 10) = ?
    `).get(today);

    // === SMS STATISTICS (AGGREGATED) ===
    const smsStats = db.db.prepare(`
      SELECT COUNT(*) as total_sms FROM sms_messages 
      WHERE SUBSTR(received_at, 1, 10) = ?
    `).get(today);

    // Check if there's any data to report
    const hasCallData = callStats && callStats.total_calls > 0;
    const hasSmsData = smsStats && smsStats.total_sms > 0;

    if (!hasCallData && !hasSmsData) {
      logger.info('No calls or SMS today, skipping daily report');
      return;
    }

    let messageText = 'DAILY SYSTEM REPORT\n\n';
    messageText += `Date: ${today}\n`;
    messageText += `Report Time: Nairobi Time\n`;
    messageText += `\n========== CALLS ==========\n\n`;

    if (hasCallData) {
      messageText += `Total Calls: ${callStats.total_calls}\n`;
      messageText += `Extensions with Calls: ${callStats.total_extensions}\n\n`;
      messageText += `Call Status Breakdown:\n`;
      messageText += `[Answered] ${callStats.answered || 0}\n`;
      messageText += `[Missed] ${callStats.missed || 0}\n`;
      messageText += `[Unreturned] ${callStats.unreturned_missed || 0}\n`;
      messageText += `[Returned] ${(callStats.missed || 0) - (callStats.unreturned_missed || 0)}\n`;
      messageText += `[Busy] ${callStats.busy || 0}\n`;
      messageText += `[Failed] ${callStats.failed || 0}\n`;
    } else {
      messageText += `No calls today.\n`;
    }

    messageText += `\n========== SMS ==========\n\n`;

    if (hasSmsData) {
      messageText += `Total Messages Received: ${smsStats.total_sms}\n`;
    } else {
      messageText += `Total Messages Received: 0\n`;
    }

    messageText += `\n========== END REPORT ==========\n`;

    // ========== SEND TO TELEGRAM (IF ENABLED) ==========
    const telegramConfig = db.getTelegramConfig();
    
    if (telegramConfig?.enabled && telegramConfig?.bot_token && telegramConfig?.chat_id) {
      const botToken = telegramConfig.bot_token;
      const chatId = telegramConfig.chat_id;
      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

      const payload = {
        chat_id: chatId,
        text: messageText
      };

      logger.info('Sending daily system report to Telegram');

      // Send to Telegram
      const tgResp = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const tgJson = await tgResp.json();

      if (tgResp.ok && tgJson.ok) {
        logger.info('Daily report sent successfully to Telegram');
        db.logActivity('daily_report_sent', `Daily report: ${callStats.total_calls} calls, ${smsStats.total_sms} SMS messages`, 'success');
      } else {
        logger.error(`Daily report Telegram send failed: ${tgJson.description || 'Unknown error'}`);
      }
    } else {
      logger.info('Telegram not enabled, skipping Telegram report');
    }

    // ========== SEND SMS TO CONFIGURED PHONE NUMBERS ==========
    const smsRecipients = db.getSmsReportRecipients();
    if (smsRecipients && smsRecipients.length > 0) {
      logger.info(`📱 Sending daily report via SMS to ${smsRecipients.length} recipient(s)...`);
      
      // Send to all recipients at once
      const phoneNumbers = smsRecipients.map(r => r.phone_number);
      try {
        logger.info(`→ Sending daily report to all SMS recipients: ${phoneNumbers.join(', ')}`);
        const smsSent = await sendSmsReport(phoneNumbers, messageText);
        if (smsSent) {
          logger.info(`✅ Daily report sent successfully via SMS to ${smsRecipients.length} recipient(s)`);
        } else {
          logger.error(`❌ Failed to send daily report via SMS`);
        }
      } catch (error) {
        logger.error(`Exception sending daily SMS report: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Daily report error: ${error.message}`);
  }
}

function scheduleDailyReport() {
  logger.info('Scheduling shift reports:');
  logger.info('  Day Shift (06:00:00 - 17:59:59 Nairobi) → Report at 18:00:00 Nairobi (15:00:00 UTC)');
  logger.info('  Night Shift (18:00:00 - 05:59:59 Nairobi) → Report at 06:00:00 Nairobi (03:00:00 UTC)');

  // Check every second if it's time to send the reports
  dailyReportInterval = setInterval(() => {
    const now = new Date();
    // Nairobi is UTC+3
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const utcSeconds = now.getUTCSeconds();
    const time = `${String(utcHours).padStart(2, '0')}:${String(utcMinutes).padStart(2, '0')}:${String(utcSeconds).padStart(2, '0')}`;
    const today = now.toISOString().split('T')[0];

    // Day Shift End Report at exactly 18:00:00 Nairobi (15:00:00 UTC)
    // Covers: 06:00:00 - 17:59:59 Nairobi
    if (time === '15:00:00' && lastReportTimes.dayShift !== today) {
      lastReportTimes.dayShift = today;
      logger.info('📊 Sending Day Shift Report (18:00:00 Nairobi - covers 06:00-18:00)');
      sendDailyReport();
    }

    // Night Shift End Report at exactly 06:00:00 Nairobi (03:00:00 UTC)
    // Covers: 18:00:00 - 05:59:59 Nairobi
    if (time === '03:00:00' && lastReportTimes.nightShift !== today) {
      lastReportTimes.nightShift = today;
      logger.info('🌙 Sending Night Shift Report (06:00:00 Nairobi - covers 18:00-06:00)');
      sendDailyReport();
    }
  }, 1000); // Check every second
}

// Start scheduling the daily report
scheduleDailyReport();

async function recordHeartbeat() {
  try {
    const stats = db.getCallStats();
    const smsCount = db.db.prepare('SELECT COUNT(*) as count FROM sms_messages').get().count;
    const errorCount = db.db.prepare("SELECT COUNT(*) as count FROM activity_logs WHERE severity = 'error'").get().count;
    
    await fetch(`http://127.0.0.1:${PORT}/api/agent-heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: 'local-sms-agent',
        status: 'online',
        version: '1.0.0',
        hostname: 'local',
        messages_synced: smsCount,
        errors_count: errorCount,
        metadata: {
          callsStored: stats.total,
          callsAnswered: stats.answered,
          callsMissed: stats.missed,
          avgTalkTime: Math.round(stats.avgTalk)
        }
      })
    });
    logger.debug('🫀 Heartbeat recorded');
  } catch (error) {
    logger.debug(`Heartbeat record failed: ${error.message}`);
  }
}

// Start heartbeat every 60 seconds
setInterval(recordHeartbeat, 60000);
recordHeartbeat(); // Send immediately on startup

// Cache cleanup interval - clear old cache entries every 30 seconds
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of responseCache.entries()) {
    if (now - value.timestamp > 30000) { // 30 second max age
      responseCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`[Cache] Cleaned ${cleaned} expired entries`);
  }
}, 30000);

// ========================================
// SMS Listener (Background Service)
// ========================================

let tg400Api = null;
let pollingInterval = null;

async function startSmsListener() {
  try {
    const config = db.getGatewayConfig();
    
    if (!config || !config.gateway_ip || !config.api_username) {
      logger.debug('⏳ Waiting for gateway configuration...');
      // Retry after 5 seconds
      setTimeout(startSmsListener, 5000);
      return;
    }

    if (tg400Api && tg400Api.isConnected) {
      logger.debug('SMS listener already connected');
      return;
    }

    // Remove old listeners to prevent duplicates
    if (tg400Api) {
      logger.info('🧹 Cleaning up old SMS listener...');
      tg400Api.removeAllListeners('sms-received');
      tg400Api.removeAllListeners('disconnected');
    }

    logger.info(`\n📡 Connecting SMS listener to ${config.gateway_ip}:${config.api_port || 5038}`);
    
    tg400Api = new TG400TcpApi(
      config.gateway_ip,
      config.api_port || 5038,
      config.api_username,
      config.api_password,
      { log: (level, msg) => logger.debug(`[TCP] ${level.toUpperCase()}: ${msg}`) }
    );

    // Event: New SMS received - Server pushes SMS when received
    tg400Api.on('sms-received', (sms) => {
      try {
        logger.info(`\n📨 SMS LISTENER: Received event from TG400`);
        logger.info(`🔍 RAW SMS EVENT DATA:`, JSON.stringify({
          id: sms.id,
          gsmSpan: sms.gsmSpan,
          port: sms.port,
          portNumber: sms.portNumber,
          port_number: sms.port_number,
          sender: sms.sender,
          timestamp: new Date().toISOString()
        }, null, 2));
        
        // Determine which port field has the actual port number
        const portFromEvent = sms.port !== undefined ? sms.port : 
                             sms.portNumber !== undefined ? sms.portNumber :
                             sms.port_number !== undefined ? sms.port_number : null;
        
        const gsmSpan = sms.gsmSpan || (sms.port ? sms.port + 1 : 2);  // GsmSpan = port + 1
        
        logger.info(`✅ RESOLVED: Port=${portFromEvent}, GsmSpan=${gsmSpan}`);
        const internalPort = portFromEvent;
        
        let messageContent = sms.content || '';
        
        // Try additional decoding if needed
        try {
          // Replace + with space (form-encoding) then decode
          const normalized = messageContent.replace(/\+/g, ' ');
          messageContent = decodeURIComponent(normalized);
        } catch (e) {
          logger.debug(`No URL decoding needed: ${e.message}`);
          // If decoding fails, use original content
        }

        logger.info(`💾 Saving SMS to database: From ${sms.sender}, ${messageContent.length} chars, GsmSpan ${gsmSpan}, ID: ${sms.id}`);
        
        // Use high-level insert for consistency - store only gsm_span (2-5)
        const inserted = db.insertSMS({
          external_id: sms.id,
          sender_number: sms.sender,
          message_content: messageContent,
          gsm_span: gsmSpan,
          received_at: sms.received_at || new Date().toISOString(),
          status: 'unread'
        });
        
        // Clear related SMS caches immediately
        for (const [key] of responseCache.entries()) {
          if (key.includes('sms-') || key === 'statistics:all') {
            responseCache.delete(key);
          }
        }

        if (inserted) {
          logger.info(`✅ SMS SAVED: From ${sms.sender} on GsmSpan ${gsmSpan}`);
          db.logActivity('sms_received', `New SMS from ${sms.sender} on GsmSpan ${gsmSpan}: ${messageContent.substring(0, 50)}...`, 'success', gsmSpan);
          // Invalidate cache on new SMS
          responseCache.delete('sms-messages:*');
          responseCache.delete('statistics:all');
        } else {
          logger.error(`❌ SAVE FAILED: SMS from ${sms.sender} on GsmSpan ${gsmSpan} (ID: ${sms.id})`);
          logger.debug(`   Message: ${messageContent.substring(0, 100)}`);
          db.logActivity('sms_received_failed', `Failed to save SMS from ${sms.sender} on GsmSpan ${gsmSpan} (ID: ${sms.id})`, 'error', gsmSpan);
          alertErrorImmediately('SMS Save Failed', `SMS from ${sms.sender} on GsmSpan ${gsmSpan} could not be saved to database`);
        }
      } catch (err) {
        logger.error(`\n❌ SMS HANDLER ERROR: ${err && err.message ? err.message : String(err)}`);
        if (err && err.stack) logger.debug(err.stack);
        logErrorToFile(err);
        try { db.logActivity('sms_handler_error', `Handler error: ${err && err.message ? err.message : String(err)}`, 'error'); alertErrorImmediately('SMS Handler Error', err && err.message ? err.message : String(err)); } catch (e) {}
      }
    });

    // Event: Connection closed - try reconnect
    tg400Api.on('disconnected', () => {
      logger.warn('\n⚠️  SMS listener disconnected. Retrying in 30s...\n');
      setTimeout(startSmsListener, 30000);
    });

    // Cache invalidation on SMS listener connect
    responseCache.delete('sms-messages:*');
    responseCache.delete('statistics:all');
    
    // Connect and authenticate
    logger.info('⏳ Waiting for authentication...');
    await tg400Api.connect();
    
    logger.info('\n✅ SMS listener connected and authenticated.');
    logger.info('📨 Ready to receive SMS from TG400 gateway\n');
    db.logActivity('agent_start', 'SMS listener background service started', 'success');
    
    // Poll immediately on connection, then every 60 seconds
    (async () => {
      try {
        const ports = await tg400Api.getAllPortsInfo();
        logger.debug(`Initial port scan found ${ports.length} ports`);
        if (ports && Array.isArray(ports)) {
          ports.forEach(port => {
            db.updatePortStatus(port.portNumber, {
              status: port.status,
              isUp: port.isUp,
              isPowerOn: port.isPowerOn
            });
          });
        }
      } catch (err) {
        console.error('[Poll] Error polling initial port status:', err.message);
      }
    })();
    
    // Start polling for port status every 10 minutes (600s) - just to check which ports are being used
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
      try {
        const ports = await Promise.race([
          tg400Api.getAllPortsInfo(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Port polling timeout - skipping this cycle')), 8000)
          )
        ]);
        if (ports && Array.isArray(ports)) {
          ports.forEach(port => {
            try {
              db.updatePortStatus(port.portNumber, {
                status: port.status,
                isUp: port.isUp,
                isPowerOn: port.isPowerOn
              });
            } catch (updateErr) {
              logger.debug(`[Poll] Skipped port ${port.portNumber} update: ${updateErr.message}`);
            }
          });
        }
      } catch (err) {
        logger.debug(`[Poll] Port status polling skipped: ${err.message}`);
      }
    }, 600000);
  } catch (error) {
    logger.error(`\n Failed to start SMS listener: ${error.message}`);
    logger.info('Retrying in 30 seconds...\n');
    setTimeout(startSmsListener, 30000); // Retry later
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    status: 'ok',
    database: 'sqlite',
    dbPath: dbPath,
    timestamp: new Date().toISOString(),
    cacheSize: responseCache.size
  });
});

// Gateway connection status
app.get('/api/gateway-status', (req, res) => {
  const config = db.getGatewayConfig();
  const isConnected = tg400Api && tg400Api.isConnected;
  
  res.json({
    configured: !!(config && config.gateway_ip && config.api_username),
    connected: isConnected,
    gateway_ip: config?.gateway_ip || null,
    gateway_port: config?.api_port || null,
    timestamp: new Date().toISOString()
  });
});

// ========================================
// TG400 Direct API - Get Active SIM Ports
// ========================================

app.get('/api/tg400-ports', async (req, res) => {
  try {
    const config = db.getGatewayConfig();
    
    if (!config || !config.gateway_ip || !config.api_port) {
      return res.status(400).json({
        success: false,
        error: 'TG400 gateway not configured'
      });
    }

    let tg400Ports = [];

    // If already connected, use existing connection
    if (tg400Api && tg400Api.isConnected && tg400Api.isAuthenticated) {
      try {
        tg400Ports = await tg400Api.getAllPortsInfo();
      } catch (error) {
        logger.error(`Failed to get ports from existing connection: ${error.message}`);
      }
    }

    // If no ports from existing connection, create temporary connection
    if (tg400Ports.length === 0) {
      const TG400TcpApi = require('./tg400-tcp-api.cjs');
      const tempApi = new TG400TcpApi(
        config.gateway_ip,
        parseInt(config.api_port) || 5038,
        config.api_username,
        config.api_password,
        logger
      );

      try {
        await tempApi.connect();
        tg400Ports = await tempApi.getAllPortsInfo();
        tempApi.disconnect();
      } catch (error) {
        logger.error(`Failed to get ports from temp connection: ${error.message}`);
        tg400Ports = [];
      }
    }

    // Get database configurations for ports
    const dbConfigs = db.prepare(`
      SELECT port_number, label, carrier, phone_number, signal_strength, status
      FROM sim_port_config
    `).all();

    // Merge TG400 data with database configs
    const mergedPorts = tg400Ports.map(tg400Port => {
      // TG400 API already returns port numbers as 1-4 (internal format)
      // No conversion needed
      const portNumber = tg400Port.portNumber;
      
      // Find matching config using port number
      const dbConfig = dbConfigs.find(cfg => cfg.port_number === portNumber);
      
      logger.debug(`[/api/tg400-ports] Port ${portNumber}: DB match=${dbConfig ? 'yes' : 'no'}, label="${dbConfig?.label || 'none'}"`);
      
      return {
        ...tg400Port,
        portNumber: portNumber,  // Already internal port number (1-4)
        label: dbConfig?.label || null,
        carrier: dbConfig?.carrier || null,
        phone_number: dbConfig?.phone_number || null,
        signal_strength: dbConfig?.signal_strength || tg400Port.signal_strength || 0,
        status: dbConfig?.status || tg400Port.status || 'unknown'
      };
    });

    res.json({
      success: true,
      data: mergedPorts,
      source: 'merged',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Failed to get TG400 ports: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========================================
// SIM Port Configuration Endpoints
// ========================================

// Test endpoint to verify routing works
app.get('/api/sim-port-test', (req, res) => {
  logger.info('[TEST] SIM port test endpoint reached');
  res.json({ success: true, message: 'Routing is working' });
});

// Cache status endpoint for monitoring
app.get('/api/cache-stats', (req, res) => {
  res.json({
    success: true,
    cacheSize: responseCache.size,
    cacheEntries: Array.from(responseCache.keys()),
    uptime: Date.now() / 1000
  });
});

// Get all SIM port configurations
app.get('/api/sim-ports', (req, res) => {
  try {
    // Get configuration from database
    const ports = db.prepare(`
      SELECT id, port_number, label, phone_number, signal_strength, 
             carrier, status, last_seen_at, created_at, updated_at
      FROM sim_port_config
      ORDER BY port_number ASC
    `).all();

    logger.debug(`[/api/sim-ports] Raw ports from DB:`, ports.map(p => ({ port_number: p.port_number, label: p.label })));

    // Database already stores port numbers as 1-4 (internal format)
    // No normalization needed
    const normalizedPorts = ports.map(port => ({
      ...port
      // port_number is already 1-4, no conversion needed
    }));

    logger.debug(`[/api/sim-ports] Ports:`, normalizedPorts.map(p => ({ port_number: p.port_number, label: p.label })));

    res.json({
      success: true,
      data: normalizedPorts
    });
  } catch (error) {
    logger.error(`Failed to get SIM ports: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific SIM port configuration
app.get('/api/sim-port/:port', (req, res) => {
  try {
    const { port } = req.params;
    const internalPort = parseInt(port);
    
    logger.debug(`[/api/sim-port/:port] Looking for port ${internalPort}`);
    
    // Database stores port numbers as 1-4 (internal format)
    let portData = db.prepare(`
      SELECT id, port_number, label, phone_number, signal_strength,
             carrier, status, last_seen_at, created_at, updated_at
      FROM sim_port_config
      WHERE port_number = ?
      LIMIT 1
    `).get(internalPort);

    if (!portData) {
      logger.debug(`[/api/sim-port/:port] Port not found for ${internalPort}`);
      return res.status(404).json({
        success: false,
        error: 'Port not found'
      });
    }

    logger.debug(`[/api/sim-port/:port] Found port with port_number=${portData.port_number}, label=${portData.label}`);

    // Database stores internal port numbers, return as-is
    const normalizedPort = {
      ...portData
    };

    res.json({
      success: true,
      data: normalizedPort
    });
  } catch (error) {
    logger.error(`Failed to get SIM port: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update SIM port label
app.put('/api/sim-port/:port/label', (req, res) => {
  try {
    const { port } = req.params;
    const portNumber = parseInt(port);  // Port number (1-4) sent by config page
    const { label } = req.body;

    logger.info(`[/api/sim-port/:port/label] Saving label for port ${portNumber}: "${label}"`);

    if (!label || typeof label !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Label must be a non-empty string'
      });
    }

    // Check if record exists for this port
    let existing = db.prepare(`
      SELECT id, port_number FROM sim_port_config WHERE port_number = ?
    `).get(portNumber);

    logger.debug(`[/api/sim-port/:port/label] Existing record:`, existing);

    if (!existing) {
      // Create new port config
      logger.info(`[/api/sim-port/:port/label] Creating new port config for port ${portNumber}`);
      db.prepare(`
        INSERT INTO sim_port_config (port_number, label)
        VALUES (?, ?)
      `).run(portNumber, label);
    } else {
      // Update existing port config
      logger.info(`[/api/sim-port/:port/label] Updating port config for port ${portNumber}`);
      db.prepare(`
        UPDATE sim_port_config
        SET label = ?, updated_at = CURRENT_TIMESTAMP
        WHERE port_number = ?
      `).run(label, portNumber);
    }

    logger.info(`[/api/sim-port/:port/label] Port ${portNumber} label saved: "${label}"`);

    res.json({
      success: true,
      message: `Port ${portNumber} label updated successfully`,
      data: {
        port_number: portNumber,
        label: label
      }
    });
  } catch (error) {
    logger.error(`Failed to update SIM port label: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});



// ========================================
// Authentication Endpoints
// ========================================

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const result = db.authenticateUser(email, password);
    
    if (result.success) {
      // Get client IP address
      const clientIP = req.headers['x-forwarded-for'] ? 
        req.headers['x-forwarded-for'].split(',')[0].trim() : 
        req.connection.remoteAddress || req.socket.remoteAddress || 'Unknown';
      
      // Log login activity with IP
      db.logActivity('user_login', `User ${email} logged in from IP: ${clientIP}`, 'success', null, JSON.stringify({
        email,
        ip: clientIP,
        timestamp: new Date().toISOString()
      }));
      
      // Generate token in format: user.id:user.role for easy parsing
      const token = `${result.user.id}:${result.user.role}`;
      
      res.json({
        success: true,
        message: 'Login successful',
        token,
        user: result.user
      });
    } else {
      // Log failed login attempt
      const clientIP = req.headers['x-forwarded-for'] ? 
        req.headers['x-forwarded-for'].split(',')[0].trim() : 
        req.connection.remoteAddress || req.socket.remoteAddress || 'Unknown';
      
      db.logActivity('user_login_failed', `Failed login attempt for ${email} from IP: ${clientIP}`, 'error', null, JSON.stringify({
        email,
        ip: clientIP,
        timestamp: new Date().toISOString()
      }));
      
      res.status(401).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    const existingUser = db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered'
      });
    }

    const success = db.createUser(email, password, 'operator', name);
    
    if (success) {
      res.json({
        success: true,
        message: 'User registered successfully'
      });
    } else {
      throw new Error('Failed to create user');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  try {
    // In a real app with sessions/tokens, you'd invalidate them here
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// User Management Endpoints
// ========================================

// Get all users (admin only)
app.get('/api/users', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // For now, we'll get from the DB directly - in production, validate token
    // Check if user is admin by extracting from token/session if available
    const users = db.getAllUsers();
    
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new user (admin only)
app.post('/api/users', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { email, password, name, role = 'operator' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and password are required' 
      });
    }

    // Check if user already exists
    const existingUser = db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'User with this email already exists' 
      });
    }

    // Create user with specified role
    const success = db.createUser(email, password, role, name);
    
    if (success) {
      const newUser = db.getUserByEmail(email);
      res.json({
        success: true,
        message: 'User created successfully',
        data: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          created_at: newUser.created_at
        }
      });
    } else {
      throw new Error('Failed to create user');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update user (admin only)
app.put('/api/users/:id', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;
    const { email, password, name, role, is_active } = req.body;

    // Get user to ensure it exists
    const stmt = db.db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(id);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Update user
    const updateStmt = db.db.prepare(`
      UPDATE users SET 
        email = ?,
        name = ?,
        role = ?,
        is_active = ?
      WHERE id = ?
    `);
    
    updateStmt.run(
      email || user.email,
      name || user.name,
      role || user.role,
      is_active !== undefined ? is_active : user.is_active,
      id
    );

    // If password provided, update it
    if (password) {
      const crypto = require('crypto');
      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
      const pwdStmt = db.db.prepare('UPDATE users SET password = ? WHERE id = ?');
      pwdStmt.run(hashedPassword, id);
    }

    const updatedUser = db.db.prepare('SELECT id, email, name, role, is_active, created_at FROM users WHERE id = ?').get(id);
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete user (admin only)
app.delete('/api/users/:id', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { id } = req.params;

    // Prevent deleting the only admin
    const admins = db.db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
    const userToDelete = db.db.prepare('SELECT role FROM users WHERE id = ?').get(id);

    if (userToDelete && userToDelete.role === 'admin' && admins.count <= 1) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot delete the only admin user' 
      });
    }

    const stmt = db.db.prepare('DELETE FROM users WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get own profile
app.get('/api/users/profile/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Decode token to get user ID (format: user.id:user.role)
    const [userId, userRole] = token.split(':');
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const user = db.db.prepare('SELECT id, email, name, role, is_active, created_at FROM users WHERE id = ? AND is_active = 1').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ 
      success: true, 
      data: {
        id: user.id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        role: user.role,
        isActive: user.is_active === 1
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update own profile
app.put('/api/users/profile/me', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Decode token to get user ID (format: user.id:user.role)
    const [userId, userRole] = token.split(':');
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const { email, password, name, oldPassword } = req.body;
    
    // Get current user
    const currentUser = db.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!currentUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // If changing password, verify old password
    if (password) {
      if (!oldPassword) {
        return res.status(400).json({ success: false, error: 'Old password is required to change password' });
      }
      
      const oldPasswordHash = crypto.createHash('sha256').update(oldPassword).digest('hex');
      
      if (oldPasswordHash !== currentUser.password_hash) {
        return res.status(401).json({ success: false, error: 'Old password is incorrect' });
      }
    }
    
    // Update fields
    let updateQuery = 'UPDATE users SET updated_at = CURRENT_TIMESTAMP';
    const updateParams = [];
    
    if (email && email !== currentUser.email) {
      // Check email uniqueness
      const existingUser = db.db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId);
      if (existingUser) {
        return res.status(400).json({ success: false, error: 'Email already in use' });
      }
      updateQuery += ', email = ?';
      updateParams.push(email);
    }
    
    if (name) {
      updateQuery += ', name = ?';
      updateParams.push(name);
    }
    
    if (password) {
      const newPasswordHash = crypto.createHash('sha256').update(password).digest('hex');
      updateQuery += ', password_hash = ?';
      updateParams.push(newPasswordHash);
    }
    
    updateQuery += ' WHERE id = ?';
    updateParams.push(userId);
    
    const stmt = db.db.prepare(updateQuery);
    stmt.run(...updateParams);
    
    // Get updated user (without password)
    const updatedUser = db.db.prepare('SELECT id, email, name, role, is_active, created_at FROM users WHERE id = ?').get(userId);
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Gateway Configuration Endpoints
// ========================================

app.get('/api/gateway-config', (req, res) => {
  try {
    const config = db.getGatewayConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/gateway-config', (req, res) => {
  logger.debug('[API] POST /api/gateway-config received');
  logger.debug('[API] Request body: %s', JSON.stringify(req.body, null, 2));
  
  try {
    const { gateway_ip, api_username, api_password, api_port } = req.body;

    if (!gateway_ip || !api_username || !api_password) {
      logger.warn('[API] Validation failed - missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: gateway_ip, api_username, api_password'
      });
    }
    logger.debug('[API] Validation passed, calling db.saveGatewayConfig()');
    const success = db.saveGatewayConfig({
      gateway_ip,
      api_username,
      api_password,
      api_port: api_port || 5038
    });

    if (success) {
      logger.info('[API] Gateway config saved successfully');
      db.logActivity('gateway_config_updated', `Gateway config saved: ${gateway_ip}`, 'success');
      
      // Re-trigger SMS listener with new config
      startSmsListener();
      
      res.json({
        success: true,
        message: 'Gateway configuration saved',
        data: db.getGatewayConfig()
      });
    } else {
      throw new Error('Failed to save gateway configuration');
    }
    } catch (error) {
    logger.error('[API] Error: %s', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// PBX Configuration Endpoints
// ========================================

app.get('/api/pbx-config', (req, res) => {
  try {
    const config = db.getPbxConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PBX connection status
app.get('/api/pbx-status', (req, res) => {
  try {
    const config = db.getPbxConfig();
    const isConfigured = !!(config && config.pbx_ip && config.api_username);
    
    res.json({
      configured: isConfigured,
      pbx_ip: config?.pbx_ip || null,
      pbx_port: config?.pbx_port || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/pbx-config', (req, res) => {
  try {
    const { pbx_ip, pbx_port, api_username, api_password, web_port } = req.body;

    const success = db.savePbxConfig({
      pbx_ip,
      pbx_port: pbx_port || 5060,
      api_username,
      api_password,
      web_port: web_port || 8333
    });

    if (success) {
      // Clear any existing token when config changes
      pbxAPI.token = null;
      if (pbxAPI.tokenTimeout) {
        clearTimeout(pbxAPI.tokenTimeout);
        pbxAPI.tokenTimeout = null;
      }
      
      res.json({
        success: true,
        message: 'PBX configuration saved',
        data: db.getPbxConfig()
      });
    } else {
      throw new Error('Failed to save PBX configuration');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test PBX connection and authentication
app.get('/api/pbx-test', async (req, res) => {
  try {
    logger.info('🧪 Testing PBX connection...');
    const result = await pbxAPI.testConnection();
    res.json(result);
  } catch (error) {
    logger.error(`PBX Test Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      status: 'Error' 
    });
  }
});

// Test TG400 Gateway Connection (REAL TEST - Actually connects to the device)
app.get('/api/gateway-test', async (req, res) => {
  try {
    logger.info('🧪 Testing TG400 Gateway connection...');
    const gatewayConfig = db.getGatewayConfig();
    
    if (!gatewayConfig) {
      return res.status(400).json({
        success: false,
        error: 'Gateway not configured',
        status: 'Error'
      });
    }

    const gateway_ip = gatewayConfig.gateway_ip || '192.168.5.3';
    const api_port = gatewayConfig.api_port || 5038;
    const username = gatewayConfig.api_username || 'admin';
    const password = gatewayConfig.api_password || '';

    logger.info(` Attempting TCP connection to TG400 at ${gateway_ip}:${api_port} (user: ${username})...`);

    // Create TCP connection to test
    const net = require('net');
    const socket = net.createConnection(parseInt(api_port), gateway_ip);
    let authCompleted = false;
    let errorOccurred = false;
    const connectionTimeout = 10000; // 10 second timeout

    const timeoutHandle = setTimeout(() => {
      if (!authCompleted && !errorOccurred) {
        errorOccurred = true;
        socket.destroy();
        logger.error(` Gateway connection timeout after ${connectionTimeout}ms`);
        res.status(500).json({
          success: false,
          error: `Connection timeout to ${gateway_ip}:${api_port}`,
          status: 'Timeout'
        });
      }
    }, connectionTimeout);

    socket.on('connect', () => {
      logger.info(` TCP socket connected to ${gateway_ip}:${api_port}`);
      // Send login command with credentials
      const loginCmd = `Action: Login\r\nUsername: ${username}\r\nSecret: ${password}\r\n\r\n`;
      socket.write(loginCmd);
    });

    socket.on('data', (data) => {
      const response = data.toString();
      logger.info(` Received from TG400: ${response.substring(0, 100)}`);
      
      if (response.includes('Response: Success') || response.includes('Welcome')) {
        authCompleted = true;
        clearTimeout(timeoutHandle);
        socket.destroy();
        logger.info(` Authentication successful with TG400`);
        res.json({
          success: true,
          error: null,
          status: 'Connected',
          message: `Successfully connected and authenticated with TG400 at ${gateway_ip}:${api_port}`
        });
      } else if (response.includes('Response: Error') || response.includes('Invalid')) {
        authCompleted = true;
        clearTimeout(timeoutHandle);
        socket.destroy();
        logger.error(` Authentication failed with TG400`);
        res.status(500).json({
          success: false,
          error: 'Authentication failed - check credentials',
          status: 'Auth Error'
        });
      }
    });

    socket.on('error', (error) => {
      if (!errorOccurred) {
        errorOccurred = true;
        clearTimeout(timeoutHandle);
        logger.error(` Socket connection error: ${error.message}`);
        res.status(500).json({
          success: false,
          error: error.message,
          status: 'Connection Error'
        });
      }
    });

    socket.on('close', () => {
      if (!authCompleted && !errorOccurred) {
        logger.warn(`Socket closed before authentication completed`);
      }
    });
  } catch (error) {
    logger.error(`Gateway Test Error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      status: 'Error' 
    });
  }
});

// SMS Gateway URLs endpoints
app.post('/api/sms-gateway-url', (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid URL format' });
    }

    // Store the SMS gateway URL in database or config
    db.saveSmsGatewayUrl(url);
    logger.info(`📱 SMS Gateway URL saved: ${url}`);
    res.json({ success: true, message: 'SMS gateway URL saved' });
  } catch (error) {
    logger.error(`Error saving SMS gateway URL: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test SMS Gateway URL connectivity
app.post('/api/test-sms-gateway', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    logger.info(`🧪 Testing SMS gateway URL: ${url}`);

    // Test the URL with a simple fetch with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 5000)
    );

    const fetchPromise = fetch(url, {
      method: 'HEAD',
      timeout: 5000,
    }).catch(() => {
      // If HEAD fails, try GET
      return fetch(url, {
        method: 'GET',
        timeout: 5000,
      });
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (response?.ok) {
      logger.info(`✅ SMS gateway URL test successful: ${url}`);
      res.json({ success: true, message: 'Connection successful' });
    } else {
      logger.warn(`⚠️  SMS gateway URL returned status ${response?.status}: ${url}`);
      res.status(500).json({ success: false, message: `HTTP ${response?.status}` });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`❌ SMS gateway URL test failed: ${errorMsg}`);
    res.status(500).json({ success: false, message: errorMsg });
  }
});

// Query active calls
app.get('/api/pbx-calls', async (req, res) => {
  try {
    logger.info(' Querying active calls...');
    const calls = await pbxAPI.queryCalls();
    res.json({ success: true, data: calls });
  } catch (error) {
    logger.error(`Query Calls Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Query Call Detail Records (CDR)
app.get('/api/pbx-cdr', async (req, res) => {
  try {
    const { startTime, endTime, limit } = req.query;
    logger.info(` Querying CDR from PBX...`);
    const cdr = await pbxAPI.queryCDR(startTime, endTime, parseInt(limit) || 100);
    res.json({ success: true, data: cdr });
  } catch (error) {
    logger.error(`Query CDR Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Discover available API endpoints
app.get('/api/pbx-endpoints', async (req, res) => {
  try {
    logger.info('🔍 Discovering PBX API endpoints...');
    const endpoints = await pbxAPI.discoverEndpoints();
    res.json({ success: true, data: endpoints });
  } catch (error) {
    logger.error(`Discover Endpoints Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get real PBX system information
app.get('/api/pbx-system-info', async (req, res) => {
  try {
    logger.info('Getting PBX system information...');
    const info = await pbxAPI.getSystemInfo();
    res.json({ success: true, data: info });
  } catch (error) {
    logger.error(`Get System Info Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get real extensions list
app.get('/api/pbx-extensions', async (req, res) => {
  try {
    logger.info('📞 Getting PBX extensions...');
    const extensions = await pbxAPI.getExtensions();
    res.json({ success: true, data: extensions });
  } catch (error) {
    logger.error(`Get Extensions Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sync extensions from PBX to database
app.post('/api/pbx-sync-extensions', async (req, res) => {
  try {
    logger.info(' Syncing extensions from PBX to database...');
    const response = await pbxAPI.getExtensions();
    
    if (!response || !response.extinfos) {
      return res.status(500).json({ 
        success: false, 
        error: 'No extensions data received from PBX',
        data: response
      });
    }

    const extensions = response.extinfos;
    
    if (!extensions.length) {
      return res.status(500).json({ 
        success: false, 
        error: 'Extensions array is empty' 
      });
    }

    // Save each extension to database
    let savedCount = 0;
    for (const extension of extensions) {
      const saved = db.saveExtension(extension);
      if (saved) savedCount++;
    }

    logger.info(` Synchronized ${savedCount} extensions to database`);
    res.json({
      success: true,
      message: `Synchronized ${savedCount} extensions from PBX`,
      total: extensions.length,
      saved: savedCount
    });
  } catch (error) {
    logger.error(`Extension Sync Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Call Control APIs (Dial, Hangup, Query)
// ========================================

// Make a call (dial)
app.post('/api/pbx-call/dial', async (req, res) => {
  try {
    const { caller, callee, autoanswer = 'no' } = req.body;
    
    if (!caller || !callee) {
      return res.status(400).json({
        success: false,
        error: 'caller and callee parameters are required'
      });
    }

    logger.info(` Making call: ${caller} -> ${callee}`);
    const result = await pbxAPI.dialCall(caller, callee, autoanswer);
    
    res.json({ success: result.status === 'Success', data: result });
  } catch (error) {
    logger.error(`Dial Call Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Hang up a call
app.post('/api/pbx-call/hangup', async (req, res) => {
  try {
    const { extid } = req.body;
    
    if (!extid) {
      return res.status(400).json({
        success: false,
        error: 'extid parameter is required'
      });
    }

    logger.info(`📞 Hanging up call for extension: ${extid}`);
    const result = await pbxAPI.hangupCall(extid);
    
    res.json({ success: result.status === 'Success', data: result });
  } catch (error) {
    logger.error(`Hangup Call Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Query calls by type or ID
app.post('/api/pbx-call/query', async (req, res) => {
  try {
    const { type, callid } = req.body;
    
    logger.info(`📞 Querying calls: type=${type}, callid=${callid}`);
    const result = await pbxAPI.queryCallsAdvanced(type, callid);
    
    res.json({ success: result.status === 'Success', data: result });
  } catch (error) {
    logger.error(`Query Calls Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get call logs - query inbound and outbound calls
app.post('/api/pbx-call/logs', async (req, res) => {
  try {
    logger.info(`📊 Fetching call logs...`);
    
    // Query both inbound and outbound calls
    const inboundResult = await pbxAPI.queryCallsAdvanced('inbound');
    const outboundResult = await pbxAPI.queryCallsAdvanced('outbound');
    
    const inboundCalls = inboundResult.Calls || [];
    const outboundCalls = outboundResult.Calls || [];
    
    // Combine and sort by time
    const allCalls = [
      ...inboundCalls.map(c => ({ ...c, type: 'inbound' })),
      ...outboundCalls.map(c => ({ ...c, type: 'outbound' }))
    ];
    
    logger.info(`Call logs fetched: ${inboundCalls.length} inbound, ${outboundCalls.length} outbound`);
    
    res.json({
      success: true,
      data: {
        inbound: {
          count: inboundCalls.length,
          calls: inboundCalls
        },
        outbound: {
          count: outboundCalls.length,
          calls: outboundCalls
        },
        total: allCalls.length,
        allCalls
      }
    });
  } catch (error) {
    logger.error(`Call Logs Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get ALL call logs stored locally with filtering and pagination
app.get('/api/call-logs/stored', (req, res) => {
  try {
    const { direction, status, extension, limit = 100, offset = 0, sort = 'desc' } = req.query;
    
    logger.info(` Getting stored call logs: limit=${limit}, offset=${offset}, filter: direction=${direction}, status=${status}`);
    
    // Build WHERE clause for filtering
    let where = [];
    let params = [];
    
    if (direction && direction !== 'all') {
      where.push('direction = ?');
      params.push(direction);
    }
    
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    
    if (extension) {
      where.push('(extension = ? OR caller_number = ? OR callee_number = ?)');
      params.push(extension, extension, extension);
    }
    
    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const orderBy = sort === 'asc' ? 'ASC' : 'DESC';
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM call_records ${whereClause}`;
    const countStmt = db.db.prepare(countQuery);
    const countResult = countStmt.all(...params);
    const totalRecords = countResult[0]?.total || 0;
    
    // Get paginated records
    const dataQuery = `
      SELECT * FROM call_records 
      ${whereClause}
      ORDER BY start_time ${orderBy}
      LIMIT ? OFFSET ?
    `;
    
    const stmt = db.db.prepare(dataQuery);
    const records = stmt.all(...params, parseInt(limit), parseInt(offset));
    
    res.json({
      success: true,
      data: {
        total: totalRecords,
        count: records.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
        records: records
      }
    });
  } catch (error) {
    logger.error(`Stored Call Logs Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sync and store all call logs from PBX to local database
app.post('/api/call-logs/sync', async (req, res) => {
  try {
    logger.info(` Syncing all call logs from PBX to local storage...`);
    
    // Use CDR endpoint to get historical call records
    // CDR (Call Detail Records) contains all completed calls, not just active ones
    const token = await pbxAPI.getToken();
    
    // Query CDR for last 30 days
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const startStr = startTime.toISOString().split('T')[0];
    const endStr = endTime.toISOString().split('T')[0];
    
    logger.info(` Querying CDR from ${startStr} to ${endStr}`);
    
    // Try CDR endpoint
    let cdrData = [];
    try {
      const cdrResponse = await pbxAPI.makeRequest('POST', `/api/v1.1.0/cdr/get_random?token=${token}`, {
        starttime: startStr,
        endtime: endStr
      });
      
      if (cdrResponse.data) {
        cdrData = cdrResponse.data;
      } else if (cdrResponse.Calls) {
        cdrData = cdrResponse.Calls;
      } else if (Array.isArray(cdrResponse)) {
        cdrData = cdrResponse;
      }
      
      logger.info(` CDR query returned ${cdrData.length} call records`);
    } catch (err) {
      logger.warn(`CDR query failed: ${err.message}`);
    }
    
    let savedCount = 0;
    let skippedCount = 0;
    
    // Save CDR records
    for (const call of cdrData) {
      const record = {
        external_id: call.id || call.callid || `cdr_${Date.now()}`,
        caller_number: call.src || call.caller || call.from,
        callee_number: call.dst || call.callee || call.to,
        caller_name: call.src_name || call.caller_name,
        callee_name: call.dst_name || call.callee_name,
        direction: call.direction || (call.type === 'in' ? 'inbound' : 'outbound'),
        status: call.status || 'completed',
        extension: call.extension || call.ext,
        start_time: call.starttime || call.start_time,
        answer_time: call.answer_time,
        end_time: call.endtime || call.end_time,
        ring_duration: call.ring_duration || 0,
        talk_duration: call.duration || call.billsec || 0,
        total_duration: call.duration || 0,
        recording_url: call.recording_file || call.recordingfile
      };
      
      if (db.saveCallRecord(record)) {
        savedCount++;
      } else {
        skippedCount++;
      }
    }
    
    // Also query live inbound/outbound for current calls
    logger.info(`📞 Also checking for current active calls...`);
    const inboundResult = await pbxAPI.queryCallsAdvanced('inbound');
    const outboundResult = await pbxAPI.queryCallsAdvanced('outbound');
    
    const inboundCalls = inboundResult.Calls || [];
    const outboundCalls = outboundResult.Calls || [];
    
    logger.info(`Found ${inboundCalls.length} active inbound + ${outboundCalls.length} active outbound calls`);
    
    res.json({
      success: true,
      data: {
        cdr_records: cdrData.length,
        active_inbound: inboundCalls.length,
        active_outbound: outboundCalls.length,
        saved: savedCount,
        skipped: skippedCount,
        total: cdrData.length
      }
    });
  } catch (error) {
    logger.error(`Sync Call Logs Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get extensions from database
app.get('/api/extensions', (req, res) => {
  try {
    logger.info(' Getting extensions from database...');
    const extensions = db.getExtensions();
    const stats = db.getExtensionStats();
    
    res.json({
      success: true,
      data: {
        extensions,
        stats
      }
    });
  } catch (error) {
    logger.error(`Get Extensions DB Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single extension
app.get('/api/extensions/:extnumber', (req, res) => {
  try {
    const { extnumber } = req.params;
    logger.info(`📞 Getting extension ${extnumber} from database...`);
    
    const extensions = db.getExtensions();
    const extension = extensions.find(ext => ext.extnumber === extnumber);
    
    if (!extension) {
      return res.status(404).json({ 
        success: false, 
        error: 'Extension not found' 
      });
    }

    res.json({
      success: true,
      data: extension
    });
  } catch (error) {
    logger.error(`Get Extension Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get call logs for specific extension
app.get('/api/extensions/:extnumber/call-logs', (req, res) => {
  try {
    const { extnumber } = req.params;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const offset = (page - 1) * pageSize;
    
    // Get total count of calls for this extension
    const countStmt = db.db.prepare(`
      SELECT COUNT(*) as total FROM call_records
      WHERE extension = ? OR caller_number = ? OR callee_number = ?
    `);
    const { total } = countStmt.get(extnumber, extnumber, extnumber);
    
    // Get paginated call records
    const stmt = db.db.prepare(`
      SELECT * FROM call_records
      WHERE extension = ? OR caller_number = ? OR callee_number = ?
      ORDER BY start_time DESC
      LIMIT ? OFFSET ?
    `);
    const records = stmt.all(extnumber, extnumber, extnumber, pageSize, offset);
    
    res.json({
      success: true,
      data: records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      },
      extension: extnumber
    });
  } catch (error) {
    logger.error(`Get Extension Call Logs Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sync call logs for specific extension from PBX
app.post('/api/extensions/:extnumber/sync-call-logs', async (req, res) => {
  try {
    const { extnumber } = req.params;
    const days = parseInt(req.query.days) || 7; // Default last 7 days
    
    logger.info(`Syncing call logs for extension ${extnumber} (${days} days)...`);
    
    // Try to fetch call logs from PBX for this extension
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);
    
    // Format dates for PBX API (YYYY-MM-DD)
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    
    const token = await pbxAPI.getToken();
    const endpoints = [
      `/api/v2.0.0/cdr/query?token=${token}&starttime=${startStr}&endtime=${endStr}&extension=${extnumber}`,
      `/api/v1.0.0/cdr/query?access_token=${token}&starttime=${startStr}&endtime=${endStr}&extension=${extnumber}`,
      `/api/v2.0.0/call/query?token=${token}&extension=${extnumber}`,
      `/api/v1.0.0/call/query?access_token=${token}&extension=${extnumber}`
    ];
    
    let callData = null;
    let workingEndpoint = null;
    
    for (const endpoint of endpoints) {
      try {
        const response = await pbxAPI.makeRequest('GET', endpoint);
        if (response.status === 'Success' && response.cdr) {
          callData = response.cdr;
          workingEndpoint = endpoint;
          break;
        }
      } catch (error) {
        continue;
      }
    }
    
    if (!callData) {
      return res.json({
        success: true,
        message: `No call logs API available for extension ${extnumber}`,
        data: [],
        note: 'This S100 model may not support call log queries'
      });
    }
    
    // Save call records to database
    let savedCount = 0;
    for (const call of callData) {
      const record = {
        external_id: call.uniqueid,
        caller_number: call.src,
        callee_number: call.dst,
        extension: extnumber,
        direction: call.disposition === 'ANSWERED' ? 'inbound' : 'outbound',
        status: call.disposition,
        start_time: call.calldate,
        answer_time: call.answertime,
        end_time: call.endtime,
        total_duration: call.billsec,
        metadata: call
      };
      
      if (db.saveCallRecord(record)) {
        savedCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Synced ${savedCount} call logs for extension ${extnumber}`,
      saved: savedCount,
      total: callData.length,
      endpoint: workingEndpoint
    });
  } catch (error) {
    logger.error(`Extension Call Log Sync Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Call Records API Endpoints
// ========================================

// Save a call record
app.post('/api/call-records', (req, res) => {
  try {
    const success = db.saveCallRecord(req.body);
    if (success) {
      res.json({ success: true, message: 'Call record saved' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to save call record' });
    }
  } catch (error) {
    logger.error(`Save Call Record Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear test data from database
app.post('/api/clear-test-data', (req, res) => {
  try {
    const result = db.db.prepare("DELETE FROM call_records WHERE external_id LIKE 'test-call-%'").run();
    const stats = db.getCallStats();
    logger.info(` Cleared ${result.changes} test call records`);
    res.json({ 
      success: true, 
      message: `Cleared ${result.changes} test call records from database`,
      stats: stats
    });
  } catch (error) {
    logger.error(`Clear Test Data Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear ALL call records from database
app.post('/api/clear-calls', (req, res) => {
  try {
    const result = db.db.prepare("DELETE FROM call_records").run();
    logger.info(` Cleared ${result.changes} call records from database`);
    res.json({ 
      success: true, 
      message: `Cleared ${result.changes} call records from database`,
      deleted: result.changes
    });
  } catch (error) {
    logger.error(`Clear Calls Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Sync calls from PBX and store locally
app.post('/api/pbx-sync-calls', async (req, res) => {
  try {
    logger.info(' Syncing calls from PBX...');
    const pbxCalls = await pbxAPI.queryCalls();
    
    if (pbxCalls && pbxCalls.status === 'Success' && pbxCalls.data) {
      let savedCount = 0;
      
      // Process each call from PBX and save to database
      for (const call of pbxCalls.data) {
        const callRecord = {
          external_id: call.id || call.callid,
          caller_number: call.from || call.callerid,
          callee_number: call.to || call.destination,
          caller_name: call.fromname || null,
          callee_name: call.toname || null,
          direction: determineCallDirection(call),
          status: mapCallStatus(call.status),
          extension: call.extension || null,
          start_time: call.starttime || new Date().toISOString(),
          answer_time: call.answertime || null,
          end_time: call.endtime || null,
          ring_duration: call.ringduration || 0,
          talk_duration: call.duration || 0,
          total_duration: (call.ringduration || 0) + (call.duration || 0),
          metadata: call
        };
        
        if (db.saveCallRecord(callRecord)) {
          savedCount++;
        }
      }
      
      res.json({ 
        success: true, 
        message: `Synced ${savedCount} calls from PBX`, 
        data: { saved: savedCount, total: pbxCalls.data.length } 
      });
    } else {
      res.json({ 
        success: false, 
        message: 'No calls received from PBX or PBX error',
        error: pbxCalls.errno
      });
    }
  } catch (error) {
    logger.error(`PBX Sync Calls Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper functions for call processing
function determineCallDirection(call) {
  // Basic logic - can be enhanced based on PBX response structure
  if (call.direction) return call.direction;
  if (call.from && call.to) {
    // Check if internal calls (extension to extension)
    if (/^[1-9]\d{2,3}$/.test(call.from) && /^[1-9]\d{2,3}$/.test(call.to)) {
      return 'internal';
    }
    // If from external number, it's inbound
    if (!/^[1-9]\d{2,3}$/.test(call.from)) {
      return 'inbound';
    }
    // If to external number, it's outbound
    return 'outbound';
  }
  return 'unknown';
}

function mapCallStatus(status) {
  if (!status) return 'unknown';
  const statusLower = status.toLowerCase();
  
  const statusMap = {
    'answered': 'answered',
    'up': 'answered',
    'connected': 'answered',
    'missed': 'missed',
    'noanswer': 'missed',
    'no answer': 'missed',
    'busy': 'busy',
    'failed': 'failed',
    'voicemail': 'voicemail'
  };
  
  return statusMap[statusLower] || 'unknown';
}

// ========================================
// Telegram Configuration Endpoints
// ========================================

app.get('/api/telegram-config', (req, res) => {
  try {
    const config = db.getTelegramConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/telegram-config', (req, res) => {
  try {
    const { bot_token, chat_id, enabled } = req.body;

    const success = db.saveTelegramConfig({
      bot_token,
      chat_id,
      enabled
    });

    if (success) {
      res.json({
        success: true,
        message: 'Telegram configuration saved',
        data: db.getTelegramConfig()
      });
    } else {
      throw new Error('Failed to save Telegram configuration');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/telegram-send', async (req, res) => {
  try {
    const { action, bot_token: overrideBotToken, chat_id: overrideChatId } = req.body;
    const telegramConfig = db.getTelegramConfig();

    // Allow overriding for testing purposes
    const botToken = overrideBotToken || telegramConfig?.bot_token;
    const chatId = overrideChatId || telegramConfig?.chat_id;
    const isEnabled = telegramConfig?.enabled;

    if (!botToken || !chatId) {
      return res.status(400).json({
        success: false,
        error: 'Telegram not configured. Please set bot token and chat ID.'
      });
    }

    let messageText = '';
    
    // Format Nairobi timezone for all messages
    const nairobiTime = new Date().toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    // Handle test message
    if (action === 'test') {
      messageText = 'Telegram Connection Test \n\n';
      messageText += 'Your bot is properly configured and connected.\n';
      messageText += `Time: ${nairobiTime} (Nairobi, UTC+3)\n`;
    }
    // Gather data based on action type
    else if (action === 'sms_logs') {
      // Get SMS from today only - use SUBSTR to handle mixed timestamp formats
      const today = new Date().toISOString().split('T')[0];
      const smsMessages = db.db.prepare(`
        SELECT * FROM sms_messages 
        WHERE SUBSTR(received_at, 1, 10) = ?
        ORDER BY received_at DESC LIMIT 20
      `).all(today);
      
      messageText = 'SMS LOGS (TODAY)\n\n';
      if (smsMessages.length === 0) {
        messageText += 'No SMS messages today.';
      } else {
        smsMessages.forEach((msg, idx) => {
          messageText += `${idx + 1}. From: ${msg.sender_number}\n`;
          messageText += `   ${msg.message_content?.substring(0, 60)}${msg.message_content?.length > 60 ? '...' : ''}\n`;
          messageText += `   Time: ${msg.received_at}\n`;
          messageText += `   Port: ${msg.sim_port}\n\n`;
        });
      }
    } else if (action === 'call_logs') {
      // Get calls from today only - use SUBSTR to handle mixed timestamp formats
      const today = new Date().toISOString().split('T')[0];
      const callRecords = db.db.prepare(`
        SELECT * FROM call_records 
        WHERE SUBSTR(start_time, 1, 10) = ?
        ORDER BY start_time DESC LIMIT 20
      `).all(today);
      
      messageText = 'CALL LOGS (TODAY)\n\n';
      if (callRecords.length === 0) {
        messageText += 'No call records today.';
      } else {
        callRecords.forEach((call, idx) => {
          const duration = call.total_duration ? `${Math.floor(call.total_duration / 60)}m` : 'N/A';
          messageText += `${idx + 1}. From: ${call.caller_number} - To: ${call.callee_number}\n`;
          messageText += `   Status: ${call.status} | Duration: ${duration}\n`;
          messageText += `   ${call.start_time}\n\n`;
        });
      }
    } else if (action === 'activity_logs') {
      // Get activities from today only - use SUBSTR to handle mixed timestamp formats
      const today = new Date().toISOString().split('T')[0];
      const activities = db.db.prepare(`
        SELECT * FROM activity_logs 
        WHERE SUBSTR(created_at, 1, 10) = ?
        ORDER BY created_at DESC LIMIT 20
      `).all(today);
      
      messageText = 'ACTIVITY LOGS (TODAY)\n\n';
      if (activities.length === 0) {
        messageText += 'No activities today.';
      } else {
        activities.forEach((activity, idx) => {
          messageText += `${idx + 1}. [${activity.severity.toUpperCase()}] ${activity.event_type}\n`;
          messageText += `   ${activity.message}\n`;
          messageText += `   ${activity.created_at}\n\n`;
        });
      }
    } else if (action === 'gateway_status') {
      const gatewayConfig = db.getGatewayConfig();
      const pbxConfig = db.getPbxConfig();
      const totalPorts = db.db.prepare('SELECT COUNT(*) as cnt FROM sim_port_config').get();
      const portDetails = db.db.prepare('SELECT port_number, status FROM sim_port_config ORDER BY port_number').all();
      
      messageText = 'GATEWAY & PBX STATUS\n\n';
      messageText += `Gateway IP: ${gatewayConfig?.gateway_ip || 'Not configured'}\n`;
      messageText += `PBX IP: ${pbxConfig?.pbx_ip || 'Not configured'}\n`;
      messageText += `Total SIM Ports: ${totalPorts.cnt}\n`;
      if (portDetails.length > 0) {
        messageText += `\nPort Details:\n`;
        portDetails.forEach(port => {
          const status = port.enabled ? 'ENABLED' : 'DISABLED';
          messageText += `  Port ${port.port_number}: ${status} - ${port.status}\n`;
        });
      } else {
        messageText += `\nNo SIM ports configured\n`;
      }
      messageText += `Time: ${nairobiTime} (Nairobi, UTC+3)\n`;
    } else if (action === 'system_summary') {
      const today = new Date().toISOString().split('T')[0];
      const smsCount = db.db.prepare("SELECT COUNT(*) as cnt FROM sms_messages WHERE SUBSTR(received_at, 1, 10) = ?").get(today);
      const callCount = db.db.prepare("SELECT COUNT(*) as cnt FROM call_records WHERE SUBSTR(start_time, 1, 10) = ?").get(today);
      const errorCount = db.db.prepare("SELECT COUNT(*) as cnt FROM activity_logs WHERE severity = 'error' AND SUBSTR(created_at, 1, 10) = ?").get(today);
      const totalActivity = db.db.prepare("SELECT COUNT(*) as cnt FROM activity_logs WHERE SUBSTR(created_at, 1, 10) = ?").get(today);
      const totalPorts = db.db.prepare('SELECT COUNT(*) as cnt FROM sim_port_config').get();
      
      messageText = 'SYSTEM SUMMARY (TODAY)\n\n';
      messageText += `SMS Messages: ${smsCount.cnt}\n`;
      messageText += `Call Records: ${callCount.cnt}\n`;
      messageText += `Activities: ${totalActivity.cnt}\n`;
      messageText += `Errors: ${errorCount.cnt}\n`;
      messageText += `Total SIM Ports: ${totalPorts.cnt}\n`;
      messageText += `Time: ${nairobiTime} (Nairobi, UTC+3)\n`;
    }

    // Send to Telegram API
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const payload = {
      chat_id: chatId,
      text: messageText
    };

    // Log the telegram send action
    db.logActivity('telegram_send', `Telegram ${action} sent`, 'success');
    
    logger.info(`[Telegram] Sending ${action} message to chat ${chatId}`);

    // Ensure fetch exists (Node 18+ has global fetch; otherwise log)
    if (typeof fetch === 'undefined') {
      console.warn('Global fetch not available; Telegram send may fail');
    }

    // Send to Telegram and wait for result so UI can display success/failure
    try {
      const tgResp = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const tgJson = await tgResp.json().catch(() => ({}));

      if (tgResp.ok && tgJson && tgJson.ok) {
        logger.info('[Telegram] Message sent successfully');
        db.logActivity('telegram_send_success', `Telegram ${action} sent to ${chatId}`, 'success');
        return res.json({ success: true, message: `${action} sent to Telegram`, preview: messageText });
      }
      const errMsg = tgJson && tgJson.description ? tgJson.description : `HTTP ${tgResp.status}`;
      logger.error('[Telegram] Failed to send: %s', errMsg);
      db.logActivity('telegram_send_failed', `Telegram send failed: ${errMsg}`, 'error');
      return res.status(502).json({ success: false, error: `Telegram API error: ${errMsg}`, preview: messageText });
    } catch (err) {
      logger.error('[Telegram] Error sending: %s', err && err.message ? err.message : err);
      logErrorToFile(err);
      db.logActivity('telegram_send_exception', `Telegram send exception: ${err && err.message ? err.message : String(err)}`, 'error');
      return res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// SMS Report Recipients API Endpoints
// ========================================

// Get all SMS report recipients
app.get('/api/sms-report-recipients', (req, res) => {
  try {
    const recipients = db.getSmsReportRecipients();
    res.json({ 
      success: true, 
      data: recipients,
      count: recipients.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a phone number to receive SMS reports
app.post('/api/sms-report-recipients', (req, res) => {
  try {
    const { phone_number } = req.body;

    if (!phone_number || typeof phone_number !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'phone_number is required and must be a string' 
      });
    }

    const success = db.addSmsReportRecipient(phone_number);

    if (success) {
      res.json({
        success: true,
        message: `Phone number ${phone_number} added to SMS report recipients`,
        data: { phone_number }
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Phone number ${phone_number} may already exist or failed to save`
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove a phone number from SMS report recipients
app.delete('/api/sms-report-recipients/:phone_number', (req, res) => {
  try {
    const { phone_number } = req.params;

    if (!phone_number) {
      return res.status(400).json({ 
        success: false, 
        error: 'phone_number is required' 
      });
    }

    const success = db.removeSmsReportRecipient(decodeURIComponent(phone_number));

    if (success) {
      res.json({
        success: true,
        message: `Phone number removed from SMS report recipients`,
        data: { phone_number }
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Phone number not found'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test SMS report delivery
app.post('/api/sms-report-test', async (req, res) => {
  try {
    const { phone_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({ 
        success: false, 
        error: 'phone_number is required' 
      });
    }

    logger.info(`🧪 Testing SMS report delivery to ${phone_number}...`);

    const testMessage = `📊 TEST REPORT - ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n\nIf you receive this message, SMS delivery is working correctly.`;
    
    const success = await sendSmsReport(phone_number, testMessage);

    if (success) {
      res.json({
        success: true,
        message: 'Test SMS sent successfully',
        phone_number
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to send test SMS',
        phone_number
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual report generation endpoint
app.post('/api/manual-report', async (req, res) => {
  try {
    // Get today's date
    const today = new Date().toISOString().split('T')[0];

    // === CALL STATISTICS (FROM MIDNIGHT TO NOW TODAY) ===
    const callStats = db.db.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') THEN 1 ELSE 0 END) as missed,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') AND is_returned = 0 THEN 1 ELSE 0 END) as unreturned_missed,
        SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) as busy,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        COUNT(DISTINCT extension) as total_extensions
      FROM call_records
      WHERE SUBSTR(start_time, 1, 10) = ?
    `).get(today);

    // === SMS STATISTICS (FROM MIDNIGHT TO NOW TODAY) ===
    const smsStats = db.db.prepare(`
      SELECT COUNT(*) as total_sms FROM sms_messages 
      WHERE SUBSTR(received_at, 1, 10) = ?
    `).get(today);

    // Check if there's any data to report
    const hasCallData = callStats && callStats.total_calls > 0;
    const hasSmsData = smsStats && smsStats.total_sms > 0;

    let messageText = 'MANUAL SYSTEM REPORT (Today from 00:00 to now)\n\n';
    messageText += `Date: ${today}\n`;
    messageText += `Generated: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n`;
    messageText += `\n========== CALLS ==========\n\n`;

    if (hasCallData) {
      messageText += `Total Calls: ${callStats.total_calls}\n`;
      messageText += `Extensions with Calls: ${callStats.total_extensions}\n\n`;
      messageText += `Call Status Breakdown:\n`;
      messageText += `[Answered] ${callStats.answered || 0}\n`;
      messageText += `[Missed] ${callStats.missed || 0}\n`;
      messageText += `[Unreturned] ${callStats.unreturned_missed || 0}\n`;
      messageText += `[Returned] ${(callStats.missed || 0) - (callStats.unreturned_missed || 0)}\n`;
      messageText += `[Busy] ${callStats.busy || 0}\n`;
      messageText += `[Failed] ${callStats.failed || 0}\n`;
    } else {
      messageText += `No calls today.\n`;
    }

    messageText += `\n========== SMS ==========\n\n`;

    if (hasSmsData) {
      messageText += `Total Messages Received: ${smsStats.total_sms}\n`;
    } else {
      messageText += `Total Messages Received: 0\n`;
    }

    messageText += `\n========== END REPORT ==========\n`;

    logger.info('📱 Generating manual report for SMS delivery only...');

    // Send to SMS recipients only
    const smsRecipients = db.getSmsReportRecipients();
    
    logger.info(`📋 SMS Recipients found: ${smsRecipients?.length || 0}`);
    if (smsRecipients && smsRecipients.length > 0) {
      logger.info(`Recipients: ${smsRecipients.map(r => r.phone_number).join(', ')}`);
    }
    
    const sendResults = {
      sms: { count: 0, recipients: [] }
    };

    if (!smsRecipients || smsRecipients.length === 0) {
      logger.warn('⚠️  No SMS recipients configured');
      return res.status(400).json({
        success: false,
        error: 'No SMS recipients configured. Please add phone numbers to receive reports.'
      });
    }

    logger.info(`📱 Sending manual report via SMS to ${smsRecipients.length} recipient(s)...`);
    
    // Extract all phone numbers and send in one request
    const phoneNumbers = smsRecipients.map(r => r.phone_number);
    
    try {
      logger.info(`→ Sending to all recipients at once: ${phoneNumbers.join(', ')}`);
      const smsSent = await sendSmsReport(phoneNumbers, messageText);
      logger.info(`← Bulk SMS Result: ${smsSent ? '✅ Success' : '❌ Failed'}`);
      
      if (smsSent) {
        sendResults.sms.count = smsRecipients.length;
        smsRecipients.forEach(r => {
          sendResults.sms.recipients.push({
            phone: r.phone_number,
            sent: true
          });
        });
      } else {
        smsRecipients.forEach(r => {
          sendResults.sms.recipients.push({
            phone: r.phone_number,
            sent: false
          });
        });
      }
    } catch (error) {
      logger.error(`Exception during bulk SMS send: ${error.message}`);
      smsRecipients.forEach(r => {
        sendResults.sms.recipients.push({
          phone: r.phone_number,
          sent: false,
          error: error.message
        });
      });
    }

    logger.info(`📊 SMS Report Summary - Total Sent: ${sendResults.sms.count}/${smsRecipients.length}`);
    
    if (sendResults.sms.count === 0) {
      logger.error('❌ Failed to send SMS to any recipients');
      res.status(500).json({
        success: false,
        error: 'Failed to send SMS to recipients',
        sendResults
      });
    } else {
      logger.info(`✅ Manual report successfully sent to ${sendResults.sms.count} recipient(s)`);
      res.json({
        success: true,
        message: `Manual report sent to ${sendResults.sms.count} SMS recipient${sendResults.sms.count !== 1 ? 's' : ''}`,
        stats: {
          calls: callStats,
          sms: smsStats
        },
        sendResults
      });
    }
  } catch (error) {
    logger.error(`Manual report generation failed: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// PBX Call History API Endpoints (v1.1.0)
// ========================================

// Query active inbound calls
app.get('/api/pbx-call-history/inbound', async (req, res) => {
  try {
    logger.info(' Querying active inbound calls...');
    const result = await pbxAPI.queryInboundCalls();
    res.json({ 
      success: result.status === 'Success', 
      data: result 
    });
  } catch (error) {
    logger.error(`Query Inbound Calls Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Query active outbound callsadmin
app.get('/api/pbx-call-history/outbound', async (req, res) => {
  try {
    logger.info(' Querying active outbound calls...');
    const result = await pbxAPI.queryOutboundCalls();
    res.json({ 
      success: result.status === 'Success', 
      data: result 
    });
  } catch (error) {
    logger.error(`Query Outbound Calls Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Query all active calls (both inbound and outbound)
app.get('/api/pbx-call-history/active', async (req, res) => {
  try {
    logger.info(' Querying all active calls...');
    const inbound = await pbxAPI.queryInboundCalls();
    const outbound = await pbxAPI.queryOutboundCalls();
    
    res.json({ 
      success: true, 
      data: {
        inbound: inbound.inbound || [],
        outbound: outbound.outbound || [],
        totalActive: (inbound.totalCalls || 0) + (outbound.totalCalls || 0)
      }
    });
  } catch (error) {
    logger.error(`Query All Calls Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download and parse CDR (Call Detail Records) for historical data
app.post('/api/pbx-call-history/cdr', async (req, res) => {
  try {
    const { starttime, endtime, extid = 'all' } = req.body;
    
    if (!starttime || !endtime) {
      return res.status(400).json({
        success: false,
        error: 'starttime and endtime parameters are required (format: YYYY-MM-DD HH:MM:SS)'
      });
    }
    
    logger.info(` Downloading CDR: ext=${extid}, from=${starttime} to=${endtime}`);
    
    const result = await pbxAPI.downloadCDRData(extid, starttime, endtime);
    
    if (result.status === 'Success') {
      res.json({ 
        success: true, 
        data: {
          totalRecords: result.count,
          records: result.data,
          downloadedAt: new Date().toISOString()
        }
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error || 'Failed to download CDR' 
      });
    }
  } catch (error) {
    logger.error(`CDR Download Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get call history for specific extension
app.get('/api/pbx-call-history/extension/:extid', async (req, res) => {
  try {
    const { extid } = req.params;
    const { days = 7, limit = 100 } = req.query;
    
    logger.info(` Getting call history for extension ${extid} (last ${days} days)`);
    
    // Calculate date range
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);
    
    const startStr = startTime.toISOString().split('T')[0] + ' 00:00:00';
    const endStr = endTime.toISOString().split('T')[0] + ' 23:59:59';
    
    // Download CDR for this extension
    const result = await pbxAPI.downloadCDRData(extid, startStr, endStr);
    
    if (result.status === 'Success') {
      // Filter and sort calls
      const callHistory = result.data
        .filter(c => {
          // Filter calls for this extension
          return c.callfrom === extid || c.callto === extid;
        })
        .slice(0, parseInt(limit))
        .map(c => ({
          id: c.cdrid,
          timestamp: c.timestart,
          from: c.callfrom,
          to: c.callto,
          duration: c.callduraction,
          talkDuration: c.talkduraction,
          status: c.status,
          direction: (c.callfrom === extid) ? 'outbound' : 'inbound',
          type: c.type,
          recording: c.recording,
          trunk: c.srctrunkname || c.desttrunkname
        }));
      
      res.json({
        success: true,
        data: {
          extension: extid,
          totalFound: callHistory.length,
          period: { start: startStr, end: endStr },
          history: callHistory
        }
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: result.error || 'Failed to get call history' 
      });
    }
  } catch (error) {
    logger.error(`Extension Call History Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all extensions with their details
app.get('/api/pbx-call-history/extensions', async (req, res) => {
  try {
    logger.info(' Getting all PBX extensions...');
    const result = await pbxAPI.queryExtensions();
    
    res.json({
      success: result.status === 'Success',
      data: {
        totalExtensions: result.totalExtensions,
        extensions: result.extensions || []
      }
    });
  } catch (error) {
    logger.error(`Get Extensions Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get PBX system information
app.get('/api/pbx-call-history/info', async (req, res) => {
  try {
    logger.info(' Getting PBX system information...');
    const result = await pbxAPI.queryPBXInfo();
    
    res.json({
      success: result.status === 'Success',
      data: result.deviceinfo || result
    });
  } catch (error) {
    logger.error(`Get PBX Info Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manual trigger for call record sync (for testing/forcing updates)
app.post('/api/pbx-call-history/sync', async (req, res) => {
  try {
    logger.info(' Manual sync triggered via API');
    await syncCallRecords();
    
    const stats = db.getCallStats();
    res.json({ 
      success: true, 
      message: 'Call records sync completed',
      data: stats
    });
  } catch (error) {
    logger.error(`Manual Sync Error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// SMS Messages Endpoints
// ========================================

// Call records with pagination
app.get('/api/call-records', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    // Support both 'limit' and 'pageSize' parameters
    const limit = parseInt(req.query.limit) || parseInt(req.query.pageSize) || 50;
    const pageSize = Math.min(limit, 10000); // Cap at 10000 max
    const offset = (page - 1) * pageSize;
    const extension = req.query.extension;
    const direction = req.query.direction;
    const status = req.query.status;
    
    let countQuery, dataQuery, params = [];
    let whereConditions = [];
    
    // Build where conditions based on filters
    if (extension) {
      whereConditions.push('(cr.extension = ? OR cr.caller_number = ? OR cr.callee_number = ?)');
      params.push(extension, extension, extension);
    }
    
    if (direction) {
      whereConditions.push('cr.direction = ?');
      params.push(direction);
    }
    
    if (status) {
      whereConditions.push('cr.status = ?');
      params.push(status);
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // Count query
    countQuery = `SELECT COUNT(*) as total FROM call_records cr ${whereClause}`;
    
    // Data query
    dataQuery = `
      SELECT 
        cr.*,
        ce_caller.username as caller_extension_username,
        ce_callee.username as callee_extension_username
      FROM call_records cr
      LEFT JOIN pbx_extensions ce_caller ON cr.caller_number = ce_caller.extnumber
      LEFT JOIN pbx_extensions ce_callee ON cr.callee_number = ce_callee.extnumber
      ${whereClause}
      ORDER BY cr.start_time DESC
      LIMIT ? OFFSET ?
    `;
    
    // Add pagination params
    params.push(pageSize, offset);
    
    const { total } = db.db.prepare(countQuery).get(...params.slice(0, params.length - 2));
    const records = db.db.prepare(dataQuery).all(...params);
    
    res.json({ 
      success: true, 
      data: records,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/call-stats', (req, res) => {
  try {
    const stats = db.getCallStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all-time call statistics
app.get('/api/call-stats/all-time', (req, res) => {
  try {
    const stats = db.getAllTimeCallStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/sms-messages', (req, res) => {
  try {
    const {
      sim_port,
      status,
      since,
      limit = 100
    } = req.query;

    const filters = { limit: parseInt(limit) };
    if (sim_port) filters.sim_port = parseInt(sim_port);
    if (status) filters.status = status;
    if (since) filters.since = since;

    const messages = db.getSMSMessages(filters);
    const responseData = { success: true, data: messages, count: messages.length };
    
    res.json(responseData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sms-messages', (req, res) => {
  try {
    const success = db.insertSMS(req.body);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: 'Failed to save SMS message' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sms-messages/bulk', (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, error: 'Messages array is required' });
    }
    const success = db.saveBulkSMS(messages);
    if (success) {
      res.json({ success: true, count: messages.length });
    } else {
      res.status(400).json({ success: false, error: 'Failed to save bulk SMS messages' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/sms-messages/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: 'Status is required' });
    }

    const success = db.updateSMSStatus(id, status);
    if (success) {
      res.json({ success: true, message: 'SMS status updated' });
    } else {
      res.status(404).json({ success: false, error: 'SMS not found or status unchanged' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/sms-messages/:id', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    // Decode token to get user role (format: user.id:user.role)
    const [userId, userRole] = token.split(':');
    
    // Only admin and operator can delete, viewer cannot
    if (userRole === 'viewer') {
      return res.status(403).json({ success: false, error: 'Viewers cannot delete messages' });
    }
    
    const { id } = req.params;
    const success = db.deleteSMS(id);
    if (success) {
      db.logActivity('sms_deleted', `SMS ${id} deleted by ${userRole}`, 'success');
      res.json({ success: true, message: 'SMS deleted' });
    } else {
      res.status(404).json({ success: false, error: 'SMS not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// GSM Span Configuration Endpoints
// ========================================

app.get('/api/gsm-spans', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT gsm_span, name, phone_number, is_active, signal_strength, carrier, last_active_check
      FROM gsm_span_config
      ORDER BY gsm_span ASC
    `).all();

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/gsm-spans/:gsm_span', (req, res) => {
  try {
    const { gsm_span } = req.params;
    const data = db.prepare(`
      SELECT gsm_span, name, phone_number, is_active, signal_strength, carrier, last_active_check
      FROM gsm_span_config
      WHERE gsm_span = ?
    `).get(parseInt(gsm_span));

    if (!data) {
      return res.status(404).json({ success: false, error: 'GSM span not found' });
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/gsm-spans/:gsm_span', (req, res) => {
  try {
    const { gsm_span } = req.params;
    const { name, phone_number } = req.body;

    const updated = db.prepare(`
      UPDATE gsm_span_config 
      SET name = ?, phone_number = ?, updated_at = CURRENT_TIMESTAMP
      WHERE gsm_span = ?
    `).run(name || null, phone_number || null, parseInt(gsm_span));

    if (updated.changes > 0) {
      res.json({ success: true, message: `GSM span ${gsm_span} updated` });
      db.logActivity('gsm_span_configured', `GsmSpan ${gsm_span} name/phone updated`, 'success', parseInt(gsm_span));
    } else {
      res.status(404).json({ success: false, error: 'GSM span not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Force immediate check of active GSM spans from TG400 hardware
app.post('/api/check-gsm-spans', async (req, res) => {
  try {
    logger.info('[MANUAL CHECK] User triggered GSM span check');
    
    // Run the check immediately
    await checkActiveGsmSpans();
    
    // Return fresh data from database
    const data = db.prepare(`
      SELECT gsm_span, name, phone_number, is_active, signal_strength, carrier, last_active_check
      FROM gsm_span_config
      ORDER BY gsm_span ASC
    `).all();
    
    res.json({ 
      success: true,
      message: 'GSM spans check completed',
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Failed to check GSM spans: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================

app.get('/api/port-status', (req, res) => {
  try {
    const { port_number } = req.query;
    let data;

    if (port_number) {
      data = db.getPortStatus(parseInt(port_number));
    } else {
      data = db.getPortStatus();
    }

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/port-status/:port_number', (req, res) => {
  try {
    const { port_number } = req.params;
    const statusData = req.body;

    const success = db.updatePortStatus(parseInt(port_number), statusData);
    if (success) {
      res.json({
        success: true,
        message: 'Port status updated',
        data: db.getPortStatus(parseInt(port_number))
      });
    } else {
      throw new Error('Failed to update port status');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Activity Logs Endpoints
// ========================================

app.get('/api/activity-logs', (req, res) => {
  try {
    const { severity, limit = 500 } = req.query;

    const filters = { limit: parseInt(limit) };
    if (severity) filters.severity = severity;

    const logs = db.getActivityLogs(filters);
    res.json({ success: true, data: logs, count: logs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/activity-logs', (req, res) => {
  try {
    const { event_type, message, severity = 'info', sim_port = null } = req.body;

    if (!event_type || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'event_type and message are required' 
      });
    }

    const log = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      event_type,
      message,
      severity,
      sim_port,
      created_at: new Date().toISOString(),
    };

    db.addActivityLog(log);
    res.status(201).json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Statistics Endpoint
// ========================================

app.get('/api/statistics', async (req, res) => {
  try {
    const stats = db.getStatistics();
    
    // Get live port status from TG400 if available
    let portStatus = stats.portStatus || [];
    
    if (tg400Api && tg400Api.isConnected) {
      try {
        const ports = await tg400Api.getAllPortsInfo();
        portStatus = ports.map(p => ({
          portNumber: p.portNumber || p.port_number,
          port_number: p.portNumber || p.port_number,
          status: p.status,
          enabled: (p.isPowerOn && p.isProvisioned) ? 1 : 0,
          isUp: p.isUp,
          isPowerOn: p.isPowerOn,
          isProvisioned: p.isProvisioned
        }));
      } catch (error) {
        logger.debug('Could not fetch live port status from TG400: %s', error.message);
        // Fall back to database data
      }
    }
    
    res.json({ success: true, data: { ...stats, portStatus } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get available ports from TG400
app.get('/api/available-ports', async (req, res) => {
  try {
    if (!tg400Api || !tg400Api.isConnected) {
      return res.status(503).json({
        success: false,
        error: 'Gateway not connected',
        ports: []
      });
    }

    logger.debug('[API] Querying TG400 for available ports...');
    const ports = await tg400Api.getAllPortsInfo();
    logger.debug(`[API] Found ${ports.length} ports on TG400`);
    
    res.json({
      success: true,
      ports: ports.map(p => ({
        portNumber: p.portNumber,
        status: p.status,
        isUp: p.isUp,
        isPowerOn: p.isPowerOn,
        isProvisioned: p.isProvisioned,
      }))
    });
  } catch (error) {
    logger.error('[API] Error getting available ports: %s', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      ports: []
    });
  }
});

// DEBUG: Inject SMS (test endpoint to reproduce incoming SMS handling)
app.post('/api/debug/inject-sms', (req, res) => {
  try {
    const { sender, content, port = 1, external_id } = req.body;
    if (!sender || !content) return res.status(400).json({ success: false, error: 'sender and content required' });

    const sms = {
      id: external_id || `dbg-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      sender,
      content,
      port,
      received_at: new Date().toISOString()
    };

    // reuse same logic as sms-received handler
    try {
      const normalized = (sms.content || '').replace(/\+/g, ' ');
      const messageContent = (() => {
        try { return decodeURIComponent(normalized); } catch(e) { return normalized; }
      })();

      const inserted = db.insertSMS({
        external_id: sms.id,
        sender_number: sms.sender,
        message_content: messageContent,
        sim_port: sms.port,
        received_at: sms.received_at,
        status: 'unread'
      });

      if (inserted) {
        db.logActivity('sms_injected', `Injected SMS from ${sms.sender}`, 'success', sms.port);
        return res.json({ success: true, message: 'Injected', id: sms.id });
      }
      db.logActivity('sms_injected_failed', `Failed to inject SMS from ${sms.sender}`, 'error', sms.port);
      alertErrorImmediately('SMS Inject Failed', `Failed to inject SMS from ${sms.sender}`);
      return res.status(500).json({ success: false, error: 'Failed to insert' });
    } catch (err) {
      logErrorToFile(err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Manual Sync Endpoints
// ========================================

// Manually trigger a call sync (when tg400Agent is running separately)
app.post('/api/sync/calls', (req, res) => {
  try {
    logger.info(' Manual call sync request - Agent polls every 60 seconds automatically');
    
    // Get latest call to show when last one was synced
    const lastCall = db.db.prepare(`
      SELECT id, external_id, caller_number, start_time, created_at 
      FROM call_records 
      ORDER BY created_at DESC 
      LIMIT 1
    `).get();
    
    res.json({ 
      success: true, 
      message: 'Call sync request noted (automatic polling runs every 60 seconds)',
      last_call_synced: lastCall || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get sync status from database
app.get('/api/sync/status', (req, res) => {
  try {
    const stats = db.getStatistics();
    const lastCall = db.db.prepare(`
      SELECT id, external_id, caller_number, callee_number, start_time, created_at, direction, status
      FROM call_records 
      ORDER BY created_at DESC 
      LIMIT 1
    `).get();
    
    const lastSms = db.db.prepare(`
      SELECT id, external_id, sender_number, message_content, received_at, created_at
      FROM sms_messages 
      ORDER BY created_at DESC 
      LIMIT 1
    `).get();
    
    res.json({
      success: true,
      data: {
        total_calls: stats.totalCalls || 0,
        total_messages: stats.totalMessages || 0,
        unread_messages: stats.unreadMessages || 0,
        last_call_synced: lastCall || null,
        last_sms_synced: lastSms || null,
        polling_intervals: {
          sms_poll_interval_ms: process.env.POLL_INTERVAL || 30000,
          cdr_poll_interval_ms: process.env.CDR_POLL_INTERVAL || 60000,
          note: 'SMS polls every 30 seconds, Calls poll every 60 seconds'
        },
        current_time: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Agent Heartbeat Endpoints
// ========================================

app.post('/api/agent-heartbeat', (req, res) => {
  try {
    const { agent_id } = req.body;

    if (!agent_id) {
      return res.status(400).json({ success: false, error: 'agent_id is required' });
    }

    const success = db.updateHeartbeat(agent_id, req.body);
    if (success) {
      res.json({ success: true, message: 'Heartbeat recorded' });
    } else {
      throw new Error('Failed to record heartbeat');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/agent-heartbeat', (req, res) => {
  try {
    const { agent_id } = req.query;
    const data = db.getHeartbeat(agent_id);
    
    // If no agent_id provided and we get an array, return the latest heartbeat
    if (!agent_id && Array.isArray(data) && data.length > 0) {
      res.json({ success: true, data: data[0] });
    } else {
      res.json({ success: true, data });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Error handling
// ========================================

app.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// Test missed call alert
app.post('/api/test-missed-call-alert', async (req, res) => {
  try {
    const telegramConfig = db.getTelegramConfig();
    
    if (!telegramConfig?.enabled || !telegramConfig?.bot_token || !telegramConfig?.chat_id) {
      return res.status(400).json({
        success: false,
        error: 'Telegram not configured. Please enable Telegram and set bot token and chat ID.'
      });
    }

    // Create a test missed call record
    const testCallRecord = {
      external_id: `test-missed-${Date.now()}`,
      caller_number: '254792064926',
      callee_number: '',
      caller_name: 'Test Caller',
      extension: '101',
      direction: 'inbound',
      status: 'missed',
      start_time: new Date().toISOString(),
      answer_time: null,
      ring_duration: 15,
      created_at: new Date().toISOString()
    };

    // Save test call record
    const saved = db.saveCallRecord(testCallRecord);
    
    if (!saved) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create test missed call record'
      });
    }

    // Send test alert
    const botToken = telegramConfig.bot_token;
    const chatId = telegramConfig.chat_id;
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

    let messageText = '📞 *MISSED CALL ALERT (TEST)*\n\n';
    messageText += `*Status:* Missed Call\n`;
    messageText += `*From:* \`${testCallRecord.caller_number}\`\n`;
    messageText += `*Name:* ${testCallRecord.caller_name}\n`;
    messageText += `*To Extension:* \`${testCallRecord.extension}\`\n`;
    messageText += `*Time:* ${new Date(testCallRecord.start_time).toLocaleTimeString()}\n`;
    messageText += ` *Ring Duration:* ${testCallRecord.ring_duration}s\n`;
    messageText += ` *Date:* ${new Date(testCallRecord.start_time).toLocaleDateString()}\n`;
    messageText += `\nThis is a test message to verify Telegram integration is working correctly.`;

    const payload = {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'Markdown'
    };

    logger.info(' Sending test missed call alert to Telegram...');

    const tgResp = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const tgJson = await tgResp.json();

    if (tgResp.ok && tgJson.ok) {
      logger.info('Test missed call alert sent successfully');
      db.logActivity('telegram_test_missed_call_alert', 'Test missed call alert sent successfully', 'success');
      
      res.json({
        success: true,
        message: 'Test missed call alert sent successfully to Telegram',
        testCall: {
          id: testCallRecord.external_id,
          from: testCallRecord.caller_number,
          to: testCallRecord.extension,
          time: new Date(testCallRecord.start_time).toLocaleTimeString()
        }
      });
    } else {
      logger.error(` Failed to send test alert: ${tgJson.description || 'Unknown error'}`);
      db.logActivity('telegram_test_missed_call_alert_failed', `Failed to send test alert: ${tgJson.description}`, 'error');
      
      res.status(500).json({
        success: false,
        error: `Failed to send Telegram message: ${tgJson.description || 'Unknown error'}`
      });
    }
  } catch (error) {
    logger.error(`Test missed call alert error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// SMS Gateway Automation Endpoints
// ========================================






// Get Business Hours for Rule
app.get('/api/business-hours/:rule_id', (req, res) => {
  try {
    const { rule_id } = req.params;
    const hours = db.db.prepare(`SELECT * FROM business_hours WHERE rule_id = ?`).all(rule_id);
    const parsed = hours.map(h => ({
      ...h,
      days_enabled: JSON.parse(h.days_enabled || '[]')
    }));
    res.json({ success: true, data: parsed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create Business Hours
app.post('/api/business-hours', (req, res) => {
  try {
    const { rule_id, start_time, end_time, days_enabled } = req.body;
    if (!rule_id || !start_time || !end_time || !days_enabled) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    const id = crypto.randomBytes(8).toString('hex');
    const daysJson = JSON.stringify(days_enabled);
    const stmt = db.db.prepare(`
      INSERT INTO business_hours (id, rule_id, start_time, end_time, days_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    stmt.run(id, rule_id, start_time, end_time, daysJson);

    const hours = db.db.prepare(`SELECT * FROM business_hours WHERE id = ?`).get(id);
    res.status(201).json({ success: true, data: { ...hours, days_enabled: JSON.parse(hours.days_enabled) } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete Business Hours
app.delete('/api/business-hours/:id', (req, res) => {
  try {
    const { id } = req.params;
    const stmt = db.db.prepare(`DELETE FROM business_hours WHERE id = ?`);
    const info = stmt.run(id);

    if (info.changes > 0) {
      res.json({ success: true, message: 'Business hours deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Business hours not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// DEBUG ENDPOINTS - Missed Call Alert Diagnostics
// ========================================

// DEBUG: Check Telegram configuration
app.get('/api/debug/telegram-config', (req, res) => {
  try {
    const telegramConfig = db.getTelegramConfig();
    res.json({
      success: true,
      config: {
        enabled: telegramConfig?.enabled || 0,
        bot_token: telegramConfig?.bot_token ? '***' + telegramConfig.bot_token.slice(-4) : 'NOT SET',
        chat_id: telegramConfig?.chat_id || 'NOT SET',
        created_at: telegramConfig?.created_at,
        updated_at: telegramConfig?.updated_at
      },
      configOK: !!(telegramConfig?.enabled && telegramConfig?.bot_token && telegramConfig?.chat_id),
      note: 'enabled flag must be 1 or true for alerts to work'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Check recent missed calls in database
app.get('/api/debug/missed-calls', (req, res) => {
  try {
    const telegramConfig = db.getTelegramConfig();
    const startTime = telegramConfig?.updated_at || telegramConfig?.created_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Get missed calls from multiple status values
    const missedCalls = db.db.prepare(`
      SELECT id, status, answer_time, created_at, start_time, caller_number, extension, total_duration
      FROM call_records 
      WHERE status IN ('missed', 'no-answer', 'noanswer', 'failed')
      ORDER BY created_at DESC 
      LIMIT 50
    `).all();

    // Get calls from when Telegram was enabled (this is what checkAndAlertMissedCalls uses NOW)
    const alertableeMissed = db.db.prepare(`
      SELECT id, status, answer_time, created_at, start_time, caller_number, extension, total_duration
      FROM call_records 
      WHERE status IN ('missed', 'no-answer', 'noanswer', 'failed')
        AND start_time >= ?
        AND (answer_time IS NULL OR answer_time = '')
      ORDER BY created_at DESC
    `).all(startTime);

    res.json({
      success: true,
      telegram_enabled_since: startTime,
      all_missed_calls_count: missedCalls.length,
      alertable_missed_calls_count: alertableeMissed.length,
      alertable_missed_calls: alertableeMissed,
      all_missed_calls_sample: missedCalls.slice(0, 10),
      diagnostic_info: {
        missed_call_statuses: ['missed', 'no-answer', 'noanswer', 'failed'],
        query_logic: [
          'Check calls with status IN (missed, no-answer, noanswer, failed)',
          'Filter by start_time >= Telegram enabled time (UTC)',
          'Confirm answer_time IS NULL OR empty',
          'Send Telegram alert for each unique call'
        ],
        timezone_info: 'Database stores in UTC, frontend displays in Nairobi time (UTC+3)'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Check notification tracking
app.get('/api/debug/notification-tracking', (req, res) => {
  try {
    const recentAlerts = db.db.prepare(`
      SELECT id, event_type, message, severity, created_at 
      FROM activity_logs 
      WHERE event_type IN ('telegram_missed_call_alert', 'telegram_missed_call_alert_failed')
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    res.json({
      success: true,
      notified_calls_in_memory: notifiedMissedCalls.size,
      recent_telegram_alerts: recentAlerts,
      note: 'In-memory Set tracks notified calls; clearing app resets it'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Check call record statuses
app.get('/api/debug/call-statuses', (req, res) => {
  try {
    const statusDistribution = db.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM call_records 
      GROUP BY status
      ORDER BY count DESC
    `).all();

    const recentCalls = db.db.prepare(`
      SELECT id, status, answer_time, caller_number, callee_number, created_at, start_time
      FROM call_records 
      ORDER BY created_at DESC
      LIMIT 20
    `).all();

    res.json({
      success: true,
      status_distribution: statusDistribution,
      recent_calls: recentCalls,
      total_calls: recentCalls.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Force check missed calls manually
app.post('/api/debug/force-check-missed-calls', async (req, res) => {
  try {
    logger.info('[DEBUG] Manually triggering checkAndAlertMissedCalls...');
    const resultMsg = await checkAndAlertMissedCalls();
    
    res.json({
      success: true,
      message: 'Triggered missed call check',
      result: resultMsg || 'Check completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Check recent error alerts
app.get('/api/debug/error-alerts', (req, res) => {
  try {
    const recentErrors = db.db.prepare(`
      SELECT id, event_type, message, severity, created_at 
      FROM activity_logs 
      WHERE event_type IN ('error', 'error_alert_sent', 'telegram_error_alert', 'sms_handler_error', 'call_sync_error')
      ORDER BY created_at DESC
      LIMIT 30
    `).all();

    const telegramConfig = db.getTelegramConfig();

    res.json({
      success: true,
      telegram_enabled: !!telegramConfig?.enabled,
      telegram_configured: !!(telegramConfig?.bot_token && telegramConfig?.chat_id),
      recent_errors_count: recentErrors.length,
      recent_errors: recentErrors,
      note: 'Errors are sent to Telegram instantly when they occur (if enabled)',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Inject test error
app.post('/api/debug/inject-error', async (req, res) => {
  try {
    const testError = 'Test system error - this should trigger Telegram alert immediately';
    logger.info('🔍 [DEBUG] Injecting test error...');
    
    // Log the error
    db.logActivity('test_error_injected', testError, 'error');
    
    // Send alert immediately
    await alertErrorImmediately('Test Error (Debug)', testError);
    
    res.json({
      success: true,
      message: 'Test error injected and alert sent',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Inject test missed call
app.post('/api/debug/inject-missed-call', (req, res) => {
  try {
    const testCallId = `test-missed-${Date.now()}`;
    const testCall = {
      external_id: testCallId,
      caller_number: '1234567890',
      callee_number: '200',
      direction: 'inbound',
      status: 'missed',
      extension: '200',
      start_time: new Date().toISOString(),
      answer_time: null,
      end_time: new Date().toISOString(),
      ring_duration: 30,
      talk_duration: 0,
      total_duration: 30,
      metadata: { test: true }
    };

    const success = db.saveCallRecord(testCall);
    
    res.json({
      success: success,
      message: success ? `Injected test missed call: ${testCallId}` : 'Failed to inject',
      call_id: testCallId,
      call: testCall
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Manually trigger missed call alert check
app.post('/api/debug/trigger-missed-call-alerts', async (req, res) => {
  try {
    logger.info('🔔 MANUAL TRIGGER: Running missed call alert check...');
    const result = await checkAndAlertMissedCalls();
    res.json({
      success: true,
      message: 'Missed call alert check triggered',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Manual trigger error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Reset notification tracking and force re-send all missed call alerts
app.post('/api/debug/reset-notifications', async (req, res) => {
  try {
    const previousCount = notifiedMissedCalls.size;
    notifiedMissedCalls.clear();
    
    logger.info(`Reset notification tracking: Cleared ${previousCount} tracked calls`);
    
    // Force check for missed calls (will send alerts for all)
    logger.info('Forcing immediate check for all missed calls...');
    await checkAndAlertMissedCalls();
    
    res.json({
      success: true,
      message: `Notification tracking reset. Cleared ${previousCount} tracked calls and sent fresh alerts.`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Check which missed calls have already been notified
app.get('/api/debug/notified-calls', (req, res) => {
  try {
    const telegramConfig = db.getTelegramConfig();
    const startTime = telegramConfig?.updated_at || telegramConfig?.created_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Get all missed calls
    const allMissedCalls = db.db.prepare(`
      SELECT id, external_id, caller_number, extension, start_time, ring_duration
      FROM call_records 
      WHERE status IN ('missed', 'no-answer', 'noanswer', 'failed')
        AND start_time >= ?
        AND (answer_time IS NULL OR answer_time = '')
      ORDER BY start_time DESC
    `).all(startTime);

    // Check which ones have been notified
    const notifiedList = [];
    const pendingList = [];

    for (const call of allMissedCalls) {
      const callKey = call.id || call.external_id;
      if (notifiedMissedCalls.has(callKey)) {
        notifiedList.push({
          ...call,
          status: 'NOTIFIED'
        });
      } else {
        pendingList.push({
          ...call,
          status: 'PENDING'
        });
      }
    }

    res.json({
      success: true,
      telegram_enabled_since: startTime,
      total_missed_calls: allMissedCalls.length,
      notified_count: notifiedList.length,
      pending_count: pendingList.length,
      notified_calls: notifiedList.slice(0, 20),
      pending_calls: pendingList.slice(0, 20),
      internal_tracking_size: notifiedMissedCalls.size,
      note: 'Use POST /api/debug/reset-notifications to clear tracking and re-send all alerts'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use((req, res) => {
  logger.warn(`[404-HANDLER] Unmatched request: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// ========================================
// CONTACTS API ENDPOINTS
// ========================================

app.get('/api/contacts', (req, res) => {
  try {
    const contacts = db.getContacts();
    res.json({ success: true, data: contacts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/contacts/:id', (req, res) => {
  try {
    const contact = db.getContact(req.params.id);
    if (!contact) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }
    res.json({ success: true, data: contact });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/contacts/:id', (req, res) => {
  try {
    const { name, notes } = req.body;
    const success = db.updateContact(req.params.id, { name, notes });
    
    if (success) {
      const updated = db.getContact(req.params.id);
      res.json({ success: true, data: updated });
    } else {
      res.status(400).json({ success: false, error: 'Failed to update contact' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/contacts/import', (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts)) {
      return res.status(400).json({ success: false, error: 'Contacts must be an array' });
    }
    
    const imported = db.importContacts(contacts);
    res.json({ success: true, data: { imported } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/contacts/merge', (req, res) => {
  try {
    const merged = db.mergeDuplicateContacts();
    res.json({ success: true, data: { merged } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Google Contacts Integration (Placeholder)
// ========================================
// Note: Full Google Contacts API integration requires:
// 1. Google OAuth 2.0 credentials (Client ID, Client Secret)
// 2. Google People API enabled in Google Cloud Console
// 3. Backend token refresh handling
// 4. Contact sync/merge logic with Google

app.post('/api/contacts/import-from-google', (req, res) => {
  try {
    const { googleToken } = req.body;
    
    if (!googleToken) {
      return res.status(400).json({ success: false, error: 'Google token required' });
    }

    // Validate token format (basic check)
    if (typeof googleToken !== 'string' || googleToken.length < 10) {
      return res.status(401).json({ success: false, error: 'Invalid Google token' });
    }

    // TODO: Implement actual Google People API integration
    // For now, return placeholder response
    logger.info('Google Contacts import requested with token');
    
    // In production, this would:
    // 1. Verify token with Google API
    // 2. Fetch contacts from Google People API
    // 3. Map to local contact format
    // 4. Save to database
    // 5. Return imported count

    res.json({ 
      success: true, 
      data: { 
        imported: 0,
        total_found: 0,
        message: 'Google Contacts import requires full OAuth setup. See documentation for setup instructions.'
      } 
    });
  } catch (error) {
    logger.error(`Google import error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/contacts/push-to-google', (req, res) => {
  try {
    const { googleToken } = req.body;
    
    if (!googleToken) {
      return res.status(400).json({ success: false, error: 'Google token required' });
    }

    // Validate token format (basic check)
    if (typeof googleToken !== 'string' || googleToken.length < 10) {
      return res.status(401).json({ success: false, error: 'Invalid Google token' });
    }

    // TODO: Implement actual Google People API integration
    // For now, return placeholder response
    logger.info('Google Contacts push requested with token');
    
    // In production, this would:
    // 1. Verify token with Google API
    // 2. Fetch all local contacts
    // 3. Check existing Google contacts
    // 4. Create/update contacts in Google
    // 5. Return created/updated/skipped counts

    res.json({ 
      success: true, 
      data: { 
        created: 0,
        updated: 0,
        skipped: 0,
        message: 'Google Contacts push requires full OAuth setup. See documentation for setup instructions.'
      } 
    });
  } catch (error) {
    logger.error(`Google push error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Debug: Extension Call Statistics
// ========================================
app.get('/api/debug/extension/:extnumber', (req, res) => {
  try {
    const { extnumber } = req.params;
    
    // Check extension in pbx_extensions
    const ext = db.db.prepare('SELECT extnumber, username, callerid FROM pbx_extensions WHERE extnumber = ?').get(extnumber);
    
    // Direct raw query to see what's in database
    const raw = db.db.prepare(`
      SELECT 
        id, caller_number, callee_number, extension, direction, status, start_time
      FROM call_records 
      WHERE extension = ? OR caller_number = ? OR callee_number = ?
      ORDER BY start_time DESC
      LIMIT 100
    `).all(extnumber, extnumber, extnumber);
    
    const byMethod = db.getCallRecordsByExtension(extnumber, 100);
    
    // Check if callerid can match calls
    const byCallerId = ext ? db.db.prepare(`
      SELECT id, caller_number, callee_number, extension FROM call_records
      WHERE caller_number LIKE ? OR callee_number LIKE ?
      LIMIT 20
    `).all(`%${ext.callerid.slice(-9)}`, `%${ext.callerid.slice(-9)}`) : [];
    
    res.json({
      success: true,
      extnumber,
      extension_info: ext,
      raw_query_count: raw.length,
      raw_query_sample: raw.slice(0, 3),
      method_count: byMethod.length,
      method_sample: byMethod.slice(0, 3),
      by_callerid_count: byCallerId.length,
      by_callerid_sample: byCallerId.slice(0, 3)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/debug/extension-call-stats', (req, res) => {
  try {
    // Get overall call count
    const allCalls = db.getCallRecords(null);
    const totalCalls = allCalls.length;
    
    // Get stats by extension
    const extensionStats = {};
    for (const call of allCalls) {
      // Track calls by extension, caller, and callee
      if (call.extension) {
        extensionStats[call.extension] = (extensionStats[call.extension] || 0) + 1;
      }
      if (call.caller_number && /^\d{1,4}$/.test(call.caller_number)) {
        extensionStats[call.caller_number] = (extensionStats[call.caller_number] || 0) + 1;
      }
      if (call.callee_number && /^\d{1,4}$/.test(call.callee_number)) {
        extensionStats[call.callee_number] = (extensionStats[call.callee_number] || 0) + 1;
      }
    }
    
    res.json({
      success: true,
      data: {
        totalCalls,
        extensionStats,
        extensionCount: Object.keys(extensionStats).length,
      }
    });
  } catch (error) {
    logger.error(`Extension stats error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Initialize GSM Spans
// ========================================
function ensureGsmSpansExist() {
  try {
    logger.info('[GSM INIT] Ensuring all 4 GSM spans (2-5) exist in database...');
    
    // GsmSpan: 2, 3, 4, 5 (corresponding to TG400 GSM ports)
    const gsmSpans = [2, 3, 4, 5];
    
    for (const gsmSpan of gsmSpans) {
      const existing = db.prepare(`
        SELECT id FROM gsm_span_config WHERE gsm_span = ?
      `).get(gsmSpan);
      
      if (!existing) {
        logger.info(`[GSM INIT] Creating GsmSpan ${gsmSpan}`);
        db.prepare(`
          INSERT INTO gsm_span_config (gsm_span, is_active)
          VALUES (?, 1)
        `).run(gsmSpan);
      } else {
        logger.debug(`[GSM INIT] GsmSpan ${gsmSpan} already exists`);
      }
    }
    
    // Log current spans
    const allSpans = db.prepare(`
      SELECT gsm_span, name, is_active FROM gsm_span_config ORDER BY gsm_span
    `).all();
    
    logger.info(`[GSM INIT] Current GSM spans in database:`, 
      allSpans.map(s => ({ gsm_span: s.gsm_span, name: s.name || 'Not named', is_active: s.is_active }))
    );
  } catch (error) {
    logger.error(`[GSM INIT] Error ensuring GSM spans exist: ${error.message}`);
  }
}

// ========================================
// Start server
// ========================================

const server = app.listen(PORT, HOST, () => {
  console.log('\n');
  logger.info('╔════════════════════════════════════════════════════╗');
  logger.info('║   TG400 SMS Gateway - Local API Server Started     ║');
  logger.info('╚════════════════════════════════════════════════════╝');
  logger.info('Server running on http://%s:%d', HOST === '0.0.0.0' ? 'localhost' : HOST, PORT);
  logger.info('Database: %s', dbPath);
  logger.info('Starting SMS listener service...\n');

  // Ensure all ports exist
  ensureGsmSpansExist();

  // Start SMS Listener automatically
  startSmsListener();
  
  // Start 12-hour GSM span active check
  startGsmSpanCheckInterval();

  logger.debug('Available endpoints: POST /api/auth/login, POST /api/auth/register, POST /api/auth/logout, GET /api/health, GET /api/gateway-config, POST /api/gateway-config, GET /api/pbx-config, POST /api/pbx-config, GET /api/sms-messages, PUT /api/sms-messages/:id/status, GET /api/gsm-spans, GET /api/gsm-spans/:gsm_span, PUT /api/gsm-spans/:gsm_span, GET /api/port-status, PUT /api/port-status/:port_number, GET /api/activity-logs, POST /api/activity-logs, GET /api/statistics, GET /api/available-ports, POST /api/agent-heartbeat, GET /api/agent-heartbeat, GET /api/users/profile/me, PUT /api/users/profile/me, GET /api/tg400-ports, GET /api/sim-ports, GET /api/sim-port/:port, PUT /api/sim-port/:port/label');
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down server (SIGINT)');
  db.close();
  server.close(() => {
    logger.info('Server stopped');
    process.exit(0);
  });
});

// ========================================
// GSM Span Active Status Check (Every 12 hours)
// ========================================
async function checkActiveGsmSpans() {
  try {
    logger.info('[GSM CHECK] Checking active GSM spans from TG400...');
    
    const ports = await tg400Api.getAllPortsInfo();
    if (ports && Array.isArray(ports)) {
      logger.debug(`[GSM CHECK] TG400 returned ${ports.length} ports:`);
      ports.forEach(p => logger.debug(`  - GsmSpan ${p.portNumber}: ${p.status}`));
      
      // Map port info to GsmSpan (portNumber from TG400 is already 2-5)
      const activeSpans = ports
        .map(port => {
          // Port is active if it has isUp status (which now properly checks for Power On/Off)
          const isActive = (port.isUp === true) ? 1 : 0;
          return {
            gsm_span: port.portNumber,  // TG400 portNumber is already the GSM span (2-5)
            is_active: isActive,
            signal_strength: port.signalLevel || port.signal || 0,
            carrier: port.carrier || port.sim_carrier || null,
            phone_number: port.phoneNumber || port.phone_number || null
          };
        });
      
      // Update database with active status
      for (const span of activeSpans) {
        try {
          db.prepare(`
            UPDATE gsm_span_config 
            SET is_active = ?, signal_strength = ?, carrier = ?, phone_number = ?, last_active_check = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE gsm_span = ?
          `).run(span.is_active, span.signal_strength, span.carrier, span.phone_number, span.gsm_span);
          
          const status = span.is_active ? '✅' : '❌';
          logger.info(`${status} GsmSpan ${span.gsm_span}: Active=${span.is_active}, Signal=${span.signal_strength}%, Carrier=${span.carrier || 'N/A'}`);
        } catch (e) {
          logger.warn(`Failed to update GsmSpan ${span.gsm_span}: ${e.message}`);
        }
      }
      
      logger.info(`[GSM CHECK] ✅ GSM span status updated successfully`);
    } else {
      logger.warn(`[GSM CHECK] No ports returned from TG400`);
    }
  } catch (err) {
    logger.error(`[GSM CHECK] Error checking active GSM spans: ${err.message}`);
  }
}

// Start 12-hour GSM span check when app starts
function startGsmSpanCheckInterval() {
  // Run check after 5 seconds to allow TG400 connection to establish
  logger.info(`[GSM CHECK] Scheduling first GSM span check in 5 seconds...`);
  setTimeout(async () => {
    await checkActiveGsmSpans();
  }, 5000);
  
  // Then run every 12 hours (43,200,000 ms)
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  setTimeout(() => {
    setInterval(async () => {
      await checkActiveGsmSpans();
    }, twelveHoursMs);
    logger.info(`[GSM CHECK] GSM span auto-check scheduled every 12 hours`);
  }, 5000);
}

module.exports = app;
