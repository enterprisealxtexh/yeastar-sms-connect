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

// System update state (in-memory)
let updateState = {
  running: false,
  logs: [],
  exitCode: null,
  startedAt: null,
  lastCompletedAt: null,
  lastCheckedAt: null,
  updateAvailable: null,
};

// Backend-only system update config (frontend should not provide these values)
const SYSTEM_UPDATE_REPO = process.env.SYSTEM_UPDATE_REPO || 'https://github.com/enterprisealxtexh/yeastar-sms-connect.git';
const SYSTEM_UPDATE_BRANCH = process.env.SYSTEM_UPDATE_BRANCH || 'main';
const SYSTEM_UPDATE_TOKEN = process.env.SYSTEM_UPDATE_TOKEN || process.env.GITHUB_TOKEN || '';

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

// --- Local User / Role API Endpoints ---
// Provide simple endpoints to manage users and roles in the local SQLite DB.

// Middleware: require authenticated user with one of the allowed roles
// Token format: "userId:role" (set at login)
const requireRole = (...allowedRoles) => (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const [userId, tokenRole] = token.split(':');
  if (!userId || !tokenRole) return res.status(401).json({ success: false, error: 'Invalid token' });

  // Always look up the live role from DB (tokens can't be stale this way)
  const dbUser = db.db.prepare(
    `SELECT COALESCE(ur.role, u.role) as role, u.is_active 
     FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id 
     WHERE u.id = ?`
  ).get(userId);

  if (!dbUser || !dbUser.is_active) return res.status(401).json({ success: false, error: 'Unauthorized' });
  if (!allowedRoles.includes(dbUser.role)) return res.status(403).json({ success: false, error: 'Forbidden: insufficient role' });

  req.currentUserId = userId;
  req.currentUserRole = dbUser.role;
  next();
};

// Middleware: any authenticated user (sets req.currentUserId and req.currentUserRole)
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const [userId, tokenRole] = token.split(':');
  if (!userId || !tokenRole) return res.status(401).json({ success: false, error: 'Invalid token' });

  const dbUser = db.db.prepare(
    `SELECT COALESCE(ur.role, u.role) as role, u.is_active 
     FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id 
     WHERE u.id = ?`
  ).get(userId);

  if (!dbUser || !dbUser.is_active) return res.status(401).json({ success: false, error: 'Unauthorized' });

  req.currentUserId = userId;
  req.currentUserRole = dbUser.role;
  next();
};

