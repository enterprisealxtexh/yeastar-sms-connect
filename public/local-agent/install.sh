#!/bin/bash
# ============================================================
# TG400 SMS Gateway Agent - Ubuntu Auto-Installer
# Supports: Ubuntu 20.04, 22.04, 24.04, 25.04
# Agent v4.0 - AI-Powered, Self-Healing, Auto-Update
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default installation directory
INSTALL_DIR="/opt/tg400-agent"
SERVICE_NAME="tg400-agent"
NODE_MIN_VERSION=20

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run this script as root (use sudo)"
        exit 1
    fi
}

# Detect Ubuntu version
detect_ubuntu() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [ "$ID" = "ubuntu" ]; then
            log_info "Detected Ubuntu $VERSION_ID ($VERSION_CODENAME)"
            UBUNTU_VERSION="$VERSION_ID"
            UBUNTU_CODENAME="$VERSION_CODENAME"
        else
            log_warn "This script is optimized for Ubuntu but detected $ID"
            log_warn "Continuing anyway..."
        fi
    else
        log_warn "Cannot detect OS version, assuming Ubuntu"
    fi
}

# Update system packages
update_system() {
    log_info "Updating system packages..."
    apt-get update -qq
    apt-get upgrade -y -qq
    log_success "System packages updated"
}

# Install required dependencies
install_dependencies() {
    log_info "Installing required dependencies..."
    
    # Essential packages
    apt-get install -y -qq \
        curl \
        wget \
        ca-certificates \
        gnupg \
        lsb-release \
        git \
        build-essential \
        net-tools \
        iputils-ping \
        dnsutils \
        jq \
        2>/dev/null || true
    
    log_success "Dependencies installed"
}

# Install Node.js
install_nodejs() {
    log_info "Checking Node.js installation..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge "$NODE_MIN_VERSION" ]; then
            log_success "Node.js v$(node -v | cut -d'v' -f2) is already installed"
            return 0
        else
            log_warn "Node.js version too old (v$NODE_VERSION), upgrading to v20+..."
        fi
    fi
    
    log_info "Installing Node.js v20 LTS..."
    
    # Remove old nodejs if exists
    apt-get remove -y nodejs npm 2>/dev/null || true
    
    # Install NodeSource repository
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
    
    apt-get update -qq
    apt-get install -y nodejs
    
    log_success "Node.js $(node -v) installed"
}

# Create agent directory and files
setup_agent() {
    log_info "Setting up TG400 agent in $INSTALL_DIR..."
    
    # Create directory
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    
    # Initialize npm project
    cat > package.json << 'EOF'
{
  "name": "tg400-agent",
  "version": "4.0.0",
  "description": "TG400 SMS Gateway Local Polling Agent v4.0 - AI-Powered",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js",
    "test": "node agent.js --test"
  },
  "author": "NOSTEQ",
  "license": "MIT",
  "dependencies": {
    "node-fetch": "^2.7.0"
  }
}
EOF

    # Install npm dependencies
    npm install --production 2>/dev/null
    
    log_success "Agent directory configured"
}

