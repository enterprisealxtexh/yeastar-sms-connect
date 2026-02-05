#!/usr/bin/env node
/**
 * TG400 Local Polling Agent v2.0 - Production Hardened
 * 
 * Features:
 * - Persistent state file (survives restarts)
 * - Offline message queue (stores messages when cloud unreachable)
 * - Dedicated heartbeat for reliable status monitoring
 * - Automatic retry with exponential backoff
 * - Graceful shutdown with state preservation
 * 
 * Installation: See /local-agent/install.sh
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdWdzeXppa3R1a21nbHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDg5NTYsImV4cCI6MjA4NDkyNDk1Nn0.dcsZwEJXND9xdNA1dR-uHH7r6WylGwL7xVKJSFL_C44',
  
  // Agent Settings
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '30000', 10),
  HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL || '60000', 10),
  CDR_POLL_INTERVAL: parseInt(process.env.CDR_POLL_INTERVAL || '60000', 10),
  CALL_QUEUE_POLL_INTERVAL: parseInt(process.env.CALL_QUEUE_POLL_INTERVAL || '5000', 10),
  STATE_FILE: process.env.STATE_FILE || path.join(__dirname, '.agent-state.json'),
  QUEUE_FILE: process.env.QUEUE_FILE || path.join(__dirname, '.message-queue.json'),
  
  // Agent Identity
  AGENT_ID: process.env.AGENT_ID || `agent-${crypto.randomBytes(4).toString('hex')}`,
  VERSION: '2.2.0',
};
// ========================================

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class TG400Agent {
  constructor(config) {
    this.config = config;
    this.authHeader = Buffer.from(`${config.TG400_USERNAME}:${config.TG400_PASSWORD}`).toString('base64');
    this.pbxAuthHeader = Buffer.from(`${config.PBX_USERNAME}:${config.PBX_PASSWORD}`).toString('base64');
    this.processedIds = new Set();
    this.processedCallIds = new Set();
    this.messageQueue = [];
    this.isRunning = false;
    this.messagesSynced = 0;
    this.callsSynced = 0;
    this.errorsCount = 0;
    this.startTime = new Date();
    this.lastCdrTimestamp = null;
    
    // Load persistent state
    this.loadState();
    this.loadQueue();
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

  // ========== LOGGING ==========

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

  // ========== GATEWAY COMMUNICATION ==========

  async fetchFromGateway(endpoint, retries = 3) {
    const url = `http://${this.config.TG400_IP}${endpoint}`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
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

        return await response.json();
      } catch (error) {
        if (attempt === retries) {
          this.log('error', `Gateway request failed after ${retries} attempts: ${endpoint}`, { error: error.message });
          this.errorsCount++;
          return null;
        }
        await this.sleep(1000 * attempt); // Exponential backoff
      }
    }
    return null;
  }

  // ========== SUPABASE COMMUNICATION ==========

  async pushToSupabase(table, data, retries = 3) {
    const url = `${this.config.SUPABASE_URL}/rest/v1/${table}`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
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
            return true;
          }
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        return true;
      } catch (error) {
        if (attempt === retries) {
          this.log('error', `Supabase push failed: ${table}`, { error: error.message });
          return false;
        }
        await this.sleep(1000 * attempt);
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

  async fetchFromPbx(endpoint, retries = 3) {
    const protocol = this.config.PBX_WEB_PORT === 443 ? 'https' : 'http';
    const url = `${protocol}://${this.config.PBX_IP}:${this.config.PBX_WEB_PORT}${endpoint}`;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
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

        return await response.json();
      } catch (error) {
        if (attempt === retries) {
          this.log('error', `PBX request failed after ${retries} attempts: ${endpoint}`, { error: error.message });
          this.errorsCount++;
          return null;
        }
        await this.sleep(1000 * attempt);
      }
    }
    return null;
  }

  async pollCdr() {
    // Try different CDR API endpoints (Yeastar S100 API variations)
    const endpoints = [
      '/api/v1.0/cdr/get',
      '/api/cdr',
      '/cgi-bin/api-get_cdr',
      '/api/v2.0.0/cdr/search',
    ];

    let cdrRecords = null;
    for (const endpoint of endpoints) {
      // Add time filter to get recent calls
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

      // Map CDR fields to call_records schema
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
        
        // Update timestamp for next poll
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
    // Determine direction based on channel/trunk info
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
    // Try different PBX originate API endpoints (Yeastar S100 API variations)
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
        // Mark as in progress
        await this.updateCallStatus(call.id, 'in_progress');
        this.log('info', `Processing call request`, { to: call.to_number, from: call.from_extension });

        // Initiate the call
        const result = await this.initiateCallViaPbx(call.from_extension, call.to_number);
        
        // Mark as completed
        await this.updateCallStatus(call.id, 'completed', JSON.stringify(result.result));
        
        // Log activity
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
        this.errorsCount++;
        
        // Log activity
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
      'ANSWERED': 'answered',
      'NO ANSWER': 'missed',
      'BUSY': 'busy',
      'FAILED': 'failed',
      'VOICEMAIL': 'voicemail',
      'CONGESTION': 'failed',
    };
    return mapping[String(disposition).toUpperCase()] || 'missed';
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
        this.log('error', `Error polling port ${port}`, { error: error.message });
        this.errorsCount++;
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
      this.log('error', 'Error polling CDR', { error: error.message });
      this.errorsCount++;
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

  async start() {
    console.log('\n\x1b[36m╔════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m║   TG400 Local Polling Agent v' + this.config.VERSION.padEnd(12) + '║\x1b[0m');
    console.log('\x1b[36m╚════════════════════════════════════════════╝\x1b[0m\n');
    
    this.log('info', `Agent ID: ${this.config.AGENT_ID}`);
    this.log('info', `TG400 Gateway: ${this.config.TG400_IP}`);
    this.log('info', `S100 PBX: ${this.config.PBX_IP}:${this.config.PBX_WEB_PORT}`);
    this.log('info', `Ports: ${this.config.TG400_PORTS.join(', ')}`);
    this.log('info', `SMS Poll interval: ${this.config.POLL_INTERVAL}ms`);
    this.log('info', `CDR Poll interval: ${this.config.CDR_POLL_INTERVAL}ms`);
    this.log('info', `Call Queue Poll interval: ${this.config.CALL_QUEUE_POLL_INTERVAL}ms`);

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

    // SMS Polling loop
    setInterval(async () => {
      if (this.isRunning) {
        await this.pollAllPorts();
      }
    }, this.config.POLL_INTERVAL);

    // CDR Polling loop (separate interval for calls)
    if (connections.pbx) {
      setInterval(async () => {
        if (this.isRunning) {
          await this.pollCalls();
        }
      }, this.config.CDR_POLL_INTERVAL);

      // Call Queue Polling loop (for click-to-call)
      setInterval(async () => {
        if (this.isRunning) {
          await this.processCallQueue();
        }
      }, this.config.CALL_QUEUE_POLL_INTERVAL);
    }

    // Heartbeat loop
    setInterval(async () => {
      if (this.isRunning) {
        await this.upsertHeartbeat();
      }
    }, this.config.HEARTBEAT_INTERVAL);

    this.log('info', 'Agent running. Press Ctrl+C to stop.');
  }

  async shutdown() {
    this.log('info', 'Shutting down...');
    this.isRunning = false;
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
    process.exit(ok ? 0 : 1);
  });
} else if (args.includes('--help')) {
  console.log(`
TG400 Local Polling Agent

Usage: node tg400-agent.js [options]

Options:
  --test     Test gateway and cloud connectivity, then exit
  --help     Show this help message

Environment Variables:
  TG400_IP           Gateway IP address (default: 192.168.5.3)
  TG400_USERNAME     Gateway API username (default: admin)
  TG400_PASSWORD     Gateway API password (required)
  TG400_PORTS        Comma-separated port numbers (default: 1,2,3,4)
  SUPABASE_URL       Supabase project URL
  SUPABASE_ANON_KEY  Supabase anonymous key
  POLL_INTERVAL      Polling interval in ms (default: 30000)
  AGENT_ID           Unique agent identifier (auto-generated if not set)
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
}