app.get('/api/users', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const users = db.getAllUsers ? db.getAllUsers() : [];
    logger.info(`[GET /api/users] Returning ${users.length} users`);
    if (users.length > 0) {
      logger.debug(`[GET /api/users] Users: ${users.map(u => `${u.email}(${u.role})`).join(', ')}`);
    } else {
      logger.warn('[GET /api/users] ⚠️ No users found in database!');
    }
    res.json({ success: true, users });
  } catch (error) {
    logger.error('GET /api/users error: %s', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/users', requireRole('super_admin'), (req, res) => {
  try {
    const { email, password, name, role = 'operator', pin = null, telegram_chat_id = null, notification_channel = 'telegram' } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'email and password required' });

    const created = db.createUser ? db.createUser({ email, password, name, role, pin, telegram_chat_id, notification_channel }) : false;
    if (!created) return res.status(500).json({ success: false, error: 'failed to create user' });

    const newUser = db.getUserByEmail(email);
    res.json({ 
      success: true, 
      user_id: newUser?.id,
      data: { user_id: newUser?.id, id: newUser?.id, email: newUser?.email, name: newUser?.name, role: newUser?.role },
      users: db.getAllUsers ? db.getAllUsers() : []
    });
  } catch (error) {
    logger.error('POST /api/users error: %s', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/users/:id/role', requireRole('super_admin'), (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;
    if (!userId || !role) return res.status(400).json({ success: false, error: 'user id and role required' });

    const updated = db.setUserRole ? db.setUserRole(userId, role) : false;
    if (!updated) return res.status(500).json({ success: false, error: 'failed to update role' });

    res.json({ success: true });
  } catch (error) {
    logger.error('PUT /api/users/:id/role error: %s', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


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
// Service start time — only calls at or after this UTC moment get auto-SMS.
// This prevents historical CDR backfill from ever triggering messages.
// ========================================
const SERVICE_START_UTC_MS = Date.now();
logger.info(`Service start time (UTC): ${new Date(SERVICE_START_UTC_MS).toISOString()}`);

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
    
    // Prefer the v1.1.0 CDR download flow, but fall back to the query API when PBX permissions or modules block it.
    let cdrResult = await pbxAPI.downloadCDRData('all', `${startDate} 00:00:00`, `${now} 23:59:59`);

    if (!cdrResult || cdrResult.status !== 'Success' || !Array.isArray(cdrResult.data)) {
      logger.warn(` CDR download failed, trying query fallback: ${cdrResult?.error || 'Unknown error'}`);

      try {
        const fallbackResult = await pbxAPI.queryCDR(startDate, now, 5000);
        if (fallbackResult && fallbackResult.status === 'Success' && Array.isArray(fallbackResult.data)) {
          cdrResult = fallbackResult;
          logger.info(` CDR query fallback returned ${fallbackResult.data.length} records`);
        } else {
          logger.warn(` CDR query fallback returned no usable data: ${fallbackResult?.error || 'Unknown error'}`);
        }
      } catch (error) {
        logger.warn(` CDR query fallback failed: ${error.message}`);
      }
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
          
          // EVENT-DRIVEN: Send missed call alert and auto-SMS immediately when saved
          if (['missed', 'no-answer', 'noanswer', 'failed'].includes(callRecord.status)) {
            await sendMissedCallAlert(callRecord);
            await sendCallAutoSms(callRecord);
          } else if (['answered', 'connected'].includes(callRecord.status)) {
            // Send auto-SMS for answered calls
            await sendCallAutoSms(callRecord);
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

// Auto-SMS Queue with configurable delay
const autoSmsQueue = [];
let isProcessingAutoSms = false;
const autoSmsQueuedNumbers = new Map(); // phone -> queued timestamp ms

async function processAutoSmsQueue() {
  if (isProcessingAutoSms || autoSmsQueue.length === 0) {
    return;
  }

  isProcessingAutoSms = true;

  try {
    const item = autoSmsQueue.shift();
    
    if (item) {
      const now = Date.now();
      const delayMs = item.scheduledTime - now;
      
      // Wait until scheduled time
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      // Execute the SMS send
      if (typeof item.fn === 'function') {
        await item.fn();
      }
    }
  } catch (error) {
    logger.error(`Auto-SMS queue error: ${error.message}`);
  } finally {
    isProcessingAutoSms = false;
    
    // Process next item if queue not empty
    if (autoSmsQueue.length > 0) {
      processAutoSmsQueue();
    }
  }
}

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
// ========================================
// Auto-Reply SMS
// ========================================

async function sendAutoReplySms(senderNumber) {
  try {
    const autoReplyConfig = db.getAutoReplyConfig ? db.getAutoReplyConfig() : null;
    
    // Check if auto-reply is enabled
    if (!autoReplyConfig?.enabled) {
      logger.debug(' Auto-reply disabled - skipping');
      return false;
    }

    if (!senderNumber || !autoReplyConfig.message) {
      logger.warn('Auto-reply: Missing phone number or message');
      return false;
    }

    // Prevent repeated auto-replies to the same number.
    // Use the admin-configured duplicate window from call_auto_sms_config (default 10 min).
    const callAutoSmsCfg = db.getCallAutoSmsConfig ? db.getCallAutoSmsConfig() : {};
    const autoReplyDupWindow = callAutoSmsCfg?.duplicate_window || 10;
    if (db.checkRecentSms && db.checkRecentSms(senderNumber, autoReplyDupWindow)) {
      logger.info(` Auto-reply duplicate prevention: skipping ${senderNumber} (within ${autoReplyDupWindow} min window)`);
      db.logActivity('auto_reply_sms_duplicate_prevented', `Auto-reply duplicate prevented for ${senderNumber}`, 'info');
      return false;
    }

    logger.info(`📧 Sending auto-reply to: ${senderNumber}`);
    logger.info(`   Message: ${autoReplyConfig.message.substring(0, 80)}...`);
    
    const success = await sendSmsViaGateway(senderNumber, autoReplyConfig.message);
    
    if (success) {
      logger.info(`✅ Auto-reply SMS sent to ${senderNumber}`);
      db.logActivity('auto_reply_sms_sent', `Auto-reply sent to ${senderNumber}`, 'success');
      db.insertSMS({
        sender_number: senderNumber,
        message_content: autoReplyConfig.message,
        received_at: new Date().toISOString(),
        status: 'processed',
        direction: 'sent',
        category: 'auto_reply'
      });
    } else {
      logger.error(`❌ Auto-reply SMS failed for ${senderNumber}`);
      db.logActivity('auto_reply_sms_failed', `Auto-reply failed for ${senderNumber}`, 'error');
    }
    
    return success;
  } catch (error) {
    logger.error(`Auto-reply exception: ${error.message}`);
    return false;
  }
}

// ========================================
// Call Auto-SMS
// ========================================

async function sendCallAutoSms(callRecord) {
  try {
    const callAutoSmsConfig = db.getCallAutoSmsConfig ? db.getCallAutoSmsConfig() : null;
    
    // Check if call auto-SMS is enabled
    if (!callAutoSmsConfig?.enabled) {
      logger.debug(' Call auto-SMS disabled - skipping');
      return false;
    }

    // Skip internal calls entirely (extension-to-extension)
    if (callRecord.direction === 'internal') {
      logger.debug(` Call auto-SMS: Skipping internal call`);
      return false;
    }

    // Check configured call direction (inbound / outbound / both)
    const configuredDirection = callAutoSmsConfig.call_direction || 'both';
    if (configuredDirection !== 'both' && callRecord.direction !== configuredDirection) {
      logger.debug(` Call auto-SMS: Skipping ${callRecord.direction} call (configured for '${configuredDirection}' only)`);
      return false;
    }

    // Check extension filter — if a list is set, the call's extension must be in it
    let allowedExtensions = [];
    try { allowedExtensions = JSON.parse(callAutoSmsConfig.allowed_extensions || '[]'); } catch {}
    if (allowedExtensions.length > 0 && !allowedExtensions.includes(String(callRecord.extension))) {
      logger.debug(` Call auto-SMS: Extension '${callRecord.extension}' not in allowed list [${allowedExtensions.join(', ')}]`);
      return false;
    }

    // ✅ Recency guard — only send SMS for calls that started AFTER this service instance was launched.
    // CDR start_time is stored in UTC. We append 'Z' if no timezone designator is present so
    // JavaScript always parses it as UTC (not server local time), matching the EAT display in the frontend.
    // Historical CDR backfill records (any call before service start) are always rejected.
    if (callRecord.start_time) {
      const raw = String(callRecord.start_time).trim().replace(' ', 'T');
      const utcTs = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`;
      const callMs = new Date(utcTs).getTime();
      if (isNaN(callMs)) {
        logger.warn(` Call auto-SMS: Could not parse start_time '${callRecord.start_time}' — skipping`);
        return false;
      }
      if (callMs < SERVICE_START_UTC_MS) {
        logger.debug(` Call auto-SMS: Skipping pre-service call from ${new Date(callMs).toISOString()} (service started ${new Date(SERVICE_START_UTC_MS).toISOString()})`);
        return false;
      }
    }

    // Determine the external number to receive the SMS
    // Inbound: SMS goes to the external caller; Outbound: SMS goes to the external callee
    const targetNumber = callRecord.direction === 'outbound'
      ? callRecord.callee_number
      : callRecord.caller_number;

    const callerNumber = targetNumber;
    if (!callerNumber) {
      logger.warn('Call auto-SMS: No caller number provided');
      return false;
    }

    // ✅ Ensure it's an external phone number, not an internal extension (extensions are 1-4 digits)
    if (callerNumber && /^\d{1,4}$/.test(callerNumber)) {
      logger.debug(` Call auto-SMS: Skipping internal extension ${callerNumber}`);
      return false;
    }

    // ✅ Validate phone number (must be 10+ digits: 0722832929, 254729202638, etc.)
    if (!isValidPhoneNumber(callerNumber)) {
      logger.warn(` Call auto-SMS: Invalid phone number format: ${callerNumber} (must be 10+ digits)`);
      db.logActivity('call_auto_sms_invalid_number', `Invalid phone number: ${callerNumber}`, 'warning');
      return false;
    }

    // Determine message based on call status
    let messageTemplate;
    if (['missed', 'no-answer', 'noanswer', 'failed'].includes(callRecord.status)) {
      messageTemplate = callAutoSmsConfig.missed_message;
      logger.info(`📞 Sending missed call auto-SMS to: ${callerNumber}`);
    } else if (['answered', 'connected'].includes(callRecord.status)) {
      messageTemplate = callAutoSmsConfig.answered_message;
      logger.info(`☎️ Sending answered call auto-SMS to: ${callerNumber}`);
    } else {
      logger.debug(` Call auto-SMS: Status '${callRecord.status}' not matched for sending`);
      return false;
    }

    if (!messageTemplate) {
      logger.warn('Call auto-SMS: No message template available');
      return false;
    }

    // Replace template variables
    let message = messageTemplate
      .replace(/\{caller_name\}/g, callRecord.caller_name || callRecord.caller_number)
      .replace(/\{caller_number\}/g, callerNumber)
      .replace(/\{extension\}/g, callRecord.extension || 'N/A')
      .replace(/\{time\}/g, new Date(callRecord.start_time).toLocaleTimeString('en-KE'))
      .replace(/\{date\}/g, new Date(callRecord.start_time).toLocaleDateString('en-KE'))
      .replace(/\{duration\}/g, `${callRecord.talk_duration || 0}s`);

    logger.info(`   Message: ${message.substring(0, 80)}...`);
    
    // Calculate delay (admin-configurable, default 5 minutes)
    const delayMinutes = (callAutoSmsConfig.delay_enabled && callAutoSmsConfig.delay_minutes) ? callAutoSmsConfig.delay_minutes : 0;
    const delayMs = delayMinutes * 60 * 1000;
    const scheduledTime = Date.now() + delayMs;
    
    // Use admin-configured duplicate window (default 10 minutes)
    const duplicateWindowMinutes = callAutoSmsConfig.duplicate_window || 10;

    // Check for recent duplicates before queueing
    if (db.checkRecentSms && db.checkRecentSms(callerNumber, duplicateWindowMinutes)) {
      logger.info(` Auto-SMS: Duplicate prevention - SMS already sent to ${callerNumber} within ${duplicateWindowMinutes} min`);
      db.logActivity('call_auto_sms_duplicate_prevented', `Duplicate prevented for ${callerNumber}`, 'info');
      return false;
    }

    // Queue SMS for delayed sending
    const existingQueuedAt = autoSmsQueuedNumbers.get(callerNumber);
    if (existingQueuedAt && (Date.now() - existingQueuedAt) < (duplicateWindowMinutes * 60 * 1000)) {
      logger.info(` Auto-SMS queue duplicate prevention: ${callerNumber} already queued recently`);
      db.logActivity('call_auto_sms_queue_duplicate_prevented', `Queue duplicate prevented for ${callerNumber}`, 'info');
      return false;
    }

    autoSmsQueuedNumbers.set(callerNumber, Date.now());

    autoSmsQueue.push({
      scheduledTime,
      fn: async () => {
        try {
          const success = await sendSmsViaGateway(callerNumber, message);
          if (success) {
            logger.info(`✅ Call auto-SMS sent to ${callerNumber} (delayed ${delayMinutes}m)`);
            db.logActivity('call_auto_sms_sent', `Call auto-SMS sent to ${callerNumber}`, 'success');
            db.insertSMS({ sender_number: callerNumber, message_content: message, received_at: new Date().toISOString(), status: 'processed', direction: 'sent', category: 'auto' });
          } else {
            logger.error(`❌ Call auto-SMS failed for ${callerNumber}`);
            db.logActivity('call_auto_sms_failed', `Call auto-SMS failed for ${callerNumber}`, 'error');
          }
        } catch (err) { logger.error(`Queued SMS error: ${err.message}`); }
        finally {
          autoSmsQueuedNumbers.delete(callerNumber);
        }
      }
    });

    if (!isProcessingAutoSms) processAutoSmsQueue();
    return true;
  } catch (error) {
    logger.error(`Call auto-SMS exception: ${error.message}`);
    return false;
  }
}

// Template variable substitution
function applyTemplate(template, vars) {
  return Object.entries(vars).reduce((text, [key, val]) =>
    text.split(`{${key}}`).join(val !== undefined && val !== null ? String(val) : ''),
  template);
}

// Get template for a specific channel (tg_ or email_ prefix), falling back to shared key
function getChannelTemplate(channel, eventType) {
  const channelKey = `${channel}_${eventType}`;
  return db.getNotificationTemplate(channelKey) || db.getNotificationTemplate(eventType) || null;
}

// Event-Driven Missed Call Alert (No Polling)
// ========================================

const notifiedMissedCalls = new Set(); // Track which missed calls we've already alerted

async function sendMissedCallAlert(callRecord) {
  try {
    const telegramConfig = db.getNotificationConfig();
    
    // Only send if telegram is enabled and configured
    if (!telegramConfig?.enabled || !telegramConfig?.bot_token || !telegramConfig?.chat_id) {
      logger.debug(' Telegram not enabled - skipping alert');
      return;
    }

    if (!telegramConfig?.notify_missed_calls) {
      logger.debug(' Missed-call notifications are disabled - skipping alert');
      return;
    }

    // Skip if not a missed call or already notified
    if (!['missed', 'no-answer', 'noanswer', 'failed'].includes(callRecord.status)) {
      return;
    }

    // Only alert for inbound calls (external callers) — never internal extensions
    if (callRecord.direction !== 'inbound') {
      logger.debug(` Missed call alert: skipping ${callRecord.direction} call from ${callRecord.caller_number}`);
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
      
      const missedTemplate = getChannelTemplate('tg', 'missed_call') ||
        '\uD83D\uDD14 MISSED CALL ALERT\n\nCaller: {caller}\nExtension: {extension} ({extension_name})\nTime: {time} (Nairobi)\nDate: {date}\nRing Duration: {duration}s';
      const messageText = applyTemplate(missedTemplate, {
        caller: callerNumber,
        extension: extensionNumber,
        extension_name: extensionUsername,
        time: callTime,
        date: callDate,
        duration: String(duration),
      });

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

            // Also send via Email if enabled — use email-specific template
            const emailTemplate = getChannelTemplate('email', 'missed_call') ||
              '🔔 MISSED CALL ALERT\n\nCaller: {caller}\nExtension: {extension} ({extension_name})\nTime: {time} (Nairobi)\nDate: {date}\nRing Duration: {duration}s';
            const emailText = applyTemplate(emailTemplate, {
              caller: callerNumber,
              extension: extensionNumber,
              extension_name: extensionUsername,
              time: callTime,
              date: callDate,
              duration: String(duration),
            });
            await sendEmail(`Missed Call: ${callerNumber}`, emailText);
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
    const telegramConfig = db.getNotificationConfig();
    
    // Only send if telegram is enabled
    if (!telegramConfig?.enabled || !telegramConfig?.bot_token || !telegramConfig?.chat_id) {
      return;
    }

    if (!telegramConfig?.notify_system_errors) {
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

    const errorTemplate = getChannelTemplate('tg', 'system_error') ||
      'ERROR ALERT\n\nType: {error_type}\nMessage: {error_message}\nTime: {time}';
    const messageText = applyTemplate(errorTemplate, {
      error_type: eventType,
      error_message: message.substring(0, 200) + (message.length > 200 ? '...' : ''),
      time: nairobiTime + ' (Nairobi)',
    });

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

    // Send via Email using email-specific template
    const emailErrTemplate = getChannelTemplate('email', 'system_error') ||
      'ERROR ALERT\n\nType: {error_type}\nMessage: {error_message}\nTime: {time}';
    const emailErrText = applyTemplate(emailErrTemplate, {
      error_type: eventType,
      error_message: message.substring(0, 200) + (message.length > 200 ? '...' : ''),
      time: nairobiTime + ' (Nairobi)',
    });
    await sendEmail(`System Alert: ${eventType}`, emailErrText);
  } catch (error) {
    logger.error(`Error alert error: ${error.message}`);
  }
}

// Send alert when a new inbound SMS is received
async function sendNewSmsAlert(senderNumber, portLabel, messageContent) {
  try {
    const telegramConfig = db.getNotificationConfig();
    if (!telegramConfig?.enabled || !telegramConfig?.bot_token || !telegramConfig?.chat_id) return;
    if (!telegramConfig?.notify_new_sms) return;

    const now = new Date().toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const tgSmsTemplate = getChannelTemplate('tg', 'new_sms') ||
      '\uD83D\uDCAC NEW SMS RECEIVED\n\nFrom: {caller}\nPort: {port}\nTime: {time}\nMessage: {message}';
    const text = applyTemplate(tgSmsTemplate, {
      caller: senderNumber,
      port: portLabel || 'Unknown',
      time: now,
      message: messageContent.substring(0, 300) + (messageContent.length > 300 ? '...' : ''),
    });
    const tgResp = await fetch(`https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramConfig.chat_id, text }),
    });
    const tgJson = await tgResp.json();
    if (tgResp.ok && tgJson.ok) {
      logger.info(`\uD83D\uDCE9 New SMS alert sent for ${senderNumber}`);
      db.logActivity('new_sms_alert_sent', `New SMS alert sent for ${senderNumber}`, 'success');
    }
    // Email with channel-specific template
    const emailSmsTemplate = getChannelTemplate('email', 'new_sms') ||
      '\uD83D\uDCAC NEW SMS RECEIVED\n\nFrom: {caller}\nPort: {port}\nTime: {time}\nMessage: {message}';
    const emailSmsText = applyTemplate(emailSmsTemplate, {
      caller: senderNumber,
      port: portLabel || 'Unknown',
      time: now,
      message: messageContent.substring(0, 300) + (messageContent.length > 300 ? '...' : ''),
    });
    await sendEmail(`New SMS from ${senderNumber}`, emailSmsText);
  } catch (e) {
    logger.error(`New SMS alert error: ${e.message}`);
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
// ========================================
// Email Service (configurable SMTP via admin settings)
// ========================================

async function sendEmail(subject, bodyText, { bypassEnabledCheck = false } = {}) {
  try {
    const telegramConfig = db.getNotificationConfig();
    
    if (!bypassEnabledCheck && !telegramConfig?.email_enabled) {
      logger.debug(' Email notifications disabled - skipping');
      return false;
    }

    const smtpHost = telegramConfig.email_smtp_host;
    const smtpPort = telegramConfig.email_smtp_port || 587;
    const smtpUser = telegramConfig.email_smtp_user;
    const smtpPass = telegramConfig.email_smtp_pass;
    const emailFrom = telegramConfig.email_from || smtpUser;
    const encryption = telegramConfig.email_smtp_encryption || 'auto';

    if (!smtpHost || !smtpUser || !smtpPass) {
      logger.warn(' Email SMTP credentials not configured - skipping email send');
      return false;
    }

    let recipients = [];
    try {
      const raw = telegramConfig.email_recipients;
      recipients = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    } catch (e) {
      recipients = [];
    }

    if (!recipients || recipients.length === 0) {
      logger.warn(' No email recipients configured');
      return false;
    }

    const nodemailer = require('nodemailer');
    // Determine secure/tls settings based on encryption choice
    let secure = false;
    let tlsOptions = { rejectUnauthorized: false };
    if (encryption === 'ssl' || (encryption === 'auto' && smtpPort === 465)) {
      secure = true; // SSL/TLS from the start
    } else if (encryption === 'starttls') {
      secure = false; // STARTTLS upgrades after connection
      tlsOptions = { ...tlsOptions, ciphers: 'SSLv3' };
    } else if (encryption === 'none') {
      secure = false;
      tlsOptions = { rejectUnauthorized: false };
    }
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
      tls: tlsOptions
    });

    await transporter.sendMail({
      from: emailFrom,
      to: recipients.join(','),
      subject,
      text: bodyText
    });

    logger.info(`✅ Email sent: "${subject}" to ${recipients.length} recipient(s)`);
    db.logActivity('email_sent', `Email "${subject}" sent to ${recipients.join(', ')}`, 'success');
    return true;
  } catch (error) {
    logger.error(`Email send failed: ${error.message}`);
    db.logActivity('email_send_failed', `Email send failed: ${error.message}`, 'error');
    return false;
  }
}

// SMS Gateway Service (Hardcoded Credentials)
// ========================================

const SMS_GATEWAY_CONFIG = {
  url: 'https://sms.techrasystems.com/SMSApi/send',
  userid: 'nosteqltd',
  senderid: 'NOSTEQLTD',
  apikey: 'd5333c2f579ef1115d5984475e6fbecfffa2cdff'
};

// Generic SMS sending function using hardcoded gateway
// Format phone number to international format
// Converts 0XXXXXXXXX to 254XXXXXXXXX (Kenya country code)
function formatPhoneNumber(number) {
  if (!number) return number;
  const cleaned = String(number).trim();
  
  // If starts with 0, replace with 254
  if (cleaned.startsWith('0')) {
    return '254' + cleaned.substring(1);
  }
  
  // If already starts with 254, return as is
  if (cleaned.startsWith('254')) {
    return cleaned;
  }
  
  // Otherwise, prepend 254
  return '254' + cleaned;
}

// ========================================
// Phone Number Validation
// ========================================
function isValidPhoneNumber(number) {
  if (!number) return false;
  
  // Remove all non-digit characters
  const digitsOnly = String(number).replace(/\D/g, '');
  
  // Must be at least 10 digits (e.g., 0722832929 or minimum 254xxxxxxxx)
  if (digitsOnly.length < 10) {
    return false;
  }
  
  // Must be at most 13 digits (e.g., 254XXXXXXXXXX)
  if (digitsOnly.length > 13) {
    return false;
  }
  
  // Valid formats:
  // - 0722832929 (Kenya local, 10 digits starting with 0)
  // - 254722832929 (Kenya international, 12 digits starting with 254)
  // - 722832929 (Kenya without 0 or 254, 9 digits - we add 254)
  return true;
}

async function sendSmsViaGateway(phoneNumberOrNumbers, messageText) {
  try {
    // Check if SMS sending is enabled globally
    if (!db.isSmsEnabled()) {
      logger.info('ℹ️  SMS sending is currently disabled by administrator');
      return false;
    }
    
    const numbers = Array.isArray(phoneNumberOrNumbers) ? phoneNumberOrNumbers : [phoneNumberOrNumbers];
    
    if (!numbers || numbers.length === 0 || !messageText) {
      logger.warn('SMS sending: No phone numbers or message provided');
      return false;
    }

    // Check for duplicate SMS within 24 hours for each recipient
    const filteredNumbers = [];
    for (const number of numbers) {
      if (db.checkRecentSms(number, 1440)) {
        logger.warn(`⚠️  SMS already sent to ${number} today - skipping to prevent duplicate`);
        db.logActivity('sms_duplicate_prevented', `SMS to ${number} skipped (duplicate within 24h)`, 'warning');
        continue;
      }
      filteredNumbers.push(number);
    }
    
    // If all numbers were filtered out due to duplicates, return early
    if (filteredNumbers.length === 0) {
      logger.info(`ℹ️  All SMS recipients already received this message today - no action taken`);
      return true;
    }

    // Format all phone numbers to international format
    const formattedNumbers = filteredNumbers.map(n => formatPhoneNumber(n));
    const mobileParam = formattedNumbers.join(',');
    
    logger.info(`📤 Sending SMS via gateway to: ${mobileParam}`);
    logger.info(`   Message: ${messageText.substring(0, 80)}...`);

    try {
      const { execSync } = require('child_process');
      // Properly escape for shell: escape backslashes, double quotes, backticks, and dollar signs
      const escapedMsg = messageText
        .replace(/\\/g, '\\\\')    // Escape backslashes first
        .replace(/"/g, '\\"')      // Escape double quotes
        .replace(/`/g, '\\`')      // Escape backticks
        .replace(/\$/g, '\\$');    // Escape dollar signs
      
      const curlCommand = `curl -X POST '${SMS_GATEWAY_CONFIG.url}' \
-H 'Accept: application/json' \
-H 'apikey: ${SMS_GATEWAY_CONFIG.apikey}' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-H 'Cookie: SERVERID=webC1' \
-d "userid=${SMS_GATEWAY_CONFIG.userid}&senderid=${SMS_GATEWAY_CONFIG.senderid}&msgType=text&duplicatecheck=true&sendMethod=quick&msg=${escapedMsg}&mobile=${mobileParam}"`;

      const response = execSync(curlCommand, { 
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash' 
      });

      if (response && response.trim()) {
        logger.info(`✅ SMS sent successfully to ${filteredNumbers.length} recipient(s)`);
        
        // Store sent SMS in database for each recipient
        try {
          filteredNumbers.forEach(recipient => {
            db.insertSMS({
              sender_number: recipient,
              message_content: messageText,
              received_at: new Date().toISOString(),
              status: 'processed',
              direction: 'sent',
              category: 'system'
            });
          });
        } catch (dbError) {
          logger.warn(`Failed to log sent SMS to database: ${dbError.message}`);
        }
        
        return true;
      } else {
        logger.warn(`SMS gateway empty response`);
        return false;
      }
    } catch (execError) {
      logger.error(`SMS sending failed: ${execError.message}`);
      return false;
    }
  } catch (error) {
    logger.error(`SMS sending exception: ${error.message}`);
    return false;
  }
}

async function sendSmsReport(phoneNumbers, messageText) {
  try {
    // Check if SMS sending is enabled globally
    if (!db.isSmsEnabled()) {
      logger.info('ℹ️  SMS sending is currently disabled by administrator');
      return false;
    }
    
    // Handle both single number and array of numbers
    const numbers = Array.isArray(phoneNumbers) ? phoneNumbers : [phoneNumbers];
    
    if (!numbers || numbers.length === 0 || !messageText) {
      logger.warn('SMS Report: No phone numbers or message provided');
      return false;
    }

    // Check for duplicate SMS within 24 hours for each recipient
    const filteredNumbers = [];
    for (const number of numbers) {
      if (db.checkRecentSms(number, 1440)) {
        logger.warn(`⚠️  SMS Report already sent to ${number} today - skipping to prevent duplicate`);
        db.logActivity('sms_report_duplicate_prevented', `SMS Report to ${number} skipped (duplicate within 24h)`, 'warning');
        continue;
      }
      filteredNumbers.push(number);
    }
    
    // If all numbers were filtered out due to duplicates, return early
    if (filteredNumbers.length === 0) {
      logger.info(`ℹ️  All SMS Report recipients already received this message today - no action taken`);
      return true;
    }

    // Format all phone numbers to international format and join
    const formattedNumbers = filteredNumbers.map(n => formatPhoneNumber(n));
    const mobileParam = formattedNumbers.join(',');
    
    logger.info(`📤 SMS sending to: ${mobileParam}`);
    logger.info(`   Message length: ${messageText.length} characters`);

    try {
      // Build and execute curl command directly using shell escaping
      const { execSync } = require('child_process');
      
      // Properly escape for shell: escape backslashes, double quotes, backticks, and dollar signs
      const escapedMsg = messageText
        .replace(/\\/g, '\\\\')    // Escape backslashes first
        .replace(/"/g, '\\"')      // Escape double quotes
        .replace(/`/g, '\\`')      // Escape backticks
        .replace(/\$/g, '\\$');    // Escape dollar signs
      
      const curlCommand = `curl -X POST '${SMS_GATEWAY_CONFIG.url}' \
-H 'Accept: application/json' \
-H 'apikey: ${SMS_GATEWAY_CONFIG.apikey}' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-H 'Cookie: SERVERID=webC1' \
-d "userid=${SMS_GATEWAY_CONFIG.userid}&senderid=${SMS_GATEWAY_CONFIG.senderid}&msgType=text&duplicatecheck=true&sendMethod=quick&msg=${escapedMsg}&mobile=${mobileParam}"`;

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
        logger.info(`✅ SMS sent successfully to ${filteredNumbers.length} recipient(s): ${mobileParam}`);
        db.logActivity('sms_report_sent', `SMS sent to ${mobileParam}`, 'success');
        
        // Store sent SMS in database for each recipient
        try {
          filteredNumbers.forEach(recipient => {
            db.insertSMS({
              sender_number: recipient,
              message_content: messageText,
              received_at: new Date().toISOString(),
              status: 'processed',
              direction: 'sent',
              category: 'report'
            });
          });
        } catch (dbError) {
          logger.warn(`Failed to log sent SMS to database: ${dbError.message}`);
        }
        
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
    const telegramConfig = db.getNotificationConfig();
    if (!telegramConfig?.daily_report_enabled) {
      logger.info('Daily report disabled in notification settings');
      return;
    }

    // Get today's date
    const today = new Date().toISOString().split('T')[0];

    // === CALL STATISTICS (AGGREGATED) ===
    const callStats = db.db.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) as inbound_calls,
        SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) as outbound_calls,
        SUM(CASE WHEN direction = 'internal' THEN 1 ELSE 0 END) as internal_calls,
        SUM(CASE WHEN direction = 'inbound' AND status = 'answered' THEN 1 ELSE 0 END) as inbound_answered,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') THEN 1 ELSE 0 END) as inbound_missed,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') AND is_returned = 0 THEN 1 ELSE 0 END) as inbound_unreturned,
        SUM(CASE WHEN direction = 'outbound' AND status = 'answered' THEN 1 ELSE 0 END) as outbound_answered,
        SUM(CASE WHEN direction = 'outbound' AND status IN ('missed', 'no-answer', 'noanswer', 'failed', 'busy') THEN 1 ELSE 0 END) as outbound_failed,
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
      
      messageText += `--- Inbound & Outbound ---\n`;
      const totalInOut = (callStats.inbound_calls || 0) + (callStats.outbound_calls || 0);
      const totalAnswered = (callStats.inbound_answered || 0) + (callStats.outbound_answered || 0);
      const totalLost = (callStats.inbound_missed || 0) + (callStats.outbound_failed || 0);
      messageText += `[Total] ${totalInOut}\n`;
      messageText += `[Answered] ${totalAnswered}\n`;
      messageText += `[Missed/Failed] ${totalLost}\n`;
      messageText += `[Unreturned] ${callStats.inbound_unreturned || 0}\n`;
      messageText += `[Returned] ${(callStats.inbound_missed || 0) - (callStats.inbound_unreturned || 0)}\n\n`;
      
      messageText += `--- Internal ---\n`;
      messageText += `[Total] ${callStats.internal_calls || 0}\n`;
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

    // ========== SEND VIA EMAIL (IF ENABLED) ==========
    await sendEmail('Daily System Report', messageText);

    // ========== SEND SMS TO CONFIGURED PHONE NUMBERS ==========
    const smsRecipients = db.getSmsReportRecipients();
    if (telegramConfig?.sms_enabled && smsRecipients && smsRecipients.length > 0) {
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
  logger.info('Scheduling daily report based on notification settings');

  // Check every second if it's time to send the report
  dailyReportInterval = setInterval(() => {
    const telegramConfig = db.getNotificationConfig() || {};
    if (!telegramConfig.daily_report_enabled) {
      return;
    }

    const configuredTime = (telegramConfig.daily_report_time || '18:00').trim();
    const timeMatch = configuredTime.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      return;
    }

    const targetHour = Math.max(0, Math.min(23, parseInt(timeMatch[1], 10)));
    const targetMinute = Math.max(0, Math.min(59, parseInt(timeMatch[2], 10)));

    const now = new Date();
    const nairobiParts = new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const getPart = (type) => nairobiParts.find((p) => p.type === type)?.value || '00';
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    const hour = parseInt(getPart('hour'), 10);
    const minute = parseInt(getPart('minute'), 10);
    const second = parseInt(getPart('second'), 10);
    const todayKey = `${year}-${month}-${day}`;

    if (hour === targetHour && minute === targetMinute && second === 0 && lastReportTimes.daily !== todayKey) {
      lastReportTimes.daily = todayKey;
      logger.info(`📊 Sending scheduled daily report at ${configuredTime} Nairobi`);
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

async function startSmsListener(retryCount = 0) {
  // Exponential backoff: 30s, 60s, 120s, 240s, capped at 300s (5 min)
  const retryDelay = Math.min(30000 * Math.pow(2, retryCount), 300000);
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

    // Fully destroy old instance before creating a new one
    if (tg400Api) {
      logger.debug('🧹 Cleaning up old SMS listener...');
      try {
        tg400Api.removeAllListeners();
        tg400Api.disconnect();
      } catch (_) {}
      tg400Api = null;
    }
    // Clear any old polling interval
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }

    logger.info(`\n📡 Connecting SMS listener to ${config.gateway_ip}:${config.api_port || 5038}`);
    
    tg400Api = new TG400TcpApi(
      config.gateway_ip,
      config.api_port || 5038,
      config.api_username,
      config.api_password,
      { log: (level, msg) => logger.debug(`[TCP] ${level.toUpperCase()}: ${msg}`) }
    );

    // Event: New SMS received - Server pushes SMS when received
    tg400Api.on('sms-received', async (sms) => {
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
          
          // EVENT-DRIVEN: Send auto-reply SMS if enabled
          await sendAutoReplySms(sms.sender);

          // EVENT-DRIVEN: Send new SMS notification alert if enabled
          const portLabel = (() => {
            try {
              const row = db.db.prepare('SELECT label FROM port_labels WHERE port_number = ? LIMIT 1').get(internalPort);
              return row?.label || `Port ${internalPort}`;
            } catch (e) { return `Port ${internalPort}`; }
          })();
          await sendNewSmsAlert(sms.sender, portLabel, messageContent);
          
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
      setTimeout(() => startSmsListener(0), 30000);
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
    const isUnreachable = error.message.includes('EHOSTUNREACH') || error.message.includes('ECONNREFUSED') || error.message.includes('Authentication timeout');
    if (isUnreachable) {
      logger.warn(`⚠️  TG400 unreachable (${error.message}). Retry in ${retryDelay / 1000}s (attempt ${retryCount + 1})`);
    } else {
      logger.error(`\n Failed to start SMS listener: ${error.message}`);
    }
    setTimeout(() => startSmsListener(retryCount + 1), retryDelay);
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
// Change own password (authenticated user)
app.put('/api/users/change-password', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const [userId] = token.split(':');
    if (!userId) return res.status(401).json({ success: false, error: 'Invalid token' });

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const newPasswordHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    db.db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPasswordHash, userId);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Change own PIN (authenticated user)
app.put('/api/users/change-pin', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const [userId] = token.split(':');
    if (!userId) return res.status(401).json({ success: false, error: 'Invalid token' });

    const { pin } = req.body;
    if (!pin || String(pin).length < 4) {
      return res.status(400).json({ success: false, error: 'PIN must be at least 4 digits' });
    }

    const user = db.db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ success: false, error: 'No user profile found. Contact your admin.' });

    db.db.prepare('UPDATE users SET pin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(String(pin), userId);
    res.json({ success: true, message: 'Clock-in PIN updated' });
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

// Delete user (super_admin only)
app.delete('/api/users/:id', requireRole('super_admin'), (req, res) => {
  try {
    const { id } = req.params;

    const userToDelete = db.db.prepare('SELECT role, id FROM users WHERE id = ?').get(id);
    if (!userToDelete) return res.status(404).json({ success: false, error: 'User not found' });

    // Prevent deleting a super_admin
    if (userToDelete.role === 'super_admin') {
      return res.status(400).json({ success: false, error: 'Cannot delete a super admin account' });
    }

    // Prevent deleting the last remaining admin
    const { count } = db.db.prepare(
      "SELECT COUNT(*) as count FROM users u LEFT JOIN user_roles ur ON u.id = ur.user_id WHERE COALESCE(ur.role, u.role) IN ('admin','super_admin')"
    ).get();
    const effectiveRole = db.db.prepare(
      "SELECT COALESCE(ur.role, u.role) as role FROM users u LEFT JOIN user_roles ur ON u.id = ur.user_id WHERE u.id = ?"
    ).get(id);
    if (effectiveRole && effectiveRole.role === 'admin' && count <= 1) {
      return res.status(400).json({ success: false, error: 'Cannot delete the only admin user' });
    }

    db.db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(id);
    const result = db.db.prepare('DELETE FROM users WHERE id = ?').run(id);

    if (result.changes === 0) return res.status(404).json({ success: false, error: 'User not found' });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user port permissions (admin)
app.get('/api/users/:id/port-permissions', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    if (req.currentUserRole !== 'super_admin' && req.currentUserRole !== 'admin' && req.currentUserId !== id) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const ports = db.getUserPortPermissions(id);
    res.json({ success: true, data: ports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set user port permissions (admin)
app.post('/api/users/:id/port-permissions', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const { id } = req.params;
    const { ports } = req.body; // Array of port numbers [1,2,3,4] or empty for all
    
    if (!Array.isArray(ports)) {
      return res.status(400).json({ success: false, error: 'Ports must be an array' });
    }

    // Validate port numbers
    const validPorts = ports.filter(p => p >= 1 && p <= 4);
    
    const success = db.setUserPortPermissions(id, validPorts);
    if (!success) throw new Error('Failed to set port permissions');

    res.json({ success: true, message: 'Port permissions updated', data: validPorts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user extension permissions (admin)
app.get('/api/users/:id/extension-permissions', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    if (req.currentUserRole !== 'super_admin' && req.currentUserRole !== 'admin' && req.currentUserId !== id) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const extensions = db.getUserExtensionPermissions(id);
    res.json({ success: true, data: extensions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set user extension permissions (admin)
app.post('/api/users/:id/extension-permissions', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const { id } = req.params;
    const { extensions } = req.body; // Array of extension strings or empty for all
    
    if (!Array.isArray(extensions)) {
      return res.status(400).json({ success: false, error: 'Extensions must be an array' });
    }

    const success = db.setUserExtensionPermissions(id, extensions);
    if (!success) throw new Error('Failed to set extension permissions');

    res.json({ success: true, message: 'Extension permissions updated', data: extensions });
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
// System Settings Endpoints
// ========================================

app.get('/api/system-settings/sms-enabled', (req, res) => {
  try {
    const isEnabled = db.isSmsEnabled();
    res.json({ 
      success: true, 
      sms_enabled: isEnabled
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/system-settings/sms-enabled', (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (enabled === undefined) {
      return res.status(400).json({ success: false, error: 'enabled parameter required' });
    }

    const success = db.setSystemSetting('sms_enabled', enabled ? 'true' : 'false');
    
    if (success) {
      logger.info(`SMS sending ${enabled ? 'ENABLED' : 'DISABLED'} by admin`);
      db.logActivity('sms_setting_changed', `SMS sending ${enabled ? 'ENABLED' : 'DISABLED'}`, 'success');
      
      res.json({
        success: true,
        message: `SMS sending ${enabled ? 'enabled' : 'disabled'}`,
        sms_enabled: enabled
      });
    } else {
      throw new Error('Failed to update SMS setting');
    }
  } catch (error) {
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
app.get('/api/pbx-status', async (req, res) => {
  try {
    const config = db.getPbxConfig();
    const isConfigured = !!(config && config.pbx_ip && config.api_username);

    if (!isConfigured) {
      return res.json({
        configured: false,
        connected: false,
        status: 'Not Configured',
        error: null,
        pbx_ip: config?.pbx_ip || null,
        pbx_port: config?.pbx_port || null,
        timestamp: new Date().toISOString()
      });
    }

    const testResult = await pbxAPI.testConnection();

    res.json({
      configured: true,
      connected: !!testResult.success,
      status: testResult.status || (testResult.success ? 'Connected' : 'Failed'),
      error: testResult.success ? null : (testResult.error || 'Connection failed'),
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
// Channel Setup Endpoints (Telegram credentials + Email SMTP)
// ========================================

app.get('/api/channel-setup', (req, res) => {
  try {
    const config = db.getChannelConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/channel-setup', (req, res) => {
  try {
    const {
      bot_token,
      chat_id,
      email_smtp_host,
      email_smtp_port,
      email_smtp_user,
      email_smtp_pass,
      email_from,
      email_recipients,
      email_smtp_encryption,
    } = req.body;

    const success = db.saveChannelConfig({
      bot_token,
      chat_id,
      email_smtp_host,
      email_smtp_port,
      email_smtp_user,
      email_smtp_pass,
      email_from,
      email_recipients,
      email_smtp_encryption,
    });

    if (success) {
      res.json({ success: true, message: 'Channel credentials saved', data: db.getChannelConfig() });
    } else {
      throw new Error('Failed to save channel credentials');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Notification Preferences Endpoints (delivery toggles + schedule)
// ========================================

app.get('/api/notifications-setup', (req, res) => {
  try {
    const setup = db.getNotificationsSetup();
    res.json({ success: true, data: setup });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notifications-setup', (req, res) => {
  try {
    const {
      telegram_enabled,
      email_enabled,
      sms_reports_enabled,
      notify_missed_calls,
      notify_new_sms,
      notify_system_errors,
      notify_shift_changes,
      daily_report_enabled,
      daily_report_time,
    } = req.body;

    const success = db.saveNotificationsSetup({
      telegram_enabled,
      email_enabled,
      sms_reports_enabled,
      notify_missed_calls,
      notify_new_sms,
      notify_system_errors,
      notify_shift_changes,
      daily_report_enabled,
      daily_report_time,
    });

    if (success) {
      res.json({ success: true, message: 'Notification preferences saved', data: db.getNotificationsSetup() });
    } else {
      throw new Error('Failed to save notification preferences');
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Test SMS endpoint
app.post('/api/test-sms', async (req, res) => {
  try {
    const smsRecipients = db.getSmsReportRecipients();
    
    if (!smsRecipients || smsRecipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No SMS recipients configured',
        details: 'Please add at least one phone number in Configuration → Setup'
      });
    }

    // Send test SMS to first recipient only
    const testRecipient = smsRecipients[0];
    const testMessage = `SMS Gateway Test - System working. Time: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}`;
    
    const smsSent = await sendSmsViaGateway(testRecipient.phone_number, testMessage);
    
    if (smsSent) {
      res.json({
        success: true,
        message: 'Test SMS sent successfully',
        details: `Sent to ${testRecipient.phone_number}`,
        recipientCount: smsRecipients.length
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to send test SMS',
        details: 'Check SMS gateway configuration (URL, API key) and try again'
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'SMS test failed',
      details: error.message 
    });
  }
});

// Test Email endpoint
app.post('/api/test-email', async (req, res) => {
  try {
    const telegramConfig = db.getNotificationConfig();

    const smtpHost = telegramConfig?.email_smtp_host;
    const smtpPort = Number(telegramConfig?.email_smtp_port) || 587;
    const smtpUser = telegramConfig?.email_smtp_user;
    const smtpPass = telegramConfig?.email_smtp_pass;
    const emailFrom = telegramConfig?.email_from || smtpUser;
    const encryption = telegramConfig?.email_smtp_encryption || 'auto';

    // Check SMTP credentials
    if (!smtpHost || !smtpUser || !smtpPass) {
      return res.status(400).json({
        success: false,
        error: 'Email SMTP not configured',
        missingFields: {
          smtp_host: !smtpHost,
          smtp_user: !smtpUser,
          smtp_pass: !smtpPass
        },
        details: 'Please configure SMTP credentials in Configuration → Setup'
      });
    }

    // Parse recipients properly (stored as JSON string in DB)
    let recipients = [];
    try {
      const raw = telegramConfig.email_recipients;
      recipients = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    } catch (e) {
      recipients = [];
    }

    if (recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No email recipients configured',
        details: 'Please add at least one email recipient in Configuration → Setup'
      });
    }

    // Build transporter directly so we can return the real SMTP error to the caller
    const nodemailer = require('nodemailer');
    let secure = false;
    let tlsOptions = { rejectUnauthorized: false };
    if (encryption === 'ssl' || (encryption === 'auto' && smtpPort === 465)) {
      secure = true;
    } else if (encryption === 'starttls') {
      secure = false;
      tlsOptions = { ...tlsOptions, ciphers: 'SSLv3' };
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
      tls: tlsOptions
    });

    const testMessage = `Email Gateway Test - System working correctly.\n\nTime: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n\nIf you received this, your SMTP settings are correct.`;

    await transporter.sendMail({
      from: emailFrom,
      to: recipients.join(','),
      subject: 'SMS Gateway Test Email',
      text: testMessage
    });

    logger.info(`✅ Test email sent to ${recipients.join(', ')}`);
    res.json({
      success: true,
      message: 'Test email sent successfully',
      details: `Sent to ${recipients.join(', ')}`,
      recipientCount: recipients.length
    });
  } catch (error) {
    logger.error(`Test email failed: ${error.message}`);
    res.status(400).json({
      success: false,
      error: 'Failed to send test email',
      details: error.message  // real SMTP/nodemailer error surfaced to frontend
    });
  }
});

app.post('/api/telegram-send', async (req, res) => {
  try {
    const { action, bot_token: overrideBotToken, chat_id: overrideChatId } = req.body;
    const telegramConfig = db.getNotificationConfig();

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
app.delete('/api/sms-report-recipients/:phone_number', requireRole('super_admin', 'admin'), (req, res) => {
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

// ========================================
// SMS Templates API Endpoints
// ========================================

app.get('/api/sms-templates', (req, res) => {
  try {
    const templates = db.getSmsTemplates ? db.getSmsTemplates() : [];
    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Notification alert templates endpoints
app.get('/api/notification-templates', (req, res) => {
  try {
    const templates = db.getAllNotificationTemplates();
    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/notification-templates/:eventType', (req, res) => {
  try {
    const { eventType } = req.params;
    const allowed = ['missed_call', 'new_sms', 'system_error', 'shift_change', 'daily_report', 'callback_notify',
    'tg_missed_call', 'tg_new_sms', 'tg_system_error', 'tg_shift_change', 'tg_daily_report',
    'email_missed_call', 'email_new_sms', 'email_system_error', 'email_shift_change', 'email_daily_report',
    'sms_callback_notify'];
    if (!allowed.includes(eventType)) {
      return res.status(400).json({ success: false, error: 'Invalid event type' });
    }
    const { template_text } = req.body;
    if (typeof template_text !== 'string' || !template_text.trim()) {
      return res.status(400).json({ success: false, error: 'template_text is required' });
    }
    const ok = db.saveNotificationTemplate(eventType, template_text);
    if (ok) res.json({ success: true });
    else res.status(500).json({ success: false, error: 'Failed to save template' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/sms-templates', (req, res) => {
  try {
    const { name, message } = req.body;
    if (!name || !message) {
      return res.status(400).json({ success: false, error: 'name and message are required' });
    }

    const success = db.createSmsTemplate ? db.createSmsTemplate({ name, message, active: true }) : false;
    if (!success) {
      return res.status(500).json({ success: false, error: 'Failed to create template' });
    }

    res.json({ success: true, message: 'Template created' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/sms-templates/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, message, active = true } = req.body;
    if (!id || !name || !message) {
      return res.status(400).json({ success: false, error: 'id, name, and message are required' });
    }

    const success = db.updateSmsTemplate ? db.updateSmsTemplate(id, { name, message, active }) : false;
    if (!success) {
      return res.status(404).json({ success: false, error: 'Template not found or unchanged' });
    }

    res.json({ success: true, message: 'Template updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/sms-templates/:id', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'id is required' });
    }

    const success = db.deleteSmsTemplate ? db.deleteSmsTemplate(id) : false;
    if (!success) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Auto-Reply Config API Endpoints
// ========================================

app.get('/api/auto-reply-config', (req, res) => {
  try {
    const config = db.getAutoReplyConfig ? db.getAutoReplyConfig() : null;
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auto-reply-config', (req, res) => {
  try {
    const { enabled, message, notification_email } = req.body;
    if (message === undefined) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    const success = db.saveAutoReplyConfig
      ? db.saveAutoReplyConfig({ enabled: !!enabled, message, notification_email })
      : false;
    if (!success) {
      return res.status(500).json({ success: false, error: 'Failed to save auto-reply config' });
    }
    res.json({ success: true, message: 'Auto-reply config saved' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// Call Auto-SMS Config API Endpoints
// ========================================

app.get('/api/call-auto-sms-config', (req, res) => {
  try {
    const config = db.getCallAutoSmsConfig ? db.getCallAutoSmsConfig() : null;
    res.json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/call-auto-sms-config', (req, res) => {
  try {
    const { enabled, answered_message, missed_message, delay_enabled, delay_minutes, duplicate_window, allowed_ports, allowed_extensions, call_direction } = req.body;
    if (!answered_message || !missed_message) {
      return res.status(400).json({ success: false, error: 'answered_message and missed_message are required' });
    }
    const success = db.saveCallAutoSmsConfig
      ? db.saveCallAutoSmsConfig({ 
          enabled: !!enabled, 
          answered_message, 
          missed_message,
          delay_enabled: delay_enabled !== false,
          delay_minutes: delay_minutes || 5,
          duplicate_window: duplicate_window || 10,
          allowed_ports: allowed_ports || [],
          allowed_extensions: allowed_extensions || [],
          call_direction: call_direction || 'both'
        })
      : false;
    if (!success) {
      return res.status(500).json({ success: false, error: 'Failed to save call auto-SMS config' });
    }
    res.json({ success: true, message: 'Call auto-SMS config saved' });
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
    const today = new Date().toISOString().split('T')[0];
    const telegramConfig = db.getNotificationConfig();

    // === CALL STATISTICS ===
    const callStats = db.db.prepare(`
      SELECT 
        COUNT(*) as total_calls,
        SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) as inbound_calls,
        SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) as outbound_calls,
        SUM(CASE WHEN direction = 'internal' THEN 1 ELSE 0 END) as internal_calls,
        SUM(CASE WHEN direction = 'inbound' AND status = 'answered' THEN 1 ELSE 0 END) as inbound_answered,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') THEN 1 ELSE 0 END) as inbound_missed,
        SUM(CASE WHEN direction = 'inbound' AND status IN ('missed', 'no-answer', 'noanswer') AND is_returned = 0 THEN 1 ELSE 0 END) as inbound_unreturned,
        SUM(CASE WHEN direction = 'outbound' AND status = 'answered' THEN 1 ELSE 0 END) as outbound_answered,
        SUM(CASE WHEN direction = 'outbound' AND status IN ('missed', 'no-answer', 'noanswer', 'failed', 'busy') THEN 1 ELSE 0 END) as outbound_failed,
        COUNT(DISTINCT extension) as total_extensions
      FROM call_records
      WHERE SUBSTR(start_time, 1, 10) = ?
    `).get(today);

    // === SMS STATISTICS ===
    const smsStats = db.db.prepare(`
      SELECT COUNT(*) as total_sms FROM sms_messages 
      WHERE SUBSTR(received_at, 1, 10) = ?
    `).get(today);

    const hasCallData = callStats && callStats.total_calls > 0;
    const hasSmsData = smsStats && smsStats.total_sms > 0;

    let messageText = 'MANUAL SYSTEM REPORT (Today from 00:00 to now)\n\n';
    messageText += `Date: ${today}\n`;
    messageText += `Generated: ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n`;
    messageText += `\n========== CALLS ==========\n\n`;

    if (hasCallData) {
      messageText += `Total Calls: ${callStats.total_calls}\n`;
      messageText += `Extensions with Calls: ${callStats.total_extensions}\n\n`;
      
      messageText += `--- Inbound & Outbound ---\n`;
      const totalInOut = (callStats.inbound_calls || 0) + (callStats.outbound_calls || 0);
      const totalAnswered = (callStats.inbound_answered || 0) + (callStats.outbound_answered || 0);
      const totalLost = (callStats.inbound_missed || 0) + (callStats.outbound_failed || 0);
      messageText += `[Total] ${totalInOut}\n`;
      messageText += `[Answered] ${totalAnswered}\n`;
      messageText += `[Missed/Failed] ${totalLost}\n`;
      messageText += `[Unreturned] ${callStats.inbound_unreturned || 0}\n`;
      messageText += `[Returned] ${(callStats.inbound_missed || 0) - (callStats.inbound_unreturned || 0)}\n\n`;
      
      messageText += `--- Internal ---\n`;
      messageText += `[Total] ${callStats.internal_calls || 0}\n`;
    } else {
      messageText += `No calls today.\n`;
    }

    messageText += `\n========== SMS ==========\n\n`;
    messageText += `Total Messages Received: ${hasSmsData ? smsStats.total_sms : 0}\n`;
    messageText += `\n========== END REPORT ==========\n`;

    logger.info('📊 Generating manual report — sending to all configured channels...');

    const sendResults = { telegram: false, email: false, sms: { count: 0 } };
    const channelsSent = [];
    const channelErrors = [];

    // ========== TELEGRAM ==========
    if (telegramConfig?.enabled) {
      if (!telegramConfig?.bot_token || !telegramConfig?.chat_id) {
        logger.warn('⚠️  Telegram enabled but missing credentials (bot_token or chat_id)');
        channelErrors.push('Telegram: Missing bot token or chat ID');
      } else {
        try {
          const telegramApiUrl = `https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`;
          const tgResp = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: telegramConfig.chat_id, text: messageText })
          });
          const tgJson = await tgResp.json();
          if (tgResp.ok && tgJson.ok) {
            sendResults.telegram = true;
            channelsSent.push('Telegram');
            logger.info('✅ Manual report sent via Telegram');
            db.logActivity('manual_report_telegram', 'Manual report sent via Telegram', 'success');
          } else {
            logger.error(`Telegram manual report failed: ${tgJson.description || 'Unknown error'}`);
            channelErrors.push(`Telegram: ${tgJson.description || 'Send failed'}`);
          }
        } catch (tgErr) {
          logger.error(`Telegram manual report exception: ${tgErr.message}`);
          channelErrors.push(`Telegram: ${tgErr.message}`);
        }
      }
    } else {
      logger.info('Telegram not enabled — skipping');
    }

    // ========== EMAIL ==========
    if (telegramConfig?.email_enabled) {
      const emailSent = await sendEmail('Manual System Report', messageText);
      if (emailSent) {
        sendResults.email = true;
        channelsSent.push('Email');
      } else {
        logger.warn('Email send returned false (missing SMTP config or recipients)');
        channelErrors.push('Email: SMTP not configured or no recipients set');
      }
    } else {
      logger.info('Email not enabled — skipping');
    }

    // ========== SMS ==========
    if (telegramConfig?.sms_enabled) {
      const smsRecipients = db.getSmsReportRecipients();
      if (!smsRecipients || smsRecipients.length === 0) {
        logger.warn('⚠️  SMS enabled but no recipients configured');
        channelErrors.push('SMS: No recipients configured');
      } else {
        try {
          const phoneNumbers = smsRecipients.map(r => r.phone_number);
          logger.info(`📱 Sending manual report via SMS to: ${phoneNumbers.join(', ')}`);
          const smsSent = await sendSmsReport(phoneNumbers, messageText);
          if (smsSent) {
            sendResults.sms.count = smsRecipients.length;
            channelsSent.push(`SMS (${smsRecipients.length})`);
            logger.info(`✅ Manual report sent via SMS to ${smsRecipients.length} recipient(s)`);
          } else {
            logger.error('❌ SMS bulk send returned false');
            channelErrors.push('SMS: Send failed');
          }
        } catch (smsErr) {
          logger.error(`SMS manual report exception: ${smsErr.message}`);
          channelErrors.push(`SMS: ${smsErr.message}`);
        }
      }
    } else {
      logger.info('SMS not enabled — skipping');
    }

    if (channelsSent.length === 0) {
      logger.warn('⚠️  No channels were able to send the manual report. Errors:', channelErrors);
      return res.status(400).json({
        success: false,
        error: 'No notification channels are configured or enabled.',
        details: channelErrors.length > 0 ? channelErrors.join('; ') : 'Please configure at least one channel: Telegram (bot token + chat ID), Email (SMTP + recipients), or SMS (recipients).'
      });
    }

    logger.info(`✅ Manual report delivered via: ${channelsSent.join(', ')}`);
    res.json({
      success: true,
      message: `Report sent via ${channelsSent.join(', ')}`,
      stats: { calls: callStats, sms: smsStats },
      sendResults
    });
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
    const start_time_from = req.query.start_time_from;
    const start_time_to = req.query.start_time_to;
    
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

    if (start_time_from) {
      whereConditions.push('cr.start_time >= ?');
      params.push(start_time_from);
    }

    if (start_time_to) {
      whereConditions.push('cr.start_time <= ?');
      params.push(start_time_to);
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

// PUT /api/call-records/:id/callback — mark a missed call as callback attempted
app.put('/api/call-records/:id/callback', (req, res) => {
  try {
    const { id } = req.params;
    const { callback_attempted, callback_notes } = req.body;
    const stmt = db.db.prepare(
      `UPDATE call_records SET is_returned = ?, notes = ? WHERE id = ?`
    );
    const result = stmt.run(callback_attempted ? 1 : 0, callback_notes || null, id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/missed-call-notify — email the admin about a pending missed call
app.post('/api/missed-call-notify', async (req, res) => {
  try {
    const { caller_number, call_id } = req.body;
    if (!caller_number) {
      return res.status(400).json({ success: false, error: 'caller_number is required' });
    }

    const now = new Date().toLocaleString('en-KE', {
      timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: true,
    });
    const templateText = getChannelTemplate('email', 'missed_call')
      || db.getNotificationTemplate('missed_call')
      || '\uD83D\uDD14 MISSED CALL ALERT\n\nCaller: {caller}\nTime: {time}\n\nThis call is still pending callback.';
    const body = applyTemplate(templateText, { caller: caller_number, time: now,
      extension: '', extension_name: '', date: new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' }), duration: '' });

    const sent = await sendEmail(`Pending Callback: ${caller_number}`, body);
    if (!sent) {
      return res.status(500).json({ success: false, error: 'Email not sent — check SMTP settings or enable email notifications' });
    }

    db.logActivity('callback_email_sent', `Pending callback email sent for ${caller_number}`, 'success');
    res.json({ success: true, message: `Email notification sent for ${caller_number}` });
  } catch (error) {
    logger.error(`missed-call-notify error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/call-stats', (req, res) => {
  try {
    const { extension } = req.query;
    const stats = db.getCallStats(null, extension && extension !== 'all' ? extension : null);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all-time call statistics
app.get('/api/call-stats/all-time', (req, res) => {
  try {
    const { extension } = req.query;
    const stats = db.getAllTimeCallStats(extension && extension !== 'all' ? extension : null);
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
      direction,
      limit = 100
    } = req.query;

    const filters = { limit: parseInt(limit) };
    if (sim_port) filters.sim_port = parseInt(sim_port);
    if (status) filters.status = status;
    if (since) filters.since = since;
    if (direction) filters.direction = direction;

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

// PUT /api/sms-messages/mark-all-read — mark all messages as read (requires auth)
app.put('/api/sms-messages/mark-all-read', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const [userId, userRole] = token.split(':');
    if (userRole === 'viewer') return res.status(403).json({ success: false, error: 'Viewers cannot perform this action' });

    const changed = db.markAllRead();
    db.logActivity('sms_mark_all_read', `Marked ${changed} messages as read by ${userRole}`, 'success');
    res.json({ success: true, changed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/sms-messages/all-sent', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const [userId, userRole] = token.split(':');
    if (userRole === 'viewer') return res.status(403).json({ success: false, error: 'Forbidden' });
    const count = db.deleteAllSentSMS();
    db.logActivity('sms_sent_deleted_all', `All ${count} sent SMS deleted by ${userRole}`, 'success');
    res.json({ success: true, deleted: count });
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
    const telegramConfig = db.getNotificationConfig();
    
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
// DEBUG ENDPOINTS - Missed Call Alert Diagnostics
// ========================================

// DEBUG: Check channel + notification configuration
app.get('/api/debug/notification-config', (req, res) => {
  try {
    const channelConfig = db.getChannelConfig();
    const notifSetup = db.getNotificationsSetup();
    res.json({
      success: true,
      channel_credentials: {
        bot_token: channelConfig?.bot_token ? '***' + channelConfig.bot_token.slice(-4) : 'NOT SET',
        chat_id: channelConfig?.chat_id || 'NOT SET',
        smtp_configured: !!(channelConfig?.email_smtp_host && channelConfig?.email_smtp_user && channelConfig?.email_smtp_pass),
        updated_at: channelConfig?.updated_at,
      },
      notification_preferences: {
        telegram_enabled: notifSetup?.telegram_enabled || 0,
        email_enabled: notifSetup?.email_enabled || 0,
        notify_missed_calls: notifSetup?.notify_missed_calls ?? 1,
        notify_new_sms: notifSetup?.notify_new_sms || 0,
        notify_system_errors: notifSetup?.notify_system_errors ?? 1,
        daily_report_enabled: notifSetup?.daily_report_enabled || 0,
        daily_report_time: notifSetup?.daily_report_time || '18:00',
      },
      configOK: !!(notifSetup?.telegram_enabled && channelConfig?.bot_token && channelConfig?.chat_id),
      note: 'telegram_enabled flag in notification_preferences must be 1 for alerts to work',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DEBUG: Check recent missed calls in database
app.get('/api/debug/missed-calls', (req, res) => {
  try {
    const telegramConfig = db.getNotificationConfig();
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

    const telegramConfig = db.getNotificationConfig();

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
    const telegramConfig = db.getNotificationConfig();
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

// ==================== CLOCK IN / OUT ====================

// Ensure agent_shifts table exists
db.db.exec(`
  CREATE TABLE IF NOT EXISTS agent_shifts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    clock_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out DATETIME,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// POST /api/clock-legacy — verify PIN, toggle clock in or out (legacy users table)
app.post('/api/clock-legacy', (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || String(pin).length < 4) {
      return res.status(400).json({ success: false, error: 'Invalid PIN' });
    }

    const user = db.db.prepare('SELECT id, name, email FROM users WHERE pin = ? AND is_active = 1').get(String(pin));
    if (!user) return res.status(401).json({ success: false, error: 'Invalid PIN' });

    // Check if already clocked in (active shift with no clock_out)
    const existing = db.db.prepare(
      "SELECT id FROM agent_shifts WHERE user_id = ? AND status = 'active' AND clock_out IS NULL"
    ).get(user.id);

    if (existing) {
      // Clock out
      db.db.prepare(
        "UPDATE agent_shifts SET clock_out = CURRENT_TIMESTAMP, status = 'completed' WHERE id = ?"
      ).run(existing.id);
      return res.json({ success: true, action: 'clock_out', user: { name: user.name, email: user.email } });
    } else {
      // Clock in
      db.db.prepare(
        "INSERT INTO agent_shifts (user_id, clock_in, status) VALUES (?, CURRENT_TIMESTAMP, 'active')"
      ).run(user.id);
      return res.json({ success: true, action: 'clock_in', user: { name: user.name, email: user.email } });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/clock/active-legacy — list users currently on shift (legacy users table)
app.get('/api/clock/active-legacy', (req, res) => {
  try {
    const shifts = db.db.prepare(`
      SELECT s.id, s.clock_in, u.id as user_id, u.name, u.email
      FROM agent_shifts s
      JOIN users u ON s.user_id = u.id
      WHERE s.status = 'active' AND s.clock_out IS NULL
      ORDER BY s.clock_in ASC
    `).all();
    res.json({ success: true, data: shifts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== END CLOCK IN / OUT ====================

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
// STAFF MANAGEMENT API ENDPOINTS
// ========================================

// Agents
app.post('/api/agents', (req, res) => {
  try {
    const { name, pin, email, phone, extension, telegram_chat_id, notification_channel } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });
    
    const agent = db.createAgent({ name, pin, email, phone, extension, telegram_chat_id, notification_channel });
    if (agent) {
      res.json({ success: true, data: agent });
      db.logActivity('agent_created', `Agent ${name} created`, 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to create agent' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/agents', (req, res) => {
  try {
    const agents = db.getAgents();
    res.json({ success: true, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/agents/:id', (req, res) => {
  try {
    const agent = db.getAgentById(req.params.id);
    if (agent) {
      res.json({ success: true, data: agent });
    } else {
      res.status(404).json({ success: false, error: 'Agent not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/agents/:id', (req, res) => {
  try {
    const { name, email, phone, extension, telegram_chat_id, notification_channel, is_active } = req.body;
    const success = db.updateAgent(req.params.id, { name, email, phone, extension, telegram_chat_id, notification_channel, is_active });
    if (success) {
      const agent = db.getAgentById(req.params.id);
      res.json({ success: true, data: agent });
      db.logActivity('agent_updated', `Agent ${name} updated`, 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to update agent' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/agents/:id/pin', (req, res) => {
  try {
    const { newPin } = req.body;
    if (!newPin) return res.status(400).json({ success: false, error: 'newPin is required' });
    
    const success = db.updateAgentPin(req.params.id, newPin);
    if (success) {
      res.json({ success: true, message: 'PIN updated' });
      db.logActivity('agent_pin_changed', `PIN updated for agent`, 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to update PIN' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const isShiftAlertAction = (action) => {
  return [
    'clock_in',
    'clock_out',
    'swap_request',
    'swap_approved',
    'swap_rejected',
    'reassign',
    'rating_notification',
    'weekly_rating_digest',
  ].includes(action);
};

const buildShiftAlertMessage = (payload = {}) => {
  const now = new Date().toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  const action = payload.action || 'shift_update';

  // Use custom DB template if one has been configured (Telegram channel)
  const shiftTemplate = getChannelTemplate('tg', 'shift_change');
  if (shiftTemplate) {
    const agentName = payload.agent_name || payload.requester_name ||
      payload.original_agent_name || payload.new_agent_name || '-';
    return applyTemplate(shiftTemplate, { action, agent: agentName, time: now, ...payload });
  }

  if (payload.message) return payload.message;

  switch (action) {
    case 'clock_in':
      return `🕐 Clock In\nAgent: ${payload.agent_name || 'Unknown'}\nTime: ${now}`;
    case 'clock_out':
      return `✅ Clock Out\nAgent: ${payload.agent_name || 'Unknown'}\nTime: ${now}`;
    case 'swap_request':
      return `🔄 Shift Swap Request\nRequester: ${payload.requester_name || '-'}\nTarget: ${payload.target_name || '-'}\nReason: ${payload.reason || '-'}\nTime: ${now}`;
    case 'swap_approved':
      return `✅ Shift Swap Approved\nRequester: ${payload.requester_name || '-'}\nTarget: ${payload.target_name || '-'}\nTime: ${now}`;
    case 'swap_rejected':
      return `❌ Shift Swap Rejected\nRequester: ${payload.requester_name || '-'}\nTarget: ${payload.target_name || '-'}\nReason: ${payload.reason || '-'}\nTime: ${now}`;
    case 'reassign':
      return `🔁 Shift Reassigned\nFrom: ${payload.original_agent_name || '-'}\nTo: ${payload.new_agent_name || '-'}\nDate: ${payload.shift_date || '-'}\nTime: ${payload.shift_time || '-'}\nReason: ${payload.reason || '-'}\nLogged: ${now}`;
    case 'rating_notification':
      return `⭐ Agent Rating\nAgent: ${payload.agent_name || payload.agent_id || '-'}\nRating: ${payload.rating || '-'} / 5\nComment: ${payload.comment || '-'}\nTime: ${now}`;
    case 'weekly_rating_digest':
      return `📊 Weekly Rating Digest\nGenerated: ${now}`;
    default:
      return `📢 Shift Update\nAction: ${action}\nTime: ${now}`;
  }
};

const dispatchShiftTelegramAlert = async (payload = {}) => {
  const telegramConfig = db.getNotificationConfig();

  if (!telegramConfig?.enabled || !telegramConfig?.bot_token) {
    return { sent: false, reason: 'telegram_disabled_or_unconfigured' };
  }

  if (isShiftAlertAction(payload.action) && telegramConfig.notify_shift_changes === false) {
    return { sent: false, reason: 'shift_notifications_disabled' };
  }

  const chatId = telegramConfig.chat_id ? String(telegramConfig.chat_id) : '';
  if (!chatId) {
    return { sent: false, reason: 'no_recipients' };
  }

  const text = buildShiftAlertMessage(payload);
  const endpoint = `https://api.telegram.org/bot${telegramConfig.bot_token}/sendMessage`;

  const results = await Promise.allSettled(
    [
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      }),
    ]
  );

  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  return {
    sent: successCount > 0,
    successCount,
    totalRecipients: 1,
  };
};

// Clock In/Out
app.post('/api/clock', (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ success: false, error: 'PIN is required' });
    
    const agent = db.verifyAgentPin(pin);
    if (!agent) {
      return res.status(401).json({ success: false, error: 'Invalid PIN' });
    }
    
    const activeShift = db.getActiveShift(agent.id);
    
    if (activeShift) {
      // Clock out
      const success = db.clockOut(agent.id);
      if (success) {
        dispatchShiftTelegramAlert({
          action: 'clock_out',
          agent_id: agent.id,
          agent_name: agent.name,
        }).catch((e) => logger.debug('Clock out notify failed:', e.message));
        
        res.json({ success: true, action: 'clock_out', user: { name: agent.name, email: agent.email } });
        db.logActivity('clock_out', `${agent.name} clocked out`, 'success');
      }
    } else {
      // Clock in
      const shift = db.clockIn(agent.id);
      if (shift) {
        dispatchShiftTelegramAlert({
          action: 'clock_in',
          agent_id: agent.id,
          agent_name: agent.name,
        }).catch((e) => logger.debug('Clock in notify failed:', e.message));
        
        res.json({ success: true, action: 'clock_in', user: { name: agent.name, email: agent.email } });
        db.logActivity('clock_in', `${agent.name} clocked in`, 'success');
      }
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/clock/active', (req, res) => {
  try {
    const activeShifts = db.getActiveShifts();
    res.json({ success: true, data: activeShifts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/clock/history/:agentId', (req, res) => {
  try {
    const days = req.query.days || 30;
    const history = db.getShiftHistory(req.params.agentId, parseInt(days));
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Shift Schedule
app.post('/api/shift-schedule', (req, res) => {
  try {
    const { agent_id, shift_date, start_time, end_time, notes } = req.body;
    if (!agent_id || !shift_date || !start_time || !end_time) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const success = db.createShiftSchedule({ agent_id, shift_date, start_time, end_time, notes });
    if (success) {
      res.json({ success: true, message: 'Shift scheduled' });
      db.logActivity('shift_scheduled', `Shift scheduled for ${shift_date}`, 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to create schedule' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/shift-schedule/:agentId', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const schedules = db.getShiftSchedule(req.params.agentId, start, end);
    res.json({ success: true, data: schedules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/shift-schedule', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const schedules = db.getAllSchedules(start, end);
    res.json({ success: true, data: schedules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/shift-schedule/:id', requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const success = db.deleteSchedule(req.params.id);
    if (success) {
      res.json({ success: true, message: 'Schedule deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Schedule not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Shift Swap Requests
app.post('/api/shift-swap-requests', (req, res) => {
  try {
    const { requester_agent_id, requester_shift_id, target_agent_id, target_shift_id, reason } = req.body;
    const success = db.createSwapRequest({ requester_agent_id, requester_shift_id, target_agent_id, target_shift_id, reason });
    if (success) {
      res.json({ success: true, message: 'Swap request created' });
      db.logActivity('swap_request_created', 'Shift swap request created', 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to create swap request' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/shift-swap-requests', (req, res) => {
  try {
    const { status } = req.query;
    const requests = db.getSwapRequests(status || 'pending');
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/shift-swap-requests/:id/approve', (req, res) => {
  try {
    const { reviewedBy } = req.body;
    const success = db.approveSwapRequest(req.params.id, reviewedBy);
    if (success) {
      res.json({ success: true, message: 'Swap request approved' });
      db.logActivity('swap_request_approved', 'Shift swap approved', 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to approve swap request' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/shift-swap-requests/:id/reject', (req, res) => {
  try {
    const { reviewedBy, reason } = req.body;
    const success = db.rejectSwapRequest(req.params.id, reviewedBy, reason);
    if (success) {
      res.json({ success: true, message: 'Swap request rejected' });
      db.logActivity('swap_request_rejected', 'Shift swap rejected', 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to reject swap request' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Agent Ratings
app.post('/api/agent-ratings', (req, res) => {
  try {
    const { agent_id, rating, comment, rated_by } = req.body;
    if (!agent_id || !rating) return res.status(400).json({ success: false, error: 'agent_id and rating are required' });
    
    const success = db.rateAgent({ agent_id, rating, comment, rated_by });
    if (success) {
      res.json({ success: true, message: 'Rating saved' });
      db.logActivity('agent_rated', `Agent rated ${rating}/5`, 'success');
    } else {
      res.status(400).json({ success: false, error: 'Failed to save rating' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/agent-ratings/:agentId', (req, res) => {
  try {
    const ratings = db.getAgentRatings(req.params.agentId);
    const avgRating = db.getAgentAverageRating(req.params.agentId);
    res.json({ success: true, data: { ratings, average: avgRating } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// All agent ratings (leaderboard)
app.get('/api/agent-ratings', (req, res) => {
  try {
    const rows = db.db.prepare(`
      SELECT ar.*, a.name as agent_name
      FROM agent_ratings ar
      JOIN agents a ON ar.agent_id = a.id
      ORDER BY ar.created_at DESC
      LIMIT 200
    `).all();
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clock today — all shifts clocked in today
app.get('/api/clock/today', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rows = db.db.prepare(`
      SELECT ash.*, a.name, a.extension, a.role
      FROM agent_shifts ash
      JOIN agents a ON ash.agent_id = a.id
      WHERE date(ash.clock_in) = ?
      ORDER BY ash.clock_in DESC
    `).all(today);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk create shift schedules
app.post('/api/shift-schedule/bulk', (req, res) => {
  try {
    const entries = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'Expected an array of schedule entries' });
    }
    const insert = db.db.prepare(
      'INSERT INTO shift_schedule (agent_id, shift_date, start_time, end_time, notes) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMany = db.db.transaction((items) => {
      for (const item of items) {
        insert.run(item.agent_id, item.shift_date, item.start_time, item.end_time, item.notes || null);
      }
    });
    insertMany(entries);
    res.json({ success: true, message: `${entries.length} shifts scheduled` });
    db.logActivity('shifts_bulk_scheduled', `Bulk scheduled ${entries.length} shifts`, 'success');
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update shift schedule (time edit)
app.put('/api/shift-schedule/:id', (req, res) => {
  try {
    const { start_time, end_time, notes } = req.body;
    const result = db.db.prepare(
      'UPDATE shift_schedule SET start_time = COALESCE(?, start_time), end_time = COALESCE(?, end_time), notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(start_time || null, end_time || null, notes || null, req.params.id);
    if (result.changes > 0) {
      res.json({ success: true, message: 'Schedule updated' });
    } else {
      res.status(404).json({ success: false, error: 'Schedule not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reassign shift to a different agent
app.post('/api/shift-schedule/:id/reassign', (req, res) => {
  try {
    const { agent_id, newAgentId, notes, reason } = req.body;
    const targetAgentId = agent_id || newAgentId;
    if (!targetAgentId) return res.status(400).json({ success: false, error: 'agent_id required' });
    const result = db.db.prepare(
      'UPDATE shift_schedule SET agent_id = ?, notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(targetAgentId, notes || reason || null, req.params.id);
    if (result.changes > 0) {
      res.json({ success: true, message: 'Shift reassigned' });
      db.logActivity('shift_reassigned', `Shift ${req.params.id} reassigned to agent ${targetAgentId}`, 'success');
    } else {
      res.status(404).json({ success: false, error: 'Schedule not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Agent daily stats — per agent shift + call stats for a given date
app.get('/api/agent-daily-stats', (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const agents = db.db.prepare('SELECT id, name, extension, role FROM agents WHERE is_active = 1').all();
    const stats = agents.map((agent) => {
      const shifts = db.db.prepare(
        'SELECT * FROM agent_shifts WHERE agent_id = ? AND date(clock_in) = ?'
      ).all(agent.id, date);
      const scheduled = db.db.prepare(
        'SELECT * FROM shift_schedule WHERE agent_id = ? AND shift_date = ?'
      ).all(agent.id, date);
      const totalMinutes = shifts.reduce((sum, s) => {
        if (!s.clock_out) return sum;
        return sum + Math.round((new Date(s.clock_out) - new Date(s.clock_in)) / 60000);
      }, 0);

      let callStats = { total: 0, answered: 0, missed: 0 };
      if (agent.extension) {
        const dayStart = `${date}T00:00:00`;
        const dayEnd = `${date}T23:59:59`;
        const calls = db.db.prepare(
          "SELECT status FROM call_records WHERE extension = ? AND start_time BETWEEN ? AND ?"
        ).all(agent.extension, dayStart, dayEnd);
        callStats.total = calls.length;
        callStats.answered = calls.filter(c => c.status === 'answered').length;
        callStats.missed = calls.filter(c => c.status === 'missed' || c.status === 'no_answer').length;
      }

      return {
        agent_id: agent.id,
        name: agent.name,
        extension: agent.extension,
        role: agent.role,
        shifts_count: shifts.length,
        scheduled_count: scheduled.length,
        total_minutes: totalMinutes,
        call_total: callStats.total,
        call_answered: callStats.answered,
        call_missed: callStats.missed,
      };
    });
    res.json({ success: true, data: stats, date });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Notify shift change (fire-and-forget Telegram notification)
app.post('/api/notify/shift-change', (req, res) => {
  try {
    const payload = req.body || {};
    const action = payload.action || payload.type || 'shift_update';

    dispatchShiftTelegramAlert(payload)
      .then((result) => {
        db.logActivity(
          'shift_notification',
          `Shift notification: ${action} (${result.successCount || 0}/${result.totalRecipients || 0} recipients)`,
          result.sent ? 'success' : 'warning'
        );
      })
      .catch((error) => {
        db.logActivity('shift_notification', `Shift notification failed: ${action} (${error.message})`, 'error');
        logger.error('Shift notification failed:', error.message);
      });

    res.json({ success: true, message: 'Notification queued', action });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// System Update endpoints
// ─────────────────────────────────────────────────────────────────────────────

const getProjectDir = () => path.join(__dirname, '..', '..');

const getAuthenticatedRepoUrl = () => {
  if (!SYSTEM_UPDATE_TOKEN) return SYSTEM_UPDATE_REPO;
  const repoPath = SYSTEM_UPDATE_REPO.replace(/^https?:\/\/github\.com\//, '');
  return `https://x-access-token:${SYSTEM_UPDATE_TOKEN}@github.com/${repoPath}`;
};

const redactUpdateSecrets = (value) => {
  let text = String(value || '');
  if (SYSTEM_UPDATE_TOKEN) {
    const safeToken = SYSTEM_UPDATE_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(safeToken, 'g'), '***');
  }
  return text;
};

// GET current git version info
app.get('/api/system/version', (req, res) => {
  try {
    const projectDir = getProjectDir();
    const hash = execSync('git rev-parse --short HEAD', { cwd: projectDir }).toString().trim();
    const date = execSync('git log -1 --format=%cI', { cwd: projectDir }).toString().trim();
    const message = execSync('git log -1 --format=%s', { cwd: projectDir }).toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir }).toString().trim();
    res.json({ success: true, data: { hash, date, message, branch, lastCompletedAt: updateState.lastCompletedAt } });
  } catch (error) {
    res.json({ success: true, data: { hash: 'unknown', date: 'unknown', message: 'unknown', branch: 'unknown', lastCompletedAt: updateState.lastCompletedAt } });
  }
});

// GET check if a newer update exists in remote branch
app.get('/api/system/update/check', (req, res) => {
  try {
    if (!SYSTEM_UPDATE_TOKEN) {
      return res.json({
        success: true,
        data: {
          configured: false,
          updateAvailable: false,
          branch: SYSTEM_UPDATE_BRANCH,
          reason: 'SYSTEM_UPDATE_TOKEN missing on backend',
          checkedAt: new Date().toISOString(),
        },
      });
    }

    const projectDir = getProjectDir();
    const authUrl = getAuthenticatedRepoUrl();
    const localHash = execSync('git rev-parse HEAD', { cwd: projectDir }).toString().trim();
    const remoteRaw = execSync(`git ls-remote "${authUrl}" refs/heads/${SYSTEM_UPDATE_BRANCH}`, { cwd: projectDir }).toString().trim();
    const remoteHash = remoteRaw.split(/\s+/)[0] || '';
    const updateAvailable = Boolean(remoteHash && localHash && remoteHash !== localHash);

    updateState.lastCheckedAt = new Date().toISOString();
    updateState.updateAvailable = updateAvailable;

    return res.json({
      success: true,
      data: {
        configured: true,
        branch: SYSTEM_UPDATE_BRANCH,
        localHash: localHash.slice(0, 7),
        remoteHash: remoteHash.slice(0, 7),
        updateAvailable,
        checkedAt: updateState.lastCheckedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: redactUpdateSecrets(error.message) });
  }
});

// GET current update job status + logs
app.get('/api/system/update/status', (req, res) => {
  res.json({
    success: true,
    data: {
      running:   updateState.running,
      logs:      updateState.logs,
      exitCode:  updateState.exitCode,
      startedAt: updateState.startedAt,
      lastCompletedAt: updateState.lastCompletedAt,
      lastCheckedAt: updateState.lastCheckedAt,
      updateAvailable: updateState.updateAvailable,
    },
  });
});

// POST start a system update using backend-configured repo/token
app.post('/api/system/update', (req, res) => {
  if (updateState.running) {
    return res.status(409).json({ success: false, error: 'Update already in progress' });
  }

  if (!SYSTEM_UPDATE_TOKEN) {
    return res.status(400).json({ success: false, error: 'Backend update token is not configured (SYSTEM_UPDATE_TOKEN).' });
  }

  const projectDir = getProjectDir();
  const branch = SYSTEM_UPDATE_BRANCH;
  const authUrl = getAuthenticatedRepoUrl();

  updateState = {
    ...updateState,
    running: true,
    logs: [],
    exitCode: null,
    startedAt: new Date().toISOString(),
  };
  res.json({ success: true, message: 'Update started' });

  const { exec } = require('child_process');

  const addLog = (line) => {
    if (!line) return;
    updateState.logs.push(redactUpdateSecrets(line));
  };

  const runStep = (cmd, label) => new Promise((resolve, reject) => {
    addLog(`[${new Date().toISOString()}] ▶ ${label}`);
    exec(cmd, { cwd: projectDir, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', HOME: process.env.HOME || '/root' } }, (err, stdout, stderr) => {
      if (stdout) stdout.trim().split('\n').filter(Boolean).forEach(addLog);
      if (stderr) stderr.trim().split('\n').filter(Boolean).forEach(addLog);
      if (err) {
        addLog(`✖ ${label} failed`);
        reject(new Error(`${label} failed`));
      } else {
        addLog(`✔ ${label} done`);
        resolve();
      }
    });
  });

  (async () => {
    const fs = require('fs');
    const dbPath = path.join(projectDir, 'public/local-agent/sms.db');
    const dbBackup = '/tmp/sms.db.update-backup';

    try {
      await runStep(`git fetch "${authUrl}" ${branch}`, `Fetching branch "${branch}"`);

      // Check if package.json will change so we know whether to npm install
      let pkgChanged = false;
      try {
        const diffOut = execSync('git diff HEAD FETCH_HEAD -- package.json', { cwd: projectDir }).toString();
        pkgChanged = diffOut.trim().length > 0;
      } catch { pkgChanged = true; }

      // Preserve live database before git reset (git reset --hard overwrites tracked files)
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, dbBackup);
        addLog(`[${new Date().toISOString()}] 💾 Database backed up before reset`);
      }

      await runStep('git reset --hard FETCH_HEAD', 'Applying update');

      // Restore live database after git reset
      if (fs.existsSync(dbBackup)) {
        fs.copyFileSync(dbBackup, dbPath);
        fs.unlinkSync(dbBackup);
        addLog(`[${new Date().toISOString()}] 💾 Database restored`);
      }

      if (pkgChanged) {
        addLog(`[${new Date().toISOString()}] ▶ package.json changed — installing dependencies`);
        await runStep('npm install --legacy-peer-deps 2>&1', 'Installing dependencies');
      } else {
        addLog(`[${new Date().toISOString()}] ℹ package.json unchanged — skipping npm install`);
      }

      await runStep('npm run build 2>&1', 'Building application');

      addLog(`[${new Date().toISOString()}] ✅ Update complete! Reloading service to apply new code and run any database migrations...`);
      db.logActivity('system_update', `System updated to ${branch}`, 'success');
      updateState.running = false;
      updateState.exitCode = 0;
      updateState.lastCompletedAt = new Date().toISOString();
      updateState.updateAvailable = false;

      // Reload PM2 processes so new code takes effect and runMigrations() fires automatically
      // Short delay so the status writes above are visible on one last frontend poll
      setTimeout(() => {
        try { execSync('pm2 reload api-server --update-env', { stdio: 'ignore' }); } catch (e) {}
        try { execSync('pm2 reload tg400-agent --update-env', { stdio: 'ignore' }); } catch (e) {}
      }, 500);
    } catch (err) {
      // Always restore DB even when the update fails mid-way
      if (fs.existsSync(dbBackup)) {
        try { fs.copyFileSync(dbBackup, dbPath); fs.unlinkSync(dbBackup); } catch (e) {}
        addLog(`[${new Date().toISOString()}] 💾 Database restored after failed update`);
      }
      addLog(`[${new Date().toISOString()}] ✖ Update failed: ${redactUpdateSecrets(err.message)}`);
      db.logActivity('system_update', `System update failed: ${redactUpdateSecrets(err.message)}`, 'error');
      updateState.running = false;
      updateState.exitCode = 1;
    }
  })();
});

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

  // Schedule automatic "mark all as read" at 00:00:00 EAT every day
  (function scheduleEATMidnightMark() {
    try {
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();

      // Compute UTC timestamp for today's 00:00 EAT (EAT = UTC+3).
      // Midnight EAT corresponds to UTC time = 00:00 EAT - 3 hours.
      const today = new Date();
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth();
      const day = today.getUTCDate();
      const midnightEATUtc = Date.UTC(year, month, day, 0, 0, 0) - (3 * 60 * 60 * 1000);

      let nextRun = midnightEATUtc;
      if (nextRun <= now) nextRun += MS_PER_DAY;

      const delay = nextRun - now;
      logger.info(`[SCHED] Scheduling daily EAT-midnight mark-all-read in ${Math.round(delay / 1000)}s`);

      setTimeout(async function runAndReschedule() {
        try {
          const changed = db.markAllRead();
          logger.info(`[SCHED] markAllRead executed: ${changed} messages marked read`);
          db.logActivity('sms_mark_all_read', `Automatic nightly mark-all-read: ${changed} messages`, 'info');
        } catch (e) {
          logger.warn(`[SCHED] markAllRead failed: ${e.message}`);
        }

        // Schedule next run using setTimeout again to avoid drift
        scheduleEATMidnightMark();
      }, delay);
    } catch (e) {
      logger.warn(`[SCHED] Failed to schedule EAT midnight mark: ${e.message}`);
    }
  })();

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
    // Skip silently if TG400 is not connected
    if (!tg400Api || !tg400Api.isConnected || !tg400Api.isAuthenticated) {
      logger.debug('[GSM CHECK] TG400 not connected — skipping GSM span check');
      return;
    }
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

app.use((req, res) => {
  logger.warn(`[404-HANDLER] Unmatched request: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});