# Create the main agent script (v4.0 - EMBEDDED)
create_agent_script() {
    log_info "Creating agent script v4.0..."
    
    cat > "$INSTALL_DIR/agent.js" << 'AGENT_EOF'
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
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

// ============ CONFIGURATION ============
// Load from config.json if available, else use env vars
const CONFIG_FILE = path.join(__dirname, 'config.json');
let fileConfig = {};
try {
    fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch (e) {
    // No config file, use env vars
}

const CONFIG = {
  // TG400 Gateway Settings
  TG400_IP: fileConfig.TG400_IP || process.env.TG400_IP || '192.168.5.3',
  TG400_USERNAME: fileConfig.TG400_USERNAME || process.env.TG400_USERNAME || 'admin',
  TG400_PASSWORD: fileConfig.TG400_PASSWORD || process.env.TG400_PASSWORD || '',
  TG400_PORTS: fileConfig.TG400_PORTS || (process.env.TG400_PORTS || '1,2,3,4').split(',').map(Number),
  
  // S100 PBX Settings (for CDR)
  PBX_IP: fileConfig.PBX_IP || process.env.PBX_IP || '192.168.5.1',
  PBX_USERNAME: fileConfig.PBX_USERNAME || process.env.PBX_USERNAME || 'admin',
  PBX_PASSWORD: fileConfig.PBX_PASSWORD || process.env.PBX_PASSWORD || '',
  PBX_WEB_PORT: parseInt(fileConfig.PBX_WEB_PORT || process.env.PBX_WEB_PORT || '443', 10),
  
  // Supabase Settings
  SUPABASE_URL: fileConfig.SUPABASE_URL || process.env.SUPABASE_URL || 'https://aougsyziktukjvkmglzb.supabase.co',
  SUPABASE_ANON_KEY: fileConfig.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdWdzeXppa3R1a2p2a21nbHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDg5NTYsImV4cCI6MjA4NDkyNDk1Nn0.dcsZwEJXND9xdNA1dR-uHH7r6WylGwL7xVKJSFL_C44',
  
  // Agent Settings
  POLL_INTERVAL: parseInt(fileConfig.POLL_INTERVAL || process.env.POLL_INTERVAL || '30000', 10),
  HEARTBEAT_INTERVAL: parseInt(fileConfig.HEARTBEAT_INTERVAL || process.env.HEARTBEAT_INTERVAL || '60000', 10),
  CDR_POLL_INTERVAL: parseInt(fileConfig.CDR_POLL_INTERVAL || process.env.CDR_POLL_INTERVAL || '60000', 10),
  CALL_QUEUE_POLL_INTERVAL: parseInt(fileConfig.CALL_QUEUE_POLL_INTERVAL || process.env.CALL_QUEUE_POLL_INTERVAL || '5000', 10),
  CONFIG_SYNC_INTERVAL: parseInt(fileConfig.CONFIG_SYNC_INTERVAL || process.env.CONFIG_SYNC_INTERVAL || '300000', 10),
  UPDATE_CHECK_INTERVAL: parseInt(fileConfig.UPDATE_CHECK_INTERVAL || process.env.UPDATE_CHECK_INTERVAL || '3600000', 10),
  PREDICTIVE_CHECK_INTERVAL: parseInt(fileConfig.PREDICTIVE_CHECK_INTERVAL || process.env.PREDICTIVE_CHECK_INTERVAL || '900000', 10),
  STATE_FILE: process.env.STATE_FILE || path.join(__dirname, '.agent-state.json'),
  QUEUE_FILE: process.env.QUEUE_FILE || path.join(__dirname, '.message-queue.json'),
  
  // Self-healing settings
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '3', 10),
  RETRY_BACKOFF_MULTIPLIER: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
  AUTO_RESTART_DELAY: parseInt(process.env.AUTO_RESTART_DELAY || '10000', 10),
  ERROR_THRESHOLD_FOR_RESTART: parseInt(process.env.ERROR_THRESHOLD_FOR_RESTART || '10', 10),
  
  // Auto-update settings
  AUTO_UPDATE_ENABLED: process.env.AUTO_UPDATE_ENABLED !== 'false',
  AGENT_SCRIPT_PATH: process.env.AGENT_SCRIPT_PATH || __filename,
  
  // Agent Identity
  AGENT_ID: fileConfig.AGENT_ID || process.env.AGENT_ID || `agent-${crypto.randomBytes(4).toString('hex')}`,
  VERSION: '4.0.0',
};
// ========================================

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

class TG400Agent {
  constructor(config) {
    this.config = { ...config };
    this.dynamicConfig = {};
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
    
    this.loadState();
    this.loadQueue();
  }

  // ========== DYNAMIC CONFIGURATION ==========

  getConfig(key) {
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
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
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
      }, 1);

      if (this.consecutiveErrors >= 3) {
        await this.requestAiDiagnosis(errorType, errorMessage, context);
      }
    } catch (e) {
      // Don't fail on error logging
    }

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
    this.saveState();
    this.saveQueue();

    await this.pushToSupabase('activity_logs', {
      event_type: 'self_heal',
      message: `Agent self-healing after ${this.consecutiveErrors} consecutive errors`,
      severity: 'warning',
      metadata: { agent_id: this.config.AGENT_ID, consecutive_errors: this.consecutiveErrors },
    }, 1);

    this.consecutiveErrors = 0;
    this.restartPollingLoops();
    await this.syncConfigFromCloud();
    this.log('success', 'Self-healing complete');
  }

  clearError() {
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
          if (table !== 'error_logs') {
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
    
    if (status === 'in_progress') data.picked_up_at = new Date().toISOString();
    if (status === 'completed' || status === 'failed') data.completed_at = new Date().toISOString();
    if (result) data.result = result;
    if (errorMessage) data.error_message = errorMessage;

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
    
    if (pendingCalls.length === 0) return;

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
          metadata: { source: 'local-agent', agent_id: this.config.AGENT_ID, call_id: call.id },
        });

      } catch (error) {
        this.log('error', `Failed to initiate call`, { to: call.to_number, error: error.message });
        await this.updateCallStatus(call.id, 'failed', null, error.message);
        
        await this.pushToSupabase('activity_logs', {
          event_type: 'call_failed',
          message: `Failed to initiate call to ${call.to_number}: ${error.message}`,
          severity: 'error',
          metadata: { source: 'local-agent', agent_id: this.config.AGENT_ID, call_id: call.id },
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

    await this.processQueue();
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
      if (this.isRunning) await this.pollAllPorts();
    }, this.getConfig('POLL_INTERVAL')));

    // CDR Polling loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) await this.pollCalls();
    }, this.getConfig('CDR_POLL_INTERVAL')));

    // Call Queue Polling loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) await this.processCallQueue();
    }, this.getConfig('CALL_QUEUE_POLL_INTERVAL')));

    // Heartbeat loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) await this.upsertHeartbeat();
    }, this.getConfig('HEARTBEAT_INTERVAL')));

    // Config sync loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) await this.syncConfigFromCloud();
    }, this.config.CONFIG_SYNC_INTERVAL));

    // Auto-update check loop
    if (this.config.AUTO_UPDATE_ENABLED) {
      this.intervals.push(setInterval(async () => {
        if (this.isRunning) await this.checkForUpdates();
      }, this.config.UPDATE_CHECK_INTERVAL));
    }

    // Predictive maintenance loop
    this.intervals.push(setInterval(async () => {
      if (this.isRunning) await this.runPredictiveMaintenance();
    }, this.config.PREDICTIVE_CHECK_INTERVAL));
  }

  // ========== AUTO-UPDATE SYSTEM ==========

  async checkForUpdates() {
    try {
      const response = await fetch(`${this.config.SUPABASE_URL}/functions/v1/ai-diagnostics`, {
        method: 'POST',
        headers: {
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.config.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'check_updates',
          agent_version: this.config.VERSION,
        }),
      });

      if (!response.ok) return;

      const result = await response.json();
      
      if (result.update_available && result.latest_version) {
        this.log('info', `Update available: v${result.latest_version.version} (current: v${this.config.VERSION})`);
        
        if (result.latest_version.is_critical) {
          this.log('warn', 'CRITICAL update - auto-installing...');
          await this.performUpdate(result.latest_version);
        } else {
          this.log('info', `Release notes: ${result.latest_version.release_notes || 'No notes'}`);
          await this.pushToSupabase('activity_logs', {
            event_type: 'update_available',
            message: `Agent update available: v${result.latest_version.version}`,
            severity: 'info',
            metadata: {
              current_version: this.config.VERSION,
              new_version: result.latest_version.version,
              release_notes: result.latest_version.release_notes,
              is_critical: result.latest_version.is_critical,
              download_url: result.latest_version.download_url,
            },
          });
        }
      }
    } catch (error) {
      this.log('warn', `Update check failed: ${error.message}`);
    }
  }

  async performUpdate(updateInfo) {
    if (!updateInfo.download_url) {
      this.log('error', 'No download URL for update');
      return;
    }

    try {
      this.log('info', `Downloading update from ${updateInfo.download_url}...`);
      
      const response = await fetch(updateInfo.download_url);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const newScript = await response.text();
      const backupPath = `${this.config.AGENT_SCRIPT_PATH}.backup`;
      const tempPath = `${this.config.AGENT_SCRIPT_PATH}.new`;

      fs.copyFileSync(this.config.AGENT_SCRIPT_PATH, backupPath);
      this.log('info', 'Created backup of current agent');

      fs.writeFileSync(tempPath, newScript);
      fs.renameSync(tempPath, this.config.AGENT_SCRIPT_PATH);
      this.log('success', `Updated to v${updateInfo.version}`);

      await this.pushToSupabase('activity_logs', {
        event_type: 'agent_updated',
        message: `Agent auto-updated from v${this.config.VERSION} to v${updateInfo.version}`,
        severity: 'success',
        metadata: {
          old_version: this.config.VERSION,
          new_version: updateInfo.version,
          agent_id: this.config.AGENT_ID,
        },
      });

      this.log('info', 'Restarting agent with new version...');
      await this.shutdown();
      
      const newProcess = spawn(process.argv[0], [this.config.AGENT_SCRIPT_PATH], {
        detached: true,
        stdio: 'ignore',
      });
      newProcess.unref();
      
      process.exit(0);
    } catch (error) {
      this.log('error', `Update failed: ${error.message}`);
      await this.pushToSupabase('activity_logs', {
        event_type: 'update_failed',
        message: `Agent update failed: ${error.message}`,
        severity: 'error',
        metadata: { error: error.message, agent_id: this.config.AGENT_ID },
      });
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
            await this.syncConfigFromCloud();
          }
        } else if (risk_level === 'medium') {
          this.log('info', `[PREDICTIVE] ${prediction}`);
          if (auto_applied) await this.syncConfigFromCloud();
        }
      }
    } catch (error) {
      // Silent fail for predictive maintenance
    }
  }

  async start() {
    console.log('\n\x1b[36m╔════════════════════════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m║   TG400 Local Agent v' + this.config.VERSION.padEnd(10) + '(AI Auto-Update)     ║\x1b[0m');
    console.log('\x1b[36m╚════════════════════════════════════════════════════════╝\x1b[0m\n');
    
    this.log('info', `Agent ID: ${this.config.AGENT_ID}`);
    this.log('info', `TG400 Gateway: ${this.config.TG400_IP}`);
    this.log('info', `S100 PBX: ${this.config.PBX_IP}:${this.config.PBX_WEB_PORT}`);
    this.log('info', `Ports: ${this.config.TG400_PORTS.join(', ')}`);
    this.log('info', `Features: Self-healing, AI diagnostics, Auto-update, Predictive maintenance`);
    this.log('info', `Auto-update: ${this.config.AUTO_UPDATE_ENABLED ? 'Enabled' : 'Disabled'}`);

    await this.syncConfigFromCloud();
    const connections = await this.testConnection();
    
    this.isRunning = true;

    await this.pollAllPorts();
    if (connections.pbx) {
      await this.pollCalls();
      await this.processCallQueue();
    }
    await this.upsertHeartbeat();

    this.startPollingLoops();

    this.log('info', 'Agent running. Press Ctrl+C to stop.');
  }

  async shutdown() {
    this.log('info', 'Shutting down...');
    this.isRunning = false;

    for (const interval of this.intervals) {
      clearInterval(interval);
    }

    this.saveState();
    this.saveQueue();
    
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
TG400 Local Polling Agent v4.0 (AI Auto-Update)

Usage: node agent.js [options]

Options:
  --test     Test gateway and cloud connectivity, then exit
  --help     Show this help message

Configuration:
  Edit /opt/tg400-agent/config.json or set environment variables.

Features:
  - AI-powered error diagnostics
  - Self-healing auto-recovery  
  - Dynamic configuration from cloud
  - Exponential backoff retry
  - Offline message queue
  - AUTO-UPDATE: Checks for new versions hourly
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
AGENT_EOF

    log_success "Agent script v4.0 created (embedded)"
}

