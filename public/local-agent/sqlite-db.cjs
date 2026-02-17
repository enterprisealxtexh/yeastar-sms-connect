/**
 * SQLite Database Manager for TG400 SMS Sync
 * Stores SMS messages, logs, and gateway configuration locally
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class SMSDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, 'sms.db');
    this.db = null;
  }

  init() {
    try {
      // Create database connection
      this.db = new Database(this.dbPath);
      
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
      
      // Enable WAL mode for concurrent access (fixes database locked issues)
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000');
      
      // Create tables if they don't exist
      this.createTables();
      
      const logger = require('./logger.cjs');
      logger.info(`SQLite database initialized: ${this.dbPath}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize database:', error.message);
      return false;
    }
  }

  createTables() {
    // Gateway configuration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        gateway_ip TEXT NOT NULL DEFAULT '',
        api_username TEXT NOT NULL DEFAULT '',
        api_password TEXT NOT NULL DEFAULT '',
        api_port INTEGER DEFAULT 5038,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // SMS Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_messages (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        external_id TEXT UNIQUE,
        sender_number TEXT NOT NULL,
        message_content TEXT NOT NULL,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sim_port INTEGER NOT NULL CHECK (sim_port >= 1 AND sim_port <= 4),
        status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'processed', 'failed')),
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sms_sim_port ON sms_messages(sim_port);
      CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_messages(status);
      CREATE INDEX IF NOT EXISTS idx_sms_received_at ON sms_messages(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sms_sender ON sms_messages(sender_number);
    `);

    // SIM Port Status table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sim_port_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        port_number INTEGER UNIQUE NOT NULL CHECK (port_number >= 1 AND port_number <= 4),
        label TEXT,
        phone_number TEXT,
        enabled BOOLEAN DEFAULT 1,
        signal_strength INTEGER DEFAULT 0,
        carrier TEXT,
        status TEXT DEFAULT 'unknown',
        last_seen_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Call records table (CDR)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS call_records (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        external_id TEXT UNIQUE,
        caller_number TEXT,
        callee_number TEXT,
        caller_name TEXT,
        callee_name TEXT,
        direction TEXT,
        status TEXT,
        sim_port INTEGER,
        extension TEXT,
        start_time DATETIME,
        answer_time DATETIME,
        end_time DATETIME,
        ring_duration INTEGER,
        talk_duration INTEGER,
        hold_duration INTEGER,
        total_duration INTEGER,
        recording_url TEXT,
        transfer_to TEXT,
        notes TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure notes column exists in case of manual creation or older version
    try {
      this.db.exec('ALTER TABLE call_records ADD COLUMN notes TEXT');
    } catch (e) {
      // Column might already exist
    }

    // Activity Logs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        event_type TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'success')),
        sim_port INTEGER CHECK (sim_port >= 1 AND sim_port <= 4),
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activity_severity ON activity_logs(severity);
    `);

    // Agent Heartbeat table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_heartbeat (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_id TEXT UNIQUE NOT NULL,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'online',
        version TEXT,
        hostname TEXT,
        messages_synced INTEGER DEFAULT 0,
        errors_count INTEGER DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // S100 PBX configuration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pbx_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        pbx_ip TEXT DEFAULT '',
        pbx_port INTEGER DEFAULT 5060,
        api_username TEXT DEFAULT '',
        api_password TEXT DEFAULT '',
        web_port INTEGER DEFAULT 8333,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Users authentication table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'operator' CHECK (role IN ('admin', 'operator', 'viewer')),
        name TEXT,
        is_active BOOLEAN DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Telegram configuration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        bot_token TEXT,
        chat_id TEXT,
        enabled BOOLEAN DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // PBX Extensions table for real extension data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pbx_extensions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        extnumber TEXT UNIQUE NOT NULL,
        username TEXT,
        status TEXT,
        type TEXT,
        callerid TEXT,
        registername TEXT,
        mobile TEXT,
        email TEXT,
        language TEXT,
        hasvoicemail TEXT,
        alwaysforward TEXT,
        noanswerforward TEXT,
        busyforward TEXT,
        ringtimeout TEXT,
        outroute TEXT,
        dnd TEXT,
        nat TEXT,
        metadata TEXT,
        last_synced DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_pbx_ext_number ON pbx_extensions(extnumber);
      CREATE INDEX IF NOT EXISTS idx_pbx_ext_status ON pbx_extensions(status);
    `);

    // Insert default gateway config if empty
    const count = this.db.prepare('SELECT COUNT(*) as cnt FROM gateway_config').get().cnt;
    if (count === 0) {
      this.db.prepare(`
        INSERT INTO gateway_config (gateway_ip, api_username, api_password, api_port)
        VALUES ('192.168.5.3', 'admin', 'Kinuste19', 5038)
      `).run();
    }

    // Insert default PBX config if empty
    const pbxCount = this.db.prepare('SELECT COUNT(*) as cnt FROM pbx_config').get().cnt;
    if (pbxCount === 0) {
      this.db.prepare(`
        INSERT INTO pbx_config (pbx_ip, pbx_port, api_username, api_password, web_port)
        VALUES ('192.168.5.2', 5060, 'admin', '@Tb1nsq0202', 80)
      `).run();
    }

    // Insert default admin user if no users exist
    const userCount = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
    if (userCount === 0) {
      // Default password hash for 'admin' (using simple SHA256-like approach for demo)
      const crypto = require('crypto');
      const defaultPasswordHash = crypto.createHash('sha256').update('admin123').digest('hex');
      this.db.prepare(`
        INSERT INTO users (email, password_hash, role, name, is_active)
        VALUES ('admin@nosteq.co.ke', ?, 'admin', 'Administrator', 1)
      `).run(defaultPasswordHash);
      const logger = require('./logger.cjs');
      logger.info('Default admin user created (admin@nosteq.co.ke)');
    }

    // Insert default Telegram config if empty
    const telegramCount = this.db.prepare('SELECT COUNT(*) as cnt FROM telegram_config').get().cnt;
    if (telegramCount === 0) {
      this.db.prepare(`
        INSERT INTO telegram_config (bot_token, chat_id, enabled, is_active)
        VALUES ('', '', 0, 1)
      `).run();
    }
  }

  savePbxConfig(config) {
    try {
      const { pbx_ip, pbx_port = 5060, api_username, api_password, web_port = 8333 } = config;
      
      // First check if a record exists
      const existing = this.db.prepare('SELECT id FROM pbx_config LIMIT 1').get();
      
      if (existing) {
        // Update existing record
        const stmt = this.db.prepare(`
          UPDATE pbx_config 
          SET pbx_ip = ?, pbx_port = ?, api_username = ?, api_password = ?, web_port = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        stmt.run(pbx_ip, pbx_port, api_username, api_password, web_port, existing.id);
      } else {
        // Insert new record if none exists
        const stmt = this.db.prepare(`
          INSERT INTO pbx_config (pbx_ip, pbx_port, api_username, api_password, web_port)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(pbx_ip, pbx_port, api_username, api_password, web_port);
      }
      
      this.logActivity('pbx_config_updated', `PBX config saved: ${pbx_ip}`, 'success');
      return true;
    } catch (error) {
      console.error('Error saving PBX config:', error.message);
      this.logActivity('pbx_config_error', `Failed to save PBX config: ${error.message}`, 'error');
      return false;
    }
  }

  getTelegramConfig() {
    try {
      const stmt = this.db.prepare('SELECT * FROM telegram_config LIMIT 1');
      return stmt.get();
    } catch (error) {
      console.error('Error getting Telegram config:', error.message);
      return null;
    }
  }

  saveTelegramConfig(config) {
    try {
      const { bot_token, chat_id, enabled } = config;
      const stmt = this.db.prepare(`
        UPDATE telegram_config 
        SET bot_token = ?, chat_id = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT id FROM telegram_config LIMIT 1)
      `);
      stmt.run(bot_token || '', chat_id || '', enabled ? 1 : 0);
      this.logActivity('telegram_config_updated', `Telegram config saved`, 'success');
      return true;
    } catch (error) {
      console.error('Error saving Telegram config:', error.message);
      this.logActivity('telegram_config_error', `Failed to save Telegram config: ${error.message}`, 'error');
      return false;
    }
  }

  // Call Records logic
  saveCallRecord(record) {
    try {
      const {
        external_id, caller_number, callee_number, caller_name, callee_name,
        direction, status, sim_port, extension, start_time, answer_time,
        end_time, ring_duration, talk_duration, hold_duration, total_duration,
        recording_url, transfer_to, notes, metadata
      } = record;

      // Check if external_id already exists to avoid duplicates
      if (external_id) {
        const existing = this.db.prepare('SELECT id FROM call_records WHERE external_id = ?').get(external_id);
        if (existing) {
          // Update existing or skip
          return true;
        }
      }

      const stmt = this.db.prepare(`
        INSERT INTO call_records (
          external_id, caller_number, callee_number, caller_name, callee_name,
          direction, status, sim_port, extension, start_time, answer_time,
          end_time, ring_duration, talk_duration, hold_duration, total_duration,
          recording_url, transfer_to, notes, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        external_id, caller_number, callee_number, caller_name, callee_name,
        direction, status, sim_port, extension, start_time, answer_time,
        end_time, ring_duration || 0, talk_duration || 0, hold_duration || 0, total_duration || 0,
        recording_url, transfer_to, notes, JSON.stringify(metadata || {})
      );

      return true;
    } catch (error) {
      console.error('Error saving call record:', error.message);
      return false;
    }
  }

  // PBX Extensions methods
  saveExtension(extensionData) {
    try {
      const {
        extnumber, username, status, type, callerid, registername,
        moblie, email, language, hasvoicemail, alwaysforward, 
        noanswerforward, busyforward, ringtimeout, selectoutroute,
        dnd, nat
      } = extensionData;

      // Check if extension already exists
      const existing = this.db.prepare('SELECT id FROM pbx_extensions WHERE extnumber = ?').get(extnumber);
      
      if (existing) {
        // Update existing extension
        const stmt = this.db.prepare(`
          UPDATE pbx_extensions SET
            username = ?, status = ?, type = ?, callerid = ?, registername = ?,
            mobile = ?, email = ?, language = ?, hasvoicemail = ?, alwaysforward = ?,
            noanswerforward = ?, busyforward = ?, ringtimeout = ?, outroute = ?,
            dnd = ?, nat = ?, metadata = ?, last_synced = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE extnumber = ?
        `);
        stmt.run(
          username, status, type, callerid, registername,
          moblie || null, email || null, language, hasvoicemail, alwaysforward,
          noanswerforward, busyforward, ringtimeout, selectoutroute,
          dnd, nat, JSON.stringify(extensionData), extnumber
        );
      } else {
        // Insert new extension
        const stmt = this.db.prepare(`
          INSERT INTO pbx_extensions (
            extnumber, username, status, type, callerid, registername,
            mobile, email, language, hasvoicemail, alwaysforward,
            noanswerforward, busyforward, ringtimeout, outroute,
            dnd, nat, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          extnumber, username, status, type, callerid, registername,
          moblie || null, email || null, language, hasvoicemail, alwaysforward,
          noanswerforward, busyforward, ringtimeout, selectoutroute,
          dnd, nat, JSON.stringify(extensionData)
        );
      }

      return true;
    } catch (error) {
      console.error('Error saving extension:', error.message);
      return false;
    }
  }

  getExtensions() {
    try {
      const stmt = this.db.prepare('SELECT * FROM pbx_extensions ORDER BY extnumber');
      const extensions = stmt.all();
      return extensions.map(ext => ({
        ...ext,
        metadata: ext.metadata ? JSON.parse(ext.metadata) : {}
      }));
    } catch (error) {
      console.error('Error getting extensions:', error.message);
      return [];
    }
  }

  getExtensionStats() {
    try {
      const total = this.db.prepare('SELECT COUNT(*) as count FROM pbx_extensions').get().count;
      const registered = this.db.prepare("SELECT COUNT(*) as count FROM pbx_extensions WHERE status = 'Registered'").get().count;
      const unavailable = this.db.prepare("SELECT COUNT(*) as count FROM pbx_extensions WHERE status = 'Unavailable'").get().count;

      return {
        total,
        registered,
        unavailable,
        offline: total - registered - unavailable
      };
    } catch (error) {
      console.error('Error getting extension stats:', error.message);
      return {
        total: 0,
        registered: 0,
        unavailable: 0,
        offline: 0
      };
    }
  }

  getCallRecords(limit = 100) {
    try {
      // JOIN with pbx_extensions for both caller and callee lookups
      const stmt = this.db.prepare(`
        SELECT 
          cr.id,
          cr.external_id,
          cr.caller_number,
          cr.callee_number,
          cr.direction,
          cr.status,
          cr.sim_port,
          cr.extension,
          cr.start_time,
          cr.answer_time,
          cr.end_time,
          cr.ring_duration,
          cr.talk_duration,
          cr.hold_duration,
          cr.total_duration,
          cr.recording_url,
          cr.transfer_to,
          cr.notes,
          cr.metadata,
          cr.created_at,
          ce.username as caller_extension_username,
          ca.username as callee_extension_username
        FROM call_records cr
        LEFT JOIN pbx_extensions ce ON cr.caller_number = ce.extnumber
        LEFT JOIN pbx_extensions ca ON cr.callee_number = ca.extnumber
        ORDER BY cr.start_time DESC 
        LIMIT ?
      `);
      
      const records = stmt.all(limit);
      
      return records.map(r => ({
        id: r.id,
        external_id: r.external_id,
        caller_number: r.caller_number,
        callee_number: r.callee_number,
        caller_extension_username: r.caller_extension_username,
        callee_extension_username: r.callee_extension_username,
        direction: r.direction,
        status: r.status,
        sim_port: r.sim_port,
        extension: r.extension,
        start_time: r.start_time,
        answer_time: r.answer_time,
        end_time: r.end_time,
        ring_duration: r.ring_duration,
        talk_duration: r.talk_duration,
        hold_duration: r.hold_duration,
        total_duration: r.total_duration,
        recording_url: r.recording_url,
        transfer_to: r.transfer_to,
        notes: r.notes,
        metadata: r.metadata ? JSON.parse(r.metadata) : {},
        created_at: r.created_at
      }));
    } catch (error) {
      console.error('Error getting call records:', error.message);
      return [];
    }
  }

  getCallStats(filterDate = null) {
    try {
      // If filterDate is not provided, use today's date
      const dateToFilter = filterDate || new Date().toISOString().split('T')[0];
      
      // For filtering by date, use LIKE to match YYYY-MM-DD at the start of the timestamp
      const dateFilterClause = `start_time LIKE '${dateToFilter}%'`;
      
      const totalCalls = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE ${dateFilterClause}`).get().count;
      const answered = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE status = 'answered' AND ${dateFilterClause}`).get().count;
      const missed = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE status = 'missed' AND ${dateFilterClause}`).get().count;
      const totalTalk = this.db.prepare(`SELECT SUM(talk_duration) as total FROM call_records WHERE status = 'answered' AND ${dateFilterClause}`).get().total || 0;
      const totalRing = this.db.prepare(`SELECT SUM(ring_duration) as total FROM call_records WHERE ${dateFilterClause}`).get().total || 0;

      return {
        totalCalls,
        answered,
        missed,
        totalTalkDuration: Math.round(totalTalk),
        totalRingDuration: Math.round(totalRing)
      };
    } catch (error) {
      console.error('Error getting call stats:', error.message);
      return {
        totalCalls: 0,
        answered: 0,
        missed: 0,
        totalTalkDuration: 0,
        totalRingDuration: 0
      };
    }
  }

  getAllTimeCallStats() {
    try {
      const totalCalls = this.db.prepare(`SELECT COUNT(*) as count FROM call_records`).get().count;
      const answered = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE status = 'answered'`).get().count;
      const missed = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE status = 'missed'`).get().count;
      const totalTalk = this.db.prepare(`SELECT SUM(talk_duration) as total FROM call_records WHERE status = 'answered'`).get().total || 0;
      const totalRing = this.db.prepare(`SELECT SUM(ring_duration) as total FROM call_records`).get().total || 0;

      return {
        totalCalls,
        answered,
        missed,
        totalTalkDuration: Math.round(totalTalk),
        totalRingDuration: Math.round(totalRing)
      };
    } catch (error) {
      console.error('Error getting all-time call stats:', error.message);
      return {
        totalCalls: 0,
        answered: 0,
        missed: 0,
        totalTalkDuration: 0,
        totalRingDuration: 0
      };
    }
  }

  getPbxConfig() {
    try {
      const stmt = this.db.prepare('SELECT * FROM pbx_config LIMIT 1');
      return stmt.get() || null;
    } catch (error) {
      console.error('Error getting PBX config:', error.message);
      return null;
    }
  }

  // Gateway configuration methods
  getGatewayConfig() {
    try {
      const stmt = this.db.prepare('SELECT * FROM gateway_config LIMIT 1');
      return stmt.get() || null;
    } catch (error) {
      console.error('Error getting gateway config:', error.message);
      return null;
    }
  }

  saveGatewayConfig(config) {
    try {
      const { gateway_ip, api_username, api_password, api_port = 5038 } = config;
      
      // First check if a record exists
      const existing = this.db.prepare('SELECT id FROM gateway_config LIMIT 1').get();
      
      if (existing) {
        // Update existing record
        const stmt = this.db.prepare(`
          UPDATE gateway_config 
          SET gateway_ip = ?, api_username = ?, api_password = ?, api_port = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        stmt.run(gateway_ip, api_username, api_password, api_port, existing.id);
      } else {
        // Insert new record if none exists
        const stmt = this.db.prepare(`
          INSERT INTO gateway_config (gateway_ip, api_username, api_password, api_port)
          VALUES (?, ?, ?, ?)
        `);
        stmt.run(gateway_ip, api_username, api_password, api_port);
      }
      
      const logger = require('./logger.cjs');
      logger.info(`Gateway config saved: ${gateway_ip}`);
      return true;
    } catch (error) {
      console.error('Error saving gateway config:', error.message);
      return false;
    }
  }

  // SMS message methods
  insertSMS(smsData) {
    try {
      const {
        external_id, sender_number, message_content, received_at, sim_port, status = 'unread', category = null
      } = smsData;
      
      // Use INSERT OR IGNORE to prevent duplicates based on external_id constraint
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO sms_messages 
        (external_id, sender_number, message_content, received_at, sim_port, status, category)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        external_id || null,
        sender_number,
        message_content,
        received_at || new Date().toISOString(),
        sim_port,
        status,
        category
      );
      
      return result.changes > 0;
    } catch (error) {
      console.error('Error inserting SMS:', error.message);
      return false;
    }
  }

  // Call record methods
  insertCallRecord(callData) {
    try {
      // Use INSERT OR IGNORE to prevent duplicates based on external_id constraint
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO call_records (
          external_id, caller_number, callee_number, caller_name, callee_name,
          direction, status, sim_port, extension, start_time, answer_time, end_time,
          ring_duration, talk_duration, hold_duration, total_duration, recording_url,
          transfer_to, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        callData.external_id || null,
        callData.caller_number || null,
        callData.callee_number || null,
        callData.caller_name || null,
        callData.callee_name || null,
        callData.direction || null,
        callData.status || null,
        callData.sim_port || null,
        callData.extension || null,
        callData.start_time || null,
        callData.answer_time || null,
        callData.end_time || null,
        callData.ring_duration || 0,
        callData.talk_duration || 0,
        callData.hold_duration || 0,
        callData.total_duration || 0,
        callData.recording_url || null,
        callData.transfer_to || null,
        JSON.stringify(callData.metadata || {})
      );

      return result.changes > 0;
    } catch (error) {
      console.error('Error inserting call record:', error.message);
      return false;
    }
  }

  getSMSMessages(filters = {}) {
    try {
      let query = 'SELECT * FROM sms_messages WHERE 1=1';
      const params = [];

      if (filters.sim_port) {
        query += ' AND sim_port = ?';
        params.push(filters.sim_port);
      }
      if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }
      if (filters.since) {
        query += ' AND received_at >= ?';
        params.push(filters.since);
      }
      
      query += ' ORDER BY received_at DESC';
      
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      } else {
        query += ' LIMIT 1000';
      }

      const stmt = this.db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('Error getting SMS messages:', error.message);
      return [];
    }
  }

  updateSMSStatus(messageId, status) {
    try {
      const stmt = this.db.prepare(`
        UPDATE sms_messages 
        SET status = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);
      const result = stmt.run(status, messageId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error updating SMS status:', error.message);
      return false;
    }
  }
  saveSMSMessage(smsData) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO sms_messages (
          sender_number, message_content, sim_port, status, 
          external_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        smsData.sender_number,
        smsData.message_content,
        smsData.sim_port || 1,
        smsData.status || 'unread',
        smsData.external_id || null,
        smsData.received_at || new Date().toISOString()
      );
      return result.changes > 0;
    } catch (error) {
      console.error('Error saving SMS message:', error.message);
      return false;
    }
  }

  saveBulkSMS(messages) {
    try {
      const insert = this.db.prepare(`
        INSERT INTO sms_messages (
          sender_number, message_content, sim_port, status, 
          external_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = this.db.transaction((msgs) => {
        for (const msg of msgs) {
          insert.run(
            msg.sender_number,
            msg.message_content,
            msg.sim_port || 1,
            msg.status || 'unread',
            msg.external_id || null,
            msg.received_at || new Date().toISOString()
          );
        }
      });

      insertMany(messages);
      return true;
    } catch (error) {
      console.error('Error saving bulk SMS:', error.message);
      return false;
    }
  }
  deleteSMS(messageId) {
    try {
      const stmt = this.db.prepare('DELETE FROM sms_messages WHERE id = ?');
      const result = stmt.run(messageId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error deleting SMS:', error.message);
      return false;
    }
  }

  // Activity log methods
  logActivity(eventType, message, severity = 'info', sim_port = null, metadata = {}) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO activity_logs 
        (event_type, message, severity, sim_port, metadata)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        eventType,
        message,
        severity,
        sim_port,
        JSON.stringify(metadata)
      );
      return true;
    } catch (error) {
      console.error('Error logging activity:', error.message);
      return false;
    }
  }

  getActivityLogs(filters = {}) {
    try {
      let query = 'SELECT * FROM activity_logs WHERE 1=1';
      const params = [];

      if (filters.severity) {
        query += ' AND severity = ?';
        params.push(filters.severity);
      }
      
      query += ' ORDER BY created_at DESC';
      
      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      } else {
        query += ' LIMIT 500';
      }

      const stmt = this.db.prepare(query);
      return stmt.all(...params);
    } catch (error) {
      console.error('Error getting activity logs:', error.message);
      return [];
    }
  }

  addActivityLog(logData) {
    try {
      const {
        id = `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        event_type,
        message,
        severity = 'info',
        sim_port = null,
        created_at = new Date().toISOString()
      } = logData;

      const stmt = this.db.prepare(
        'INSERT INTO activity_logs (id, event_type, message, severity, sim_port, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      
      stmt.run(id, event_type, message, severity, sim_port, created_at);
      return { id, event_type, message, severity, sim_port, created_at };
    } catch (error) {
      console.error('Error adding activity log:', error.message);
      throw error;
    }
  }

  // Port status methods
  updatePortStatus(port_number, status_data) {
    try {
      const {
        signal_strength = 0,
        carrier = null,
        status = 'unknown',
        phone_number = null,
        label = null
      } = status_data;

      const stmt = this.db.prepare(`
        UPDATE sim_port_config 
        SET signal_strength = ?, carrier = ?, status = ?, 
            phone_number = COALESCE(?, phone_number),
            label = COALESCE(?, label),
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE port_number = ?
      `);
      
      stmt.run(
        signal_strength,
        carrier,
        status,
        phone_number,
        label,
        port_number
      );
      
      return true;
    } catch (error) {
      console.error('Error updating port status:', error.message);
      return false;
    }
  }

  getPortStatus(port_number = null) {
    try {
      let query = 'SELECT * FROM sim_port_config';
      const params = [];

      if (port_number) {
        query += ' WHERE port_number = ?';
        params.push(port_number);
      }

      query += ' ORDER BY port_number ASC';

      const stmt = this.db.prepare(query);
      if (port_number) {
        return stmt.get(...params);
      }
      return stmt.all(...params);
    } catch (error) {
      console.error('Error getting port status:', error.message);
      return port_number ? null : [];
    }
  }

  // Agent heartbeat methods
  updateHeartbeat(agent_id, heartbeat_data) {
    try {
      const {
        status = 'online',
        version = null,
        hostname = null,
        messages_synced = 0,
        errors_count = 0,
        metadata = {}
      } = heartbeat_data;

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO agent_heartbeat 
        (agent_id, status, version, hostname, messages_synced, errors_count, metadata, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      stmt.run(
        agent_id,
        status,
        version,
        hostname,
        messages_synced,
        errors_count,
        JSON.stringify(metadata)
      );

      return true;
    } catch (error) {
      console.error('Error updating heartbeat:', error.message);
      return false;
    }
  }

  getHeartbeat(agent_id = null) {
    try {
      if (agent_id) {
        const stmt = this.db.prepare('SELECT * FROM agent_heartbeat WHERE agent_id = ?');
        return stmt.get(agent_id);
      }
      const stmt = this.db.prepare('SELECT * FROM agent_heartbeat ORDER BY last_seen_at DESC');
      return stmt.all();
    } catch (error) {
      console.error('Error getting heartbeat:', error.message);
      return agent_id ? null : [];
    }
  }

  // Statistics
  getStatistics() {
    try {
      return {
        totalMessages: this.db.prepare('SELECT COUNT(*) as count FROM sms_messages').get().count,
        unreadMessages: this.db.prepare("SELECT COUNT(*) as count FROM sms_messages WHERE status = 'unread'").get().count,
        portStatus: this.db.prepare('SELECT * FROM sim_port_config ORDER BY port_number').all(),
        recentErrors: this.db.prepare(`
          SELECT * FROM activity_logs WHERE severity IN ('error', 'warning') 
          ORDER BY created_at DESC LIMIT 10
        `).all()
      };
    } catch (error) {
      console.error('Error getting statistics:', error.message);
      return null;
    }
  }

  // Authentication methods
  authenticateUser(email, password) {
    try {
      const crypto = require('crypto');
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      
      const stmt = this.db.prepare('SELECT * FROM users WHERE email = ? AND password_hash = ? AND is_active = 1 LIMIT 1');
      const user = stmt.get(email, passwordHash);
      
      if (user) {
        // Update last login
        this.db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
        return { success: true, user: { id: user.id, email: user.email, role: user.role, name: user.name } };
      }
      
      return { success: false, error: 'Invalid email or password' };
    } catch (error) {
      console.error('Error authenticating user:', error.message);
      return { success: false, error: error.message };
    }
  }

  createUser(email, password, role = 'operator', name = null) {
    try {
      const crypto = require('crypto');
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      
      const stmt = this.db.prepare(`
        INSERT INTO users (email, password_hash, role, name)
        VALUES (?, ?, ?, ?)
      `);
      
      stmt.run(email, passwordHash, role, name || email.split('@')[0]);
      this.logActivity('user_created', `User created: ${email} (${role})`, 'success');
      return true;
    } catch (error) {
      console.error('Error creating user:', error.message);
      this.logActivity('user_creation_error', `Failed to create user ${email}: ${error.message}`, 'error');
      return false;
    }
  }

  getUserByEmail(email) {
    try {
      const stmt = this.db.prepare('SELECT id, email, role, name, is_active FROM users WHERE email = ? LIMIT 1');
      return stmt.get(email) || null;
    } catch (error) {
      console.error('Error getting user:', error.message);
      return null;
    }
  }

  getAllUsers() {
    try {
      const stmt = this.db.prepare('SELECT id, email, role, name, is_active, last_login, created_at FROM users ORDER BY created_at DESC');
      return stmt.all() || [];
    } catch (error) {
      console.error('Error getting users:', error.message);
      return [];
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      const logger = require('./logger.cjs');
      logger.info('Database connection closed');
    }
  }
}

module.exports = SMSDatabase;
