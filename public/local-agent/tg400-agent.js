#!/usr/bin/env node
/**
 * TG400 Local Polling Agent v4.0 - AI-Powered Auto-Update
 * 
 * Features:
 * - Persistent state file (survives restarts)
 * - Offline message queue (stores messages when cloud unreachable)
 * - Dedicated heartbeat for reliable status monitoring
 * - Automatic retry with exponential backoff
 * - Graceful shutdown with state preservation
 * - AI-powered error diagnostics
 * - Self-healing auto-recovery
 * - Dynamic configuration from cloud
 * - Failed sync auto-reprocessing
 * - AUTO-UPDATE: Checks for new versions and self-updates
 * - PREDICTIVE MAINTENANCE: AI predicts issues before they happen
 * 
 * Installation: See /local-agent/install.sh
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

// ============ CONFIGURATION ============
const CONFIG = {
  // TG400 Gateway Settings
  TG400_IP: process.env.TG400_IP || '192.168.5.3',
  TG400_USERNAME: process.env.TG400_USERNAME || 'admin',
  TG400_PASSWORD: process.env.TG400_PASSWORD || '',
  TG400_PORTS: (process.env.TG400_PORTS || '1,2,3,4').split(',').map(Number),
  
  // S100 PBX Settings (for CDR)
  PBX_IP: process.env.PBX_IP || '192.168.5.1',
  PBX_USERNAME: process.env.PBX_USERNAME || 'admin',
  PBX_PASSWORD: process.env.PBX_PASSWORD || '',
  PBX_WEB_PORT: parseInt(process.env.PBX_WEB_PORT || '443', 10),
  
  // Supabase Settings
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://aougsyziktukjvkmglzb.supabase.co',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdWdzeXppa3R1a2p2a21nbHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDg5NTYsImV4cCI6MjA4NDkyNDk1Nn0.dcsZwEJXND9xdNA1dR-uHH7r6WylGwL7xVKJSFL_C44',
  
  // Agent Settings (defaults, can be overridden by cloud config)
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '30000', 10),
  HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL || '60000', 10),
  CDR_POLL_INTERVAL: parseInt(process.env.CDR_POLL_INTERVAL || '60000', 10),
  CALL_QUEUE_POLL_INTERVAL: parseInt(process.env.CALL_QUEUE_POLL_INTERVAL || '5000', 10),
  CONFIG_SYNC_INTERVAL: parseInt(process.env.CONFIG_SYNC_INTERVAL || '300000', 10), // 5 minutes
  UPDATE_CHECK_INTERVAL: parseInt(process.env.UPDATE_CHECK_INTERVAL || '300000', 10), // 5 minutes
  PREDICTIVE_CHECK_INTERVAL: parseInt(process.env.PREDICTIVE_CHECK_INTERVAL || '900000', 10), // 15 minutes
  STATE_FILE: process.env.STATE_FILE || path.join(__dirname, '.agent-state.json'),
  QUEUE_FILE: process.env.QUEUE_FILE || path.join(__dirname, '.message-queue.json'),
  
  // Self-healing settings
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
  RETRY_BACKOFF_MULTIPLIER: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
  AUTO_RESTART_DELAY: parseInt(process.env.AUTO_RESTART_DELAY || '10000', 10),
  ERROR_THRESHOLD_FOR_RESTART: parseInt(process.env.ERROR_THRESHOLD_FOR_RESTART || '10', 10),
  
  // Git-based auto-update settings
  AUTO_UPDATE_ENABLED: process.env.AUTO_UPDATE_ENABLED !== 'false',
  REPO_DIR: process.env.REPO_DIR || '/opt/tg400-repo',
  GITHUB_REPO_URL: process.env.GITHUB_REPO_URL || '',
  AGENT_SOURCE_PATH: 'public/local-agent/tg400-agent.js', // Path within the repo
  AGENT_INSTALL_PATH: process.env.AGENT_INSTALL_PATH || path.join(__dirname, 'agent.js'),
  WEB_BUILD_ENABLED: process.env.WEB_BUILD_ENABLED !== 'false',
  WEB_SERVE_DIR: process.env.WEB_SERVE_DIR || '/var/www/sms-gateway', // nginx root
  
  // Agent Identity
  AGENT_ID: process.env.AGENT_ID || `agent-${crypto.randomBytes(4).toString('hex')}`,
  VERSION: '4.1.0',
};
// ========================================

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class TG400Agent {
  constructor(config) {
    this.config = { ...config };
    this.dynamicConfig = {}; // Overrides from cloud
    this.authHeader = Buffer.from(`${config.TG400_USERNAME}:${config.TG400_PASSWORD}`).toString('base64');
    this.pbxAuthHeader = Buffer.from(`${config.PBX_USERNAME}:${config.PBX_PASSWORD}`).toString('base64');
    this.processedIds = new Set();
    this.processedCallIds = new Set();
    this.messageQueue = [];
    this.isRunning = false;
    this.messagesSynced = 0;
    this.callsSynced = 0;
    this.errorsCount = 0;
    this.consecutiveErrors = 0;
    this.startTime = new Date();
    this.lastCdrTimestamp = null;
    this.intervals = [];
    
    // Load persistent state
    this.loadState();
    this.loadQueue();
  }

  // ========== DYNAMIC CONFIGURATION ==========

  getConfig(key) {
    // Dynamic config from cloud takes precedence
    if (this.dynamicConfig[key] !== undefined) {
      return this.dynamicConfig[key];
    }
    return this.config[key];
  }

  async syncConfigFromCloud() {
    try {
      const url = `${this.config.SUPABASE_URL}/rest/v1/agent_config?select=config_key,config_value`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
        },
      });

      if (!response.ok) return;

      const configs = await response.json();
      const configMap = {
        poll_interval: 'POLL_INTERVAL',
        heartbeat_interval: 'HEARTBEAT_INTERVAL',
        cdr_poll_interval: 'CDR_POLL_INTERVAL',
        retry_backoff_multiplier: 'RETRY_BACKOFF_MULTIPLIER',
        max_retries: 'MAX_RETRIES',
      };

      let updated = false;
      for (const cfg of configs) {
        const envKey = configMap[cfg.config_key];
        if (envKey && cfg.config_value?.value !== undefined) {
          const newValue = cfg.config_value.value;
          if (this.dynamicConfig[envKey] !== newValue) {
            this.dynamicConfig[envKey] = newValue;
            updated = true;
            this.log('info', `Config updated from cloud: ${envKey}=${newValue}`);
          }
        }
      }

      if (updated) {
        this.restartPollingLoops();
      }
    } catch (error) {
      this.log('warn', `Failed to sync config: ${error.message}`);
    }
  }

  restartPollingLoops() {
    // Clear existing intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    // Restart with new intervals
    this.startPollingLoops();
    this.log('info', 'Polling loops restarted with updated configuration');
  }

  // ========== STATE PERSISTENCE ==========
  
  loadState() {
    try {
      if (fs.existsSync(this.config.STATE_FILE)) {
        const data = JSON.parse(fs.readFileSync(this.config.STATE_FILE, 'utf8'));
        this.processedIds = new Set(data.processedIds || []);
        this.processedCallIds = new Set(data.processedCallIds || []);
        this.messagesSynced = data.messagesSynced || 0;
        this.callsSynced = data.callsSynced || 0;
        this.lastCdrTimestamp = data.lastCdrTimestamp || null;
        this.log('info', `Loaded state: ${this.processedIds.size} SMS IDs, ${this.processedCallIds.size} call IDs`);
      }
    } catch (err) {
      this.log('warn', `Failed to load state: ${err.message}`);
    }
  }

  saveState() {
    try {
      const data = {
        processedIds: Array.from(this.processedIds).slice(-10000),
        processedCallIds: Array.from(this.processedCallIds).slice(-10000),
        messagesSynced: this.messagesSynced,
        callsSynced: this.callsSynced,
        lastCdrTimestamp: this.lastCdrTimestamp,
        lastSaved: new Date().toISOString(),
      };
      fs.writeFileSync(this.config.STATE_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      this.log('error', `Failed to save state: ${err.message}`);
    }
  }

  loadQueue() {
    try {
      if (fs.existsSync(this.config.QUEUE_FILE)) {
        this.messageQueue = JSON.parse(fs.readFileSync(this.config.QUEUE_FILE, 'utf8'));
        this.log('info', `Loaded ${this.messageQueue.length} queued messages`);
      }
    } catch (err) {
      this.log('warn', `Failed to load queue: ${err.message}`);
    }
  }

  saveQueue() {
    try {
      fs.writeFileSync(this.config.QUEUE_FILE, JSON.stringify(this.messageQueue, null, 2));
    } catch (err) {
      this.log('error', `Failed to save queue: ${err.message}`);
    }
  }

  // ========== LOGGING & ERROR TRACKING ==========

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: '\x1b[36mINFO\x1b[0m',
      warn: '\x1b[33mWARN\x1b[0m',
      error: '\x1b[31mERROR\x1b[0m',
      success: '\x1b[32mOK\x1b[0m',
    };
    console.log(`[${timestamp}] [${prefix[level] || level}] ${message}`, Object.keys(data).length ? JSON.stringify(data) : '');
  }

  async reportError(errorType, errorMessage, context = {}) {
    this.errorsCount++;
    this.consecutiveErrors++;

    // Log to cloud for AI diagnostics
    try {
      await this.pushToSupabase('error_logs', {
        agent_id: this.config.AGENT_ID,
        error_type: errorType,
        error_message: errorMessage,
        error_context: {
          ...context,
          consecutive_errors: this.consecutiveErrors,
          uptime_seconds: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
        },
      }, 1); // Only 1 retry for error logging

      // Request AI diagnosis for serious errors
      if (this.consecutiveErrors >= 3) {
        await this.requestAiDiagnosis(errorType, errorMessage, context);
      }
    } catch (e) {
      // Don't fail on error logging
    }

    // Check if we need to self-heal
    if (this.consecutiveErrors >= this.config.ERROR_THRESHOLD_FOR_RESTART) {
      this.log('warn', `Error threshold reached (${this.consecutiveErrors}), attempting self-heal...`);
      await this.selfHeal();
    }
  }

  async requestAiDiagnosis(errorType, errorMessage, context) {
    try {
      const response = await fetch(`${this.config.SUPABASE_URL}/functions/v1/ai-diagnostics`, {
        method: 'POST',
        headers: {
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'diagnose',
          error_data: {
            error_type: errorType,
            error_message: errorMessage,
            error_context: context,
            agent_id: this.config.AGENT_ID,
          },
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.diagnosis) {
          this.log('info', `AI Diagnosis: ${result.diagnosis.diagnosis}`);
          if (result.diagnosis.auto_fixable && result.diagnosis.fix_action) {
            await this.applyAutoFix(result.diagnosis.fix_action);
          }
        }
      }
    } catch (e) {
      // Silently fail AI diagnosis
    }
  }

  async applyAutoFix(action) {
    this.log('info', `Applying auto-fix action: ${action}`);

    switch (action) {
      case 'retry':
        // Already handled by exponential backoff
        this.consecutiveErrors = Math.max(0, this.consecutiveErrors - 2);
        break;
        
      case 'restart':
        await this.selfHeal();
        break;

      default:
        this.log('info', `Manual intervention needed for fix action: ${action}`);
    }
  }

  async selfHeal() {
    this.log('warn', 'Initiating self-healing process...');
    
    // Save state before restart
    this.saveState();
    this.saveQueue();

    // Log the self-heal attempt
    await this.pushToSupabase('activity_logs', {
      event_type: 'self_heal',
      message: `Agent self-healing after ${this.consecutiveErrors} consecutive errors`,
      severity: 'warning',
      metadata: { 
        agent_id: this.config.AGENT_ID,
        consecutive_errors: this.consecutiveErrors,
      },
    }, 1);

    // Reset error counter
    this.consecutiveErrors = 0;

    // Restart polling loops
    this.restartPollingLoops();

    // Re-sync config from cloud
    await this.syncConfigFromCloud();

    this.log('success', 'Self-healing complete');
  }

  clearError() {
    // Reset consecutive errors on success
    if (this.consecutiveErrors > 0) {
      this.consecutiveErrors = 0;
    }
  }

  // ========== GATEWAY COMMUNICATION ==========

  async fetchFromGateway(endpoint, retries = null) {
    const maxRetries = retries ?? this.getConfig('MAX_RETRIES');
    const backoffMultiplier = this.getConfig('RETRY_BACKOFF_MULTIPLIER');
    const url = `http://${this.config.TG400_IP}${endpoint}`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${this.authHeader}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        this.clearError();
        return await response.json();
      } catch (error) {
        if (attempt === maxRetries) {
          await this.reportError('gateway_fetch', error.message, { endpoint, attempts: attempt });
          return null;
        }
        await this.sleep(1000 * Math.pow(backoffMultiplier, attempt - 1));
      }
    }
    return null;
  }

  // ========== SUPABASE COMMUNICATION ==========

  async pushToSupabase(table, data, retries = null) {
    const maxRetries = retries ?? this.getConfig('MAX_RETRIES');
    const backoffMultiplier = this.getConfig('RETRY_BACKOFF_MULTIPLIER');
    const url = `${this.config.SUPABASE_URL}/rest/v1/${table}`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'apikey': this.config.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const errorText = await response.text();
          // Duplicate key error is success (message already synced)
          if (errorText.includes('duplicate key') || errorText.includes('already exists')) {
            this.clearError();
            return true;
          }
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        this.clearError();
        return true;
      } catch (error) {
        if (attempt === maxRetries) {
          if (table !== 'error_logs') { // Avoid infinite loop
            await this.reportError('supabase_push', error.message, { table, attempt });
          }
          return false;
        }
        await this.sleep(1000 * Math.pow(backoffMultiplier, attempt - 1));
      }
    }
    return false;
  }

  async upsertHeartbeat() {
    const url = `${this.config.SUPABASE_URL}/rest/v1/agent_heartbeat`;
    const data = {
      agent_id: this.config.AGENT_ID,
      last_seen_at: new Date().toISOString(),
      status: 'online',
      version: this.config.VERSION,
      hostname: os.hostname(),
      messages_synced: this.messagesSynced,
      errors_count: this.errorsCount,
      metadata: {
        uptime_seconds: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
        queue_size: this.messageQueue.length,
        processed_ids_count: this.processedIds.size,
        consecutive_errors: this.consecutiveErrors,
        dynamic_config: this.dynamicConfig,
      },
    };

    try {
      const response = await fetch(`${url}?agent_id=eq.${this.config.AGENT_ID}`, {
        method: 'PATCH',
        headers: {
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(data),
      });

      // If no rows updated, insert new
      if (response.status === 200) {
        const text = await response.text();
        if (text === '' || text === '[]') {
          await fetch(url, {
            method: 'POST',
            headers: {
              'apikey': this.config.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify(data),
          });
        }
      }
    } catch (error) {
      this.log('warn', `Heartbeat failed: ${error.message}`);
    }
  }

  // ========== SMS POLLING ==========

  async pollSmsFromPort(port) {
    const endpoints = [
      `/api/v1.0/sms/get?port=${port}`,
      `/cgi-bin/api-get_sms?port=${port}`,
      `/api/sms?port=${port}`,
    ];

    for (const endpoint of endpoints) {
      const result = await this.fetchFromGateway(endpoint);
      if (result && (result.messages || result.sms || result.data)) {
        return result.messages || result.sms || result.data || [];
      }
    }

    return [];
  }

  async processSmsMessages(messages, port) {
    let newCount = 0;

    for (const msg of messages) {
      const externalId = msg.id || msg.message_id || 
        `${port}-${msg.from || msg.sender}-${msg.time || Date.now()}-${(msg.content || msg.text || '').substring(0, 20)}`;
      
      if (this.processedIds.has(externalId)) {
        continue;
      }

      const smsData = {
        external_id: externalId,
        sim_port: port,
        sender_number: msg.from || msg.sender || msg.number || 'Unknown',
        message_content: msg.content || msg.text || msg.message || '',
        received_at: msg.time || msg.received_at || new Date().toISOString(),
        status: 'unread',
      };

      const success = await this.pushToSupabase('sms_messages', smsData);
      
      if (success) {
        this.processedIds.add(externalId);
        this.messagesSynced++;
        newCount++;
        this.log('success', `SMS synced`, { port, from: smsData.sender_number });
      } else {
        // Queue for later if cloud unreachable
        this.messageQueue.push({ table: 'sms_messages', data: smsData, timestamp: Date.now() });
        this.saveQueue();
        this.log('warn', `SMS queued for later sync`, { port, from: smsData.sender_number });
      }
    }

    return newCount;
  }

  async processQueue() {
    if (this.messageQueue.length === 0) return;

    this.log('info', `Processing ${this.messageQueue.length} queued messages...`);
    const remaining = [];

    for (const item of this.messageQueue) {
      const success = await this.pushToSupabase(item.table, item.data);
      if (!success) {
        remaining.push(item);
      } else {
        this.messagesSynced++;
      }
    }

    this.messageQueue = remaining;
    this.saveQueue();

    if (remaining.length < this.messageQueue.length) {
      this.log('success', `Queue processed: ${this.messageQueue.length - remaining.length} synced, ${remaining.length} remaining`);
    }
  }

  async updatePortStatus(port) {
    const endpoints = [
      `/api/v1.0/gsm/status?port=${port}`,
      `/cgi-bin/api-get_gsm_status?port=${port}`,
    ];

    for (const endpoint of endpoints) {
      const result = await this.fetchFromGateway(endpoint, 1);
      if (result) {
        const portData = {
          last_seen_at: new Date().toISOString(),
          signal_strength: result.signal || result.signal_strength || null,
          carrier: result.carrier || result.network || null,
        };

        await fetch(`${this.config.SUPABASE_URL}/rest/v1/sim_port_config?port_number=eq.${port}`, {
          method: 'PATCH',
          headers: {
            'apikey': this.config.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(portData),
        });
        break;
      }
    }
  }

  // ========== CDR POLLING (S100 PBX) ==========

  async fetchFromPbx(endpoint, retries = null) {
    const maxRetries = retries ?? this.getConfig('MAX_RETRIES');
    const backoffMultiplier = this.getConfig('RETRY_BACKOFF_MULTIPLIER');
    const protocol = this.config.PBX_WEB_PORT === 443 ? 'https' : 'http';
    const url = `${protocol}://${this.config.PBX_IP}:${this.config.PBX_WEB_PORT}${endpoint}`;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${this.pbxAuthHeader}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          // Skip TLS validation for self-signed certs
          ...(protocol === 'https' && { rejectUnauthorized: false }),
        });
        
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        this.clearError();
        return await response.json();
      } catch (error) {
        if (attempt === maxRetries) {
          await this.reportError('pbx_fetch', error.message, { endpoint, attempts: attempt });
          return null;
        }
        await this.sleep(1000 * Math.pow(backoffMultiplier, attempt - 1));
      }
    }
    return null;
  }

  async pollCdr() {
    const endpoints = [
      '/api/v1.0/cdr/get',
      '/api/cdr',
      '/cgi-bin/api-get_cdr',
      '/api/v2.0.0/cdr/search',
    ];

    let cdrRecords = null;
    for (const endpoint of endpoints) {
      const since = this.lastCdrTimestamp || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = await this.fetchFromPbx(`${endpoint}?start_time=${encodeURIComponent(since)}`);
      
      if (result && (result.cdr || result.data || result.records)) {
        cdrRecords = result.cdr || result.data || result.records;
        break;
      }
    }

    if (!cdrRecords || !Array.isArray(cdrRecords)) {
      return 0;
    }

    let newCount = 0;
    for (const record of cdrRecords) {
      const externalId = record.id || record.uniqueid || record.call_id || 
        `${record.start || record.calldate}-${record.src || record.caller}-${record.dst || record.callee}`;
      
      if (this.processedCallIds.has(externalId)) {
        continue;
      }

      const callData = {
        external_id: externalId,
        caller_number: record.src || record.caller || record.from || 'Unknown',
        callee_number: record.dst || record.callee || record.to || 'Unknown',
        caller_name: record.clid || record.caller_name || null,
        callee_name: record.callee_name || null,
        direction: this.mapCallDirection(record),
        status: this.mapCallStatus(record.disposition || record.status),
        sim_port: record.trunk ? parseInt(record.trunk.replace(/\D/g, ''), 10) : null,
        extension: record.dstchannel || record.extension || record.ext || null,
        start_time: record.start || record.calldate || record.start_time || new Date().toISOString(),
        answer_time: record.answer || record.answer_time || null,
        end_time: record.end || record.end_time || null,
        ring_duration: parseInt(record.ring || record.ring_duration || '0', 10),
        talk_duration: parseInt(record.billsec || record.duration || record.talk_duration || '0', 10),
        hold_duration: parseInt(record.hold || record.hold_duration || '0', 10),
        total_duration: parseInt(record.duration || record.total || '0', 10),
        recording_url: record.recordingfile || record.recording || null,
        transfer_to: record.dstchannel !== record.lastdstchannel ? record.lastdstchannel : null,
        metadata: {
          raw: record,
          synced_by: this.config.AGENT_ID,
        },
      };

      const success = await this.pushToSupabase('call_records', callData);
      
      if (success) {
        this.processedCallIds.add(externalId);
        this.callsSynced++;
        newCount++;
        
        const callTime = new Date(callData.start_time);
        if (!this.lastCdrTimestamp || callTime > new Date(this.lastCdrTimestamp)) {
          this.lastCdrTimestamp = callData.start_time;
        }
        
        this.log('success', `CDR synced`, { caller: callData.caller_number, callee: callData.callee_number, status: callData.status });
      } else {
        this.messageQueue.push({ table: 'call_records', data: callData, timestamp: Date.now() });
        this.saveQueue();
        this.log('warn', `CDR queued for later sync`);
      }
    }

    return newCount;
  }

  mapCallDirection(record) {
    if (record.direction) return record.direction;
    if (record.dcontext === 'from-internal' || record.src?.startsWith('ext')) return 'outbound';
    if (record.dcontext === 'from-trunk' || record.channel?.includes('GSM')) return 'inbound';
    return 'internal';
  }

  mapCallStatus(disposition) {
    const mapping = {
      'ANSWERED': 'answered',
      'NO ANSWER': 'missed',
      'BUSY': 'busy',
      'FAILED': 'failed',
      'VOICEMAIL': 'voicemail',
      'CONGESTION': 'failed',
    };
    return mapping[String(disposition).toUpperCase()] || 'missed';
  }

  // ========== CLICK-TO-CALL (Call Queue Processing) ==========

  async fetchPendingCalls() {
    const url = `${this.config.SUPABASE_URL}/rest/v1/call_queue?status=eq.pending&order=priority.desc,requested_at.asc&limit=5`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      this.log('warn', `Failed to fetch call queue: ${error.message}`);
      return [];
    }
  }

  async updateCallStatus(callId, status, result = null, errorMessage = null) {
    const url = `${this.config.SUPABASE_URL}/rest/v1/call_queue?id=eq.${callId}`;
    const data = {
      status,
      updated_at: new Date().toISOString(),
    };
    
    if (status === 'in_progress') {
      data.picked_up_at = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed') {
      data.completed_at = new Date().toISOString();
    }
    if (result) {
      data.result = result;
    }
    if (errorMessage) {
      data.error_message = errorMessage;
    }

    try {
      await fetch(url, {
        method: 'PATCH',
        headers: {
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
    } catch (error) {
      this.log('error', `Failed to update call status: ${error.message}`);
    }
  }

  async initiateCallViaPbx(fromExtension, toNumber) {
    const endpoints = [
      '/api/v1.0/call/dial',
      '/api/v2.0.0/call/dial',
      '/cgi-bin/api-dial',
      '/api/call/originate',
    ];

    const protocol = this.config.PBX_WEB_PORT === 443 ? 'https' : 'http';
    
    for (const endpoint of endpoints) {
      const url = `${protocol}://${this.config.PBX_IP}:${this.config.PBX_WEB_PORT}${endpoint}`;
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${this.pbxAuthHeader}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            caller: fromExtension,
            callee: toNumber,
            extension: fromExtension,
            extnum: fromExtension,
            number: toNumber,
            dst: toNumber,
          }),
        });

        if (response.ok) {
          const result = await response.json().catch(() => ({ success: true }));
          this.log('success', `Call initiated`, { from: fromExtension, to: toNumber });
          this.clearError();
          return { success: true, result };
        }
      } catch (error) {
        // Try next endpoint
      }
    }

    throw new Error('Failed to initiate call via PBX - no working API endpoint found');
  }

  async processCallQueue() {
    const pendingCalls = await this.fetchPendingCalls();
    
    if (pendingCalls.length === 0) {
      return;
    }

    for (const call of pendingCalls) {
      try {
        await this.updateCallStatus(call.id, 'in_progress');
        this.log('info', `Processing call request`, { to: call.to_number, from: call.from_extension });

        const result = await this.initiateCallViaPbx(call.from_extension, call.to_number);
        
        await this.updateCallStatus(call.id, 'completed', JSON.stringify(result.result));
        
        await this.pushToSupabase('activity_logs', {
          event_type: 'call_initiated',
          message: `Call initiated from ${call.from_extension} to ${call.to_number}`,
          severity: 'success',
          metadata: { 
            source: 'local-agent', 
            agent_id: this.config.AGENT_ID,
            call_id: call.id,
          },
        });

      } catch (error) {
        this.log('error', `Failed to initiate call`, { to: call.to_number, error: error.message });
        await this.updateCallStatus(call.id, 'failed', null, error.message);
        
        await this.pushToSupabase('activity_logs', {
          event_type: 'call_failed',
          message: `Failed to initiate call to ${call.to_number}: ${error.message}`,
          severity: 'error',
          metadata: { 
            source: 'local-agent', 
            agent_id: this.config.AGENT_ID,
            call_id: call.id,
          },
        });
      }
    }
  }

  // ========== MAIN LOOP ==========

  async pollAllPorts() {
    let totalNew = 0;

    for (const port of this.config.TG400_PORTS) {
      try {
        const messages = await this.pollSmsFromPort(port);
        const newCount = await this.processSmsMessages(messages, port);
        totalNew += newCount;
        await this.updatePortStatus(port);
      } catch (error) {
        await this.reportError('sms_poll', error.message, { port });
      }
    }

    // Try to sync queued messages
    await this.processQueue();

    // Save state after each poll
    this.saveState();

    if (totalNew > 0) {
      await this.pushToSupabase('activity_logs', {
        event_type: 'sms_sync',
        message: `Synced ${totalNew} new SMS messages`,
        severity: 'success',
        metadata: { source: 'local-agent', agent_id: this.config.AGENT_ID, count: totalNew },
      });
    }
  }

  async pollCalls() {
    try {
      const newCalls = await this.pollCdr();
      this.saveState();

      if (newCalls > 0) {
        await this.pushToSupabase('activity_logs', {
          event_type: 'cdr_sync',
          message: `Synced ${newCalls} new call records`,
          severity: 'success',
          metadata: { source: 'local-agent', agent_id: this.config.AGENT_ID, count: newCalls },
        });
      }
    } catch (error) {
      await this.reportError('cdr_poll', error.message, {});
    }
  }

  async testConnection() {
    this.log('info', 'Testing connections...');
    
    // Test TG400 gateway
    const gatewayEndpoints = [
      '/api/v1.0/system/status',
      '/cgi-bin/api-get_status',
      '/api/status',
    ];

    let gatewayOk = false;
    for (const endpoint of gatewayEndpoints) {
      const result = await this.fetchFromGateway(endpoint, 1);
      if (result) {
        this.log('success', `Gateway reachable at ${this.config.TG400_IP}`);
        gatewayOk = true;
        break;
      }
    }
    if (!gatewayOk) {
      this.log('error', `Cannot reach gateway at ${this.config.TG400_IP}`);
    }

    // Test S100 PBX
    let pbxOk = false;
    const pbxEndpoints = [
      '/api/v1.0/system/status',
      '/api/status',
    ];
    for (const endpoint of pbxEndpoints) {
      const result = await this.fetchFromPbx(endpoint, 1);
      if (result) {
        this.log('success', `PBX reachable at ${this.config.PBX_IP}`);
        pbxOk = true;
        break;
      }
    }
    if (!pbxOk) {
      this.log('warn', `Cannot reach PBX at ${this.config.PBX_IP} (CDR sync disabled)`);
    }

    // Test Supabase
    const cloudOk = await this.pushToSupabase('activity_logs', {
      event_type: 'connection_test',
      message: 'Local agent connection test',
      severity: 'info',
      metadata: { source: 'local-agent', agent_id: this.config.AGENT_ID, pbx_reachable: pbxOk },
    });
    
    if (cloudOk) {
      this.log('success', 'Cloud backend reachable');
    } else {
      this.log('error', 'Cannot reach cloud backend');
    }

    return { gateway: gatewayOk, pbx: pbxOk, cloud: cloudOk };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  startPollingLoops() {
    // SMS Polling loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) {
        await this.pollAllPorts();
      }
    }, this.getConfig('POLL_INTERVAL')));

    // CDR Polling loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) {
        await this.pollCalls();
      }
    }, this.getConfig('CDR_POLL_INTERVAL')));

    // Call Queue Polling loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) {
        await this.processCallQueue();
      }
    }, this.getConfig('CALL_QUEUE_POLL_INTERVAL')));

    // Heartbeat loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) {
        await this.upsertHeartbeat();
      }
    }, this.getConfig('HEARTBEAT_INTERVAL')));

    // Config sync loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) {
        await this.syncConfigFromCloud();
      }
    }, this.config.CONFIG_SYNC_INTERVAL));

    // Auto-update check loop
    if (this.config.AUTO_UPDATE_ENABLED) {
      this.intervals.push(setInterval(async () => {
        if (this.isRunning) {
          await this.checkForUpdates();
        }
      }, this.config.UPDATE_CHECK_INTERVAL));
    }

    // Predictive maintenance loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) {
        await this.runPredictiveMaintenance();
      }
    }, this.config.PREDICTIVE_CHECK_INTERVAL));
  }

  // ========== GIT-BASED AUTO-UPDATE SYSTEM ==========

  fileHash(filePath) {
    try {
      const content = fs.readFileSync(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch (e) {
      return null;
    }
  }

  runGitCommand(command, cwd) {
    try {
      return execSync(command, { cwd, timeout: 30000, encoding: 'utf8' }).trim();
    } catch (e) {
      throw new Error(`Git command failed: ${command} — ${e.message}`);
    }
  }

  async ensureRepoCloned() {
    const repoDir = this.config.REPO_DIR;

    // If repo dir exists and has .git, it's already cloned
    if (fs.existsSync(path.join(repoDir, '.git'))) {
      return true;
    }

    // Need to clone — requires GITHUB_REPO_URL
    const repoUrl = this.config.GITHUB_REPO_URL;
    if (!repoUrl) {
      this.log('warn', 'Git auto-update: No GITHUB_REPO_URL configured. Skipping.');
      return false;
    }

    try {
      this.log('info', `Cloning repo to ${repoDir}...`);
      fs.mkdirSync(repoDir, { recursive: true });
      this.runGitCommand(`git clone --depth 1 ${repoUrl} ${repoDir}`, '/');
      this.log('success', `Repo cloned to ${repoDir}`);
      return true;
    } catch (error) {
      this.log('error', `Failed to clone repo: ${error.message}`);
      return false;
    }
  }

  async checkForUpdates() {
    if (!this.config.AUTO_UPDATE_ENABLED) return;

    try {
      // Ensure we have the repo
      const repoReady = await this.ensureRepoCloned();
      if (!repoReady) return;

      const repoDir = this.config.REPO_DIR;
      const repoAgentPath = path.join(repoDir, this.config.AGENT_SOURCE_PATH);
      const installedAgentPath = this.config.AGENT_INSTALL_PATH;

      // Get hash of current installed script
      const currentHash = this.fileHash(installedAgentPath);
      if (!currentHash) {
        this.log('warn', 'Cannot hash current agent script');
        return;
      }

      // Pull latest changes from git
      this.log('info', 'Checking for updates via git pull...');
      const pullOutput = this.runGitCommand('git pull --ff-only 2>&1', repoDir);
      
      if (pullOutput.includes('Already up to date')) {
        this.log('info', 'Agent is up to date');
        return;
      }

      this.log('info', `Git pull result: ${pullOutput.substring(0, 200)}`);

      // Always rebuild web app when repo has changes
      await this.rebuildWebApp(repoDir);

      // Check if agent script changed
      if (!fs.existsSync(repoAgentPath)) {
        this.log('warn', `Agent source not found in repo at ${this.config.AGENT_SOURCE_PATH}`);
        return;
      }

      const newHash = this.fileHash(repoAgentPath);
      if (!newHash || currentHash === newHash) {
        this.log('info', 'Agent script unchanged after pull');
        return;
      }

      // New version detected — perform update
      this.log('info', `Agent script changed! Current: ${currentHash.substring(0, 8)}... New: ${newHash.substring(0, 8)}...`);
      await this.performGitUpdate(repoAgentPath, installedAgentPath, newHash);

    } catch (error) {
      this.log('warn', `Git update check failed: ${error.message}`);
      await this.reportError('git_update', error.message, {});
    }
  }

  async performGitUpdate(sourcePath, targetPath, newHash) {
    try {
      // Extract version from new file
      const newContent = fs.readFileSync(sourcePath, 'utf8');
      const versionMatch = newContent.match(/VERSION:\s*'([^']+)'/);
      const newVersion = versionMatch ? versionMatch[1] : 'unknown';

      this.log('info', `Updating agent: v${this.config.VERSION} → v${newVersion}`);

      // Create backup
      const backupPath = `${targetPath}.backup`;
      fs.copyFileSync(targetPath, backupPath);
      this.log('info', 'Created backup of current agent');

      // Copy new version
      const tempPath = `${targetPath}.new`;
      fs.copyFileSync(sourcePath, tempPath);
      fs.renameSync(tempPath, targetPath);
      this.log('success', `Agent updated to v${newVersion}`);

      // Log the update to cloud
      await this.pushToSupabase('activity_logs', {
        event_type: 'agent_updated',
        message: `Agent auto-updated via git: v${this.config.VERSION} → v${newVersion}`,
        severity: 'success',
        metadata: {
          old_version: this.config.VERSION,
          new_version: newVersion,
          hash: newHash.substring(0, 16),
          agent_id: this.config.AGENT_ID,
          method: 'git',
        },
      });

      // Save state before restart
      this.saveState();
      this.saveQueue();

      // Restart via systemd (preferred — ensures clean lifecycle)
      this.log('info', 'Restarting agent via systemd...');
      try {
        execSync('systemctl restart tg400-agent', { timeout: 10000 });
      } catch (e) {
        // If systemctl fails (not running under systemd), do a manual restart
        this.log('warn', 'systemctl restart failed, performing manual restart...');
        await this.shutdown();
        const newProcess = spawn(process.argv[0], [targetPath], {
          detached: true,
          stdio: 'ignore',
        });
        newProcess.unref();
        process.exit(0);
      }

    } catch (error) {
      this.log('error', `Git update failed: ${error.message}`);

      // Attempt rollback
      const backupPath = `${targetPath}.backup`;
      if (fs.existsSync(backupPath)) {
        try {
          fs.copyFileSync(backupPath, targetPath);
          this.log('info', 'Rolled back to previous version');
        } catch (rollbackErr) {
          this.log('error', `Rollback also failed: ${rollbackErr.message}`);
        }
      }

      await this.pushToSupabase('activity_logs', {
        event_type: 'update_failed',
        message: `Agent git update failed: ${error.message}`,
        severity: 'error',
        metadata: { error: error.message, agent_id: this.config.AGENT_ID },
      });
    }
  }

  // ========== WEB APP REBUILD ==========

  async rebuildWebApp(repoDir) {
    if (!this.config.WEB_BUILD_ENABLED) return;

    try {
      this.log('info', 'Rebuilding web application...');

      // Install deps if needed (check if node_modules exists)
      const nodeModulesPath = path.join(repoDir, 'node_modules');
      if (!fs.existsSync(nodeModulesPath)) {
        this.log('info', 'Installing dependencies (first run)...');
        this.runGitCommand('npm install --production=false 2>&1', repoDir);
      }

      // Check if package-lock.json changed (need to reinstall)
      const lockFile = path.join(repoDir, 'package-lock.json');
      const lockHashFile = path.join(repoDir, '.lock-hash');
      if (fs.existsSync(lockFile)) {
        const currentLockHash = this.fileHash(lockFile);
        const savedLockHash = fs.existsSync(lockHashFile) ? fs.readFileSync(lockHashFile, 'utf8').trim() : '';
        if (currentLockHash !== savedLockHash) {
          this.log('info', 'Dependencies changed, running npm install...');
          this.runGitCommand('npm install --production=false 2>&1', repoDir);
          fs.writeFileSync(lockHashFile, currentLockHash);
        }
      }

      // Run the build
      const buildOutput = this.runGitCommand('npm run build 2>&1', repoDir);
      this.log('info', `Build output: ${buildOutput.substring(0, 300)}`);

      // Copy build output to nginx serve directory
      const distDir = path.join(repoDir, 'dist');
      const serveDir = this.config.WEB_SERVE_DIR;

      if (!fs.existsSync(distDir)) {
        this.log('warn', 'Build produced no dist/ directory');
        return;
      }

      // Ensure serve directory exists
      if (!fs.existsSync(serveDir)) {
        fs.mkdirSync(serveDir, { recursive: true });
      }

      // Sync dist → serve dir (clear old files first)
      this.runGitCommand(`rm -rf ${serveDir}/*`, '/tmp');
      this.runGitCommand(`cp -r ${distDir}/* ${serveDir}/`, '/tmp');

      this.log('success', `Web app rebuilt and deployed to ${serveDir}`);

      await this.pushToSupabase('activity_logs', {
        event_type: 'web_app_updated',
        message: 'Web dashboard rebuilt and deployed after git pull',
        severity: 'success',
        metadata: { agent_id: this.config.AGENT_ID, serve_dir: serveDir },
      });

    } catch (error) {
      this.log('error', `Web app rebuild failed: ${error.message}`);
      await this.reportError('web_build', error.message, { repo_dir: repoDir });
    }
  }

  // ========== PREDICTIVE MAINTENANCE ==========

  async runPredictiveMaintenance() {
    try {
      const response = await fetch(`${this.config.SUPABASE_URL}/functions/v1/ai-diagnostics`, {
        method: 'POST',
        headers: {
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'predict_issues' }),
      });

      if (!response.ok) return;

      const result = await response.json();
      
      if (result.prediction) {
        const { risk_level, prediction, recommended_action, auto_applied } = result.prediction;
        
        if (risk_level === 'high' || risk_level === 'critical') {
          this.log('warn', `[PREDICTIVE] ${risk_level.toUpperCase()}: ${prediction}`);
          this.log('info', `[PREDICTIVE] Recommended: ${recommended_action}`);
          
          if (auto_applied) {
            this.log('success', '[PREDICTIVE] Auto-fix applied');
            // Refresh config to pick up changes
            await this.syncConfigFromCloud();
          }
        } else if (risk_level === 'medium') {
          this.log('info', `[PREDICTIVE] ${prediction}`);
          if (auto_applied) {
            await this.syncConfigFromCloud();
          }
        }
        // Low risk - silent
      }
    } catch (error) {
      // Silent fail for predictive maintenance
    }
  }

  async start() {
    console.log('\n\x1b[36m╔════════════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m║   TG400 Local Agent v' + this.config.VERSION.padEnd(10) + '(Git Auto-Update)    ║\x1b[0m');
    console.log('\x1b[36m╚════════════════════════════════════════════════════════╝\x1b[0m\n');
    
    this.log('info', `Agent ID: ${this.config.AGENT_ID}`);
    this.log('info', `TG400 Gateway: ${this.config.TG400_IP}`);
    this.log('info', `S100 PBX: ${this.config.PBX_IP}:${this.config.PBX_WEB_PORT}`);
    this.log('info', `Ports: ${this.config.TG400_PORTS.join(', ')}`);
    this.log('info', `Repo: ${this.config.REPO_DIR} (auto-update: ${this.config.AUTO_UPDATE_ENABLED ? 'every 5m' : 'disabled'})`);
    this.log('info', `Features: Self-healing, AI diagnostics, Git auto-update, Predictive maintenance`);

    // Sync config from cloud first
    await this.syncConfigFromCloud();

    // Test connections
    const connections = await this.testConnection();
    
    this.isRunning = true;

    // Initial polls
    await this.pollAllPorts();
    if (connections.pbx) {
      await this.pollCalls();
      await this.processCallQueue();
    }
    await this.upsertHeartbeat();

    // Start polling loops
    this.startPollingLoops();

    this.log('info', 'Agent running. Press Ctrl+C to stop.');
  }

  async shutdown() {
    this.log('info', 'Shutting down...');
    this.isRunning = false;

    // Clear all intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }

    this.saveState();
    this.saveQueue();
    
    // Update heartbeat to offline
    await fetch(`${this.config.SUPABASE_URL}/rest/v1/agent_heartbeat?agent_id=eq.${this.config.AGENT_ID}`, {
      method: 'PATCH',
      headers: {
        'apikey': this.config.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'offline', last_seen_at: new Date().toISOString() }),
    }).catch(() => {});
    
    this.log('info', 'Goodbye!');
  }
}

// ========== CLI ==========

const args = process.argv.slice(2);

if (args.includes('--test')) {
  const agent = new TG400Agent(CONFIG);
  agent.testConnection().then(ok => {
    process.exit(ok.gateway || ok.cloud ? 0 : 1);
  });
} else if (args.includes('--help')) {
  console.log(`
TG400 Local Polling Agent v4.1 (Git Auto-Update)

Usage: node tg400-agent.js [options]

Options:
  --test     Test gateway and cloud connectivity, then exit
  --help     Show this help message

Environment Variables:
  TG400_IP              Gateway IP address (default: 192.168.5.3)
  TG400_USERNAME        Gateway API username (default: admin)
  TG400_PASSWORD        Gateway API password (required)
  TG400_PORTS           Comma-separated port numbers (default: 1,2,3,4)
  PBX_IP                S100 PBX IP address (default: 192.168.5.1)
  PBX_USERNAME          PBX API username (default: admin)
  PBX_PASSWORD          PBX API password
  SUPABASE_URL          Supabase project URL
  SUPABASE_ANON_KEY     Supabase anonymous key
  POLL_INTERVAL         SMS polling interval in ms (default: 30000)
  CDR_POLL_INTERVAL     CDR polling interval in ms (default: 60000)
  AGENT_ID              Unique agent identifier (auto-generated if not set)
  AUTO_UPDATE_ENABLED   Enable auto-updates (default: true)
  REPO_DIR              Git repo directory (default: /opt/tg400-repo)
  GITHUB_REPO_URL       GitHub repo URL for cloning

Features:
  - AI-powered error diagnostics
  - Self-healing auto-recovery
  - Dynamic configuration from cloud
  - Exponential backoff retry
  - Offline message queue
  - Failed sync auto-reprocessing
  - GIT AUTO-UPDATE: Pulls from GitHub every 5 minutes, auto-restarts on changes
  - PREDICTIVE MAINTENANCE: AI predicts issues before they happen
`);
  process.exit(0);
} else {
  const agent = new TG400Agent(CONFIG);
  agent.start();

  process.on('SIGINT', async () => {
    await agent.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await agent.shutdown();
    process.exit(0);
  });

  // Handle uncaught exceptions for self-healing
  process.on('uncaughtException', async (error) => {
    console.error('[FATAL] Uncaught exception:', error);
    await agent.reportError('uncaught_exception', error.message, { stack: error.stack });
    await agent.shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('[FATAL] Unhandled rejection:', reason);
    await agent.reportError('unhandled_rejection', String(reason), {});
  });
}