# Create configuration wizard
create_config_wizard() {
    log_info "Creating configuration wizard..."
    
    cat > "/usr/local/bin/tg400-config" << 'CONFIG_EOF'
#!/bin/bash
# TG400 Agent Configuration Wizard v4.0

CONFIG_FILE="/opt/tg400-agent/config.json"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════╗"
echo "║     TG400 SMS Gateway - Configuration Wizard      ║"
echo "║     Agent v4.0 - AI-Powered                       ║"
echo "╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Load existing config if available
if [ -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}Existing configuration found. Press Enter to keep current values.${NC}\n"
    EXISTING=$(cat "$CONFIG_FILE")
    CURRENT_IP=$(echo "$EXISTING" | jq -r '.TG400_IP // "192.168.5.3"')
    CURRENT_USER=$(echo "$EXISTING" | jq -r '.TG400_USERNAME // "admin"')
    CURRENT_PASS=$(echo "$EXISTING" | jq -r '.TG400_PASSWORD // ""')
    CURRENT_PORTS=$(echo "$EXISTING" | jq -r '.TG400_PORTS | join(", ") // "1, 2, 3, 4"')
    CURRENT_INTERVAL=$(echo "$EXISTING" | jq -r '.POLL_INTERVAL // 30000')
    CURRENT_PBX_IP=$(echo "$EXISTING" | jq -r '.PBX_IP // "192.168.5.1"')
    CURRENT_PBX_USER=$(echo "$EXISTING" | jq -r '.PBX_USERNAME // "admin"')
    CURRENT_PBX_PASS=$(echo "$EXISTING" | jq -r '.PBX_PASSWORD // ""')
    CURRENT_PBX_PORT=$(echo "$EXISTING" | jq -r '.PBX_WEB_PORT // 443')
else
    CURRENT_IP="192.168.5.3"
    CURRENT_USER="admin"
    CURRENT_PASS=""
    CURRENT_PORTS="1, 2, 3, 4"
    CURRENT_INTERVAL="30000"
    CURRENT_PBX_IP="192.168.5.1"
    CURRENT_PBX_USER="admin"
    CURRENT_PBX_PASS=""
    CURRENT_PBX_PORT="443"
fi

# TG400 Settings
echo -e "${GREEN}=== TG400 Gateway Settings ===${NC}"
read -p "Gateway IP [$CURRENT_IP]: " TG400_IP
TG400_IP=${TG400_IP:-$CURRENT_IP}

read -p "Username [$CURRENT_USER]: " TG400_USERNAME
TG400_USERNAME=${TG400_USERNAME:-$CURRENT_USER}

read -sp "Password [hidden]: " TG400_PASSWORD
echo ""
TG400_PASSWORD=${TG400_PASSWORD:-$CURRENT_PASS}

read -p "SIM Ports (comma-separated) [$CURRENT_PORTS]: " PORTS_INPUT
PORTS_INPUT=${PORTS_INPUT:-$CURRENT_PORTS}
TG400_PORTS=$(echo "$PORTS_INPUT" | sed 's/[^0-9,]//g' | sed 's/,/, /g')

read -p "Poll interval in seconds [$(($CURRENT_INTERVAL/1000))]: " POLL_SEC
POLL_SEC=${POLL_SEC:-$(($CURRENT_INTERVAL/1000))}
POLL_INTERVAL=$((POLL_SEC * 1000))

# S100 PBX Settings
echo ""
echo -e "${GREEN}=== S100 PBX Settings (for Call Records) ===${NC}"
read -p "PBX IP [$CURRENT_PBX_IP]: " PBX_IP
PBX_IP=${PBX_IP:-$CURRENT_PBX_IP}

read -p "PBX Username [$CURRENT_PBX_USER]: " PBX_USERNAME
PBX_USERNAME=${PBX_USERNAME:-$CURRENT_PBX_USER}

read -sp "PBX Password [hidden]: " PBX_PASSWORD
echo ""
PBX_PASSWORD=${PBX_PASSWORD:-$CURRENT_PBX_PASS}

read -p "PBX Web Port [$CURRENT_PBX_PORT]: " PBX_WEB_PORT
PBX_WEB_PORT=${PBX_WEB_PORT:-$CURRENT_PBX_PORT}

# Supabase settings (pre-configured)
SUPABASE_URL="https://aougsyziktukjvkmglzb.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvdWdzeXppa3R1a2p2a21nbHpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzNDg5NTYsImV4cCI6MjA4NDkyNDk1Nn0.dcsZwEJXND9xdNA1dR-uHH7r6WylGwL7xVKJSFL_C44"

# Create config file
cat > "$CONFIG_FILE" << EOF
{
  "TG400_IP": "$TG400_IP",
  "TG400_USERNAME": "$TG400_USERNAME",
  "TG400_PASSWORD": "$TG400_PASSWORD",
  "TG400_PORTS": [$TG400_PORTS],
  "PBX_IP": "$PBX_IP",
  "PBX_USERNAME": "$PBX_USERNAME",
  "PBX_PASSWORD": "$PBX_PASSWORD",
  "PBX_WEB_PORT": $PBX_WEB_PORT,
  "SUPABASE_URL": "$SUPABASE_URL",
  "SUPABASE_ANON_KEY": "$SUPABASE_ANON_KEY",
  "POLL_INTERVAL": $POLL_INTERVAL
}
EOF

chmod 600 "$CONFIG_FILE"

echo ""
echo -e "${GREEN}Configuration saved to $CONFIG_FILE${NC}"
echo ""
echo -e "${YELLOW}Testing connections...${NC}"
cd /opt/tg400-agent && node agent.js --test

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Connection test passed!${NC}"
    echo ""
    echo "Start the agent with: sudo systemctl start tg400-agent"
    echo "View logs with: tg400-logs"
else
    echo ""
    echo -e "${RED}✗ Connection test failed. Please check your settings.${NC}"
    echo "Run 'sudo tg400-config' to reconfigure."
fi
CONFIG_EOF

    chmod +x /usr/local/bin/tg400-config
    log_success "Configuration wizard created"
}

# Create systemd service
create_systemd_service() {
    log_info "Creating systemd service..."
    
    cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=TG400 SMS Gateway Polling Agent v4.0
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node $INSTALL_DIR/agent.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=tg400-agent

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$INSTALL_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    
    log_success "Systemd service created and enabled"
}

# Create helper commands
create_helper_commands() {
    log_info "Creating helper commands..."
    
    # Status command
    cat > /usr/local/bin/tg400-status << 'EOF'
#!/bin/bash
echo "=== TG400 Agent Status ==="
systemctl status tg400-agent --no-pager
echo ""
echo "=== Recent Logs ==="
journalctl -u tg400-agent -n 20 --no-pager
EOF
    chmod +x /usr/local/bin/tg400-status
    
    # Logs command
    cat > /usr/local/bin/tg400-logs << 'EOF'
#!/bin/bash
journalctl -u tg400-agent -f
EOF
    chmod +x /usr/local/bin/tg400-logs
    
    # Restart command
    cat > /usr/local/bin/tg400-restart << 'EOF'
#!/bin/bash
sudo systemctl restart tg400-agent
echo "TG400 Agent restarted"
sudo journalctl -u tg400-agent -n 10 --no-pager
EOF
    chmod +x /usr/local/bin/tg400-restart
    
    # Test command
    cat > /usr/local/bin/tg400-test << 'EOF'
#!/bin/bash
cd /opt/tg400-agent && node agent.js --test
EOF
    chmod +x /usr/local/bin/tg400-test
    
    log_success "Helper commands created"
}

# Print completion message
print_completion() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Installation Complete! (Agent v4.0)             ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo "  1. Run configuration wizard:  ${YELLOW}sudo tg400-config${NC}"
    echo "  2. Start the agent:           ${YELLOW}sudo systemctl start tg400-agent${NC}"
    echo "  3. Check status:              ${YELLOW}tg400-status${NC}"
    echo ""
    echo -e "${BLUE}Available Commands:${NC}"
    echo "  ${YELLOW}tg400-config${NC}   - Configure gateway & PBX settings"
    echo "  ${YELLOW}tg400-status${NC}   - Show agent status and recent logs"
    echo "  ${YELLOW}tg400-logs${NC}     - Follow live logs"
    echo "  ${YELLOW}tg400-restart${NC}  - Restart the agent"
    echo "  ${YELLOW}tg400-test${NC}     - Test gateway & cloud connection"
    echo ""
    echo -e "${BLUE}Installation Directory:${NC} $INSTALL_DIR"
    echo -e "${BLUE}Configuration File:${NC} $INSTALL_DIR/config.json"
    echo ""
    echo -e "${BLUE}Features:${NC}"
    echo "  ✓ AI-powered error diagnostics"
    echo "  ✓ Self-healing auto-recovery"
    echo "  ✓ Auto-update (checks hourly)"
    echo "  ✓ Predictive maintenance"
    echo "  ✓ Offline message queue"
    echo "  ✓ S100 PBX CDR sync"
    echo "  ✓ Click-to-call bridge"
    echo ""
}

# Main installation
main() {
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     TG400 SMS Gateway Agent - Ubuntu Installer            ║${NC}"
    echo -e "${BLUE}║     Agent v4.0 - AI-Powered, Self-Healing                 ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    check_root
    detect_ubuntu
    update_system
    install_dependencies
    install_nodejs
    setup_agent
    create_agent_script
    create_config_wizard
    create_systemd_service
    create_helper_commands
    print_completion
}

main "$@"
