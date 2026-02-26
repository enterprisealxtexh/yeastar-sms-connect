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
      
      // Optimize for concurrent writes
      this.db.pragma('synchronous = NORMAL');    // Balance safety & speed
      this.db.pragma('cache_size = -64000');     // 64MB cache
      this.db.pragma('temp_store = MEMORY');     // Temp tables in RAM
      this.db.pragma('query_only = FALSE');      // Allow writes
      this.db.pragma('busy_timeout = 5000');     // Wait up to 5 seconds on lock
      this.db.pragma('wal_autocheckpoint = 1000'); // Checkpoint every 1000 pages
      
      // Create tables if they don't exist
      this.createTables();
      
      // Run migrations for schema updates
      this.runMigrations();
      
      // Create indices for faster querying
      this.createIndices();
      
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

    // SMS Messages table - storing only GsmSpan (2-5) as source of truth
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_messages (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        external_id TEXT UNIQUE,
        sender_number TEXT NOT NULL,
        message_content TEXT NOT NULL,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        gsm_span INTEGER NOT NULL CHECK (gsm_span >= 2 AND gsm_span <= 5),
        status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'processed', 'failed')),
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sms_gsm_span ON sms_messages(gsm_span);
      CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_messages(status);
      CREATE INDEX IF NOT EXISTS idx_sms_received_at ON sms_messages(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sms_sender ON sms_messages(sender_number);
    `);

    // GSM Span Configuration table - stores names/labels for GsmSpan values (2-5)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gsm_span_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        gsm_span INTEGER UNIQUE NOT NULL CHECK (gsm_span >= 2 AND gsm_span <= 5),
        name TEXT,
        phone_number TEXT,
        is_active INTEGER DEFAULT 1,
        signal_strength INTEGER DEFAULT 0,
        carrier TEXT,
        last_seen_at DATETIME,
        last_active_check DATETIME,
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

    // Alert check checkpoint - tracks from which time we should start checking for missed calls
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alert_checkpoints (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        alert_type TEXT UNIQUE NOT NULL,
        last_checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

    // SMS Gateway URLs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_gateways (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        url TEXT NOT NULL UNIQUE,
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // SMS Templates table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_templates (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL,
        message TEXT NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Missed Call Rules table (many-to-many with extensions)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missed_call_rules (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        extensions TEXT NOT NULL,
        threshold INTEGER NOT NULL DEFAULT 3,
        template_id TEXT NOT NULL,
        gateway_id TEXT NOT NULL,
        active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES sms_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (gateway_id) REFERENCES sms_gateways(id) ON DELETE CASCADE
      );
      
      CREATE INDEX IF NOT EXISTS idx_missed_call_active ON missed_call_rules(active);
    `);

    // Business Hours table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS business_hours (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        rule_id TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        days_enabled TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rule_id) REFERENCES missed_call_rules(id) ON DELETE CASCADE
      );
    `);

    // Contacts table - auto-saved from SMS and call records
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        phone_number TEXT UNIQUE NOT NULL,
        name TEXT,
        source TEXT DEFAULT 'sms' CHECK (source IN ('sms', 'call', 'import', 'manual', 'google')),
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sms_count INTEGER DEFAULT 0,
        call_count INTEGER DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);
      CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);
    `);

    // SMS Report Recipients table - phone numbers to send daily reports to
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_report_recipients (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        phone_number TEXT UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sms_report_active ON sms_report_recipients(is_active);
    `);;

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

  runMigrations() {
    try {
      // Migration: Add gsm_span column to sms_messages if it doesn't exist
      const tableInfo = this.db.prepare(`PRAGMA table_info(sms_messages)`).all();
      const hasGsmSpanColumn = tableInfo.some(col => col.name === 'gsm_span');
      
      if (!hasGsmSpanColumn) {
        const logger = require('./logger.cjs');
        logger.info('🔄 Migrating: Adding gsm_span column to sms_messages table...');
        try {
          this.db.exec(`ALTER TABLE sms_messages ADD COLUMN gsm_span INTEGER`);
          this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sms_gsm_span ON sms_messages(gsm_span)`);
          logger.info('✅ Migration complete: gsm_span column added');
        } catch (e) {
          if (!e.message.includes('duplicate column name')) {
            throw e;
          }
        }
      }
      
      // Migration: Add is_returned column to call_records if it doesn't exist
      const callTableInfo = this.db.prepare(`PRAGMA table_info(call_records)`).all();
      const hasIsReturnedColumn = callTableInfo.some(col => col.name === 'is_returned');
      
      if (!hasIsReturnedColumn) {
        const logger = require('./logger.cjs');
        logger.info('🔄 Migrating: Adding is_returned column to call_records table...');
        try {
          this.db.exec(`ALTER TABLE call_records ADD COLUMN is_returned INTEGER DEFAULT 0`);
          logger.info('✅ Migration complete: is_returned column added');
        } catch (e) {
          if (!e.message.includes('duplicate column name')) {
            throw e;
          }
        }
      }
    } catch (error) {
      const logger = require('./logger.cjs');
      logger.warn(`⚠️  Migration check failed: ${error.message}`);
    }
  }

  createIndices() {
    try {
      // Indices already created in CREATE TABLE statements, but ensure critical ones exist
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_call_records_extension ON call_records(extension);
        CREATE INDEX IF NOT EXISTS idx_call_records_caller ON call_records(caller_number);
        CREATE INDEX IF NOT EXISTS idx_call_records_callee ON call_records(callee_number);
        CREATE INDEX IF NOT EXISTS idx_call_records_start_time ON call_records(start_time DESC);
        CREATE INDEX IF NOT EXISTS idx_pbx_extensions_extnumber ON pbx_extensions(extnumber);
        CREATE INDEX IF NOT EXISTS idx_pbx_extensions_callerid ON pbx_extensions(callerid);
      `);
      
      // NOTE: Migration disabled - all calls already have extensions attached (caller or callee)
      // Extensions are pre-populated from PBX sync, no need to re-lookup
      // this.migrateCallExtensions();
    } catch (error) {
      console.error('Error creating indices:', error.message);
    }
  }

  migrateCallExtensions() {
    try {
      // Find calls without extensions and try to populate from callerid lookup
      const callsWithoutExt = this.db.prepare(`
        SELECT id, caller_number, callee_number FROM call_records
        WHERE extension IS NULL OR extension = ''
        LIMIT 100
      `).all();
      
      if (callsWithoutExt.length === 0) return;
      
      console.log(`🔄 Migrating ${callsWithoutExt.length} calls to populate extensions...`);
      
      const findExtensionByCallerId = (phoneNumber) => {
        if (!phoneNumber) return null;
        try {
          const record = this.db.prepare(`
            SELECT extnumber FROM pbx_extensions 
            WHERE callerid = ? OR callerid LIKE ?
            LIMIT 1
          `).get(phoneNumber, `%${phoneNumber.slice(-9)}`);
          return record ? record.extnumber : null;
        } catch (e) {
          return null;
        }
      };
      
      let updated = 0;
      const updateStmt = this.db.prepare('UPDATE call_records SET extension = ? WHERE id = ?');
      
      for (const call of callsWithoutExt) {
        let ext = findExtensionByCallerId(call.caller_number);
        if (!ext) {
          ext = findExtensionByCallerId(call.callee_number);
        }
        if (ext) {
          updateStmt.run(ext, call.id);
          updated++;
        }
      }
      
      if (updated > 0) {
        console.log(`✅ Successfully migrated ${updated} calls with extension lookup`);
      }
    } catch (error) {
      console.error('Error migrating call extensions:', error.message);
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
      
      // If enabling Telegram, reset the missed call alert checkpoint to NOW
      // This ensures we only send alerts for calls AFTER enabling, not historical calls
      if (enabled === true || enabled === 1) {
        try {
          const checkpointStmt = this.db.prepare(`
            INSERT INTO alert_checkpoints (alert_type, last_checked_at)
            VALUES ('missed_call', CURRENT_TIMESTAMP)
            ON CONFLICT(alert_type) DO UPDATE SET last_checked_at = CURRENT_TIMESTAMP
          `);
          checkpointStmt.run();
        } catch (err) {
          console.warn('Could not update alert checkpoint:', err.message);
        }
      }
      
      this.logActivity('telegram_config_updated', `Telegram config saved`, 'success');
      return true;
    } catch (error) {
      console.error('Error saving Telegram config:', error.message);
      this.logActivity('telegram_config_error', `Failed to save Telegram config: ${error.message}`, 'error');
      return false;
    }
  }

  // Alert checkpoint methods - track when to start checking for new alerts
  getAlertCheckpoint(alertType) {
    try {
      const stmt = this.db.prepare('SELECT last_checked_at FROM alert_checkpoints WHERE alert_type = ?');
      const result = stmt.get(alertType);
      return result ? result.last_checked_at : null;
    } catch (error) {
      console.error(`Error getting alert checkpoint for ${alertType}:`, error.message);
      return null;
    }
  }

  updateAlertCheckpoint(alertType, timestamp) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO alert_checkpoints (alert_type, last_checked_at)
        VALUES (?, ?)
        ON CONFLICT(alert_type) DO UPDATE SET last_checked_at = ?
      `);
      stmt.run(alertType, timestamp, timestamp);
      return true;
    } catch (error) {
      console.error(`Error updating alert checkpoint for ${alertType}:`, error.message);
      return false;
    }
  }

  // SMS Report Recipients methods
  getSmsReportRecipients() {
    try {
      const stmt = this.db.prepare('SELECT * FROM sms_report_recipients WHERE is_active = 1 ORDER BY created_at ASC');
      return stmt.all() || [];
    } catch (error) {
      console.error('Error getting SMS report recipients:', error.message);
      return [];
    }
  }

  addSmsReportRecipient(phoneNumber) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO sms_report_recipients (phone_number, is_active)
        VALUES (?, 1)
      `);
      stmt.run(phoneNumber);
      this.logActivity('sms_report_recipient_added', `SMS report recipient added: ${phoneNumber}`, 'success');
      return true;
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        console.warn(`SMS report recipient already exists: ${phoneNumber}`);
        return false;
      }
      console.error('Error adding SMS report recipient:', error.message);
      this.logActivity('sms_report_recipient_error', `Failed to add SMS report recipient: ${error.message}`, 'error');
      return false;
    }
  }

  removeSmsReportRecipient(phoneNumber) {
    try {
      const stmt = this.db.prepare('DELETE FROM sms_report_recipients WHERE phone_number = ?');
      const result = stmt.run(phoneNumber);
      if (result.changes > 0) {
        this.logActivity('sms_report_recipient_removed', `SMS report recipient removed: ${phoneNumber}`, 'success');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error removing SMS report recipient:', error.message);
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

      // ✅ Mark missed calls as returned if this is an outbound answered call
      if (direction === 'outbound' && status === 'answered' && callee_number && start_time) {
        try {
          // Get today's date from the call's start_time
          const callDate = start_time.split(' ')[0] || start_time.split('T')[0];
          
          // Find missed calls from this number today and mark them as returned
          const updateStmt = this.db.prepare(`
            UPDATE call_records 
            SET is_returned = 1
            WHERE direction = 'inbound' 
              AND status IN ('missed', 'no-answer', 'noanswer', 'failed')
              AND caller_number = ?
              AND SUBSTR(start_time, 1, 10) = ?
              AND is_returned = 0
          `);
          const result = updateStmt.run(callee_number, callDate);
          
          if (result.changes > 0) {
            const logger = require('./logger.cjs');
            logger.debug(`✅ Marked ${result.changes} missed call(s) from ${callee_number} as returned`);
          }
        } catch (error) {
          console.error('Error marking missed calls as returned:', error.message);
          // Don't fail the entire operation if this fails
        }
      }

      // ✅ Auto-save contacts from call record
      if (caller_number) {
        this.saveOrUpdateContact(caller_number, caller_name, 'call');
      }
      if (callee_number && direction === 'outbound') {
        this.saveOrUpdateContact(callee_number, callee_name, 'call');
      }

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

  getCallRecords(limit = null) {
    try {
      // JOIN with pbx_extensions for both caller and callee lookups
      // If limit is null, fetch ALL records; otherwise use specified limit
      const limitClause = limit ? `LIMIT ${limit}` : '';
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
        ${limitClause}
      `);
      
      const records = stmt.all();
      
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

  getCallRecordsByExtension(extnumber, limit = null) {
    try {
      // Get call records for a specific extension (caller, callee, or extension field)
      // This queries directly by extension without arbitrary limits
      const limitClause = limit ? `LIMIT ${limit}` : '';
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
        WHERE 
          cr.extension = ? 
          OR cr.caller_number = ?
          OR cr.callee_number = ?
        ORDER BY cr.start_time DESC 
        ${limitClause}
      `);
      
      const records = stmt.all(extnumber, extnumber, extnumber);
      
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
      console.error('Error getting call records by extension:', error.message);
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

  saveSmsGatewayUrl(url) {
    try {
      const logger = require('./logger.cjs');
      
      // Check if URL already exists
      const existing = this.db.prepare('SELECT id FROM sms_gateways WHERE url = ?').get(url);
      
      if (existing) {
        logger.info(`SMS gateway URL already exists: ${url}`);
        return true;
      }
      
      // Insert new SMS gateway URL
      const stmt = this.db.prepare(`
        INSERT INTO sms_gateways (url, active, created_at, updated_at)
        VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      stmt.run(url);
      
      logger.info(`SMS gateway URL saved: ${url}`);
      return true;
    } catch (error) {
      console.error('Error saving SMS gateway URL:', error.message);
      return false;
    }
  }

  // SMS message methods
  insertSMS(smsData) {
    const logger = require('./logger.cjs');
    const maxRetries = 5; // Increased from 3 to 5
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const {
          external_id, sender_number, message_content, received_at, gsm_span, status = 'unread', category = null
        } = smsData;
        
        // Validate required fields - gsm_span should be 2-5
        if (!sender_number || gsm_span === undefined || gsm_span === null) {
          logger.warn(`⚠️  SMS validation failed: sender=${sender_number}, gsm_span=${gsm_span}`);
          return false;
        }

        // Check if duplicate already exists by external_id
        const existingStmt = this.db.prepare(`
          SELECT id FROM sms_messages WHERE external_id = ?
        `);
        const existing = external_id ? existingStmt.get(external_id) : null;
        
        if (existing) {
          logger.debug(`ℹ️  SMS already exists (duplicate): external_id=${external_id}`);
          return false;
        }

        // ADDITIONAL: Check for duplicates within last 5 seconds by content+sender+gsm_span
        // This catches cases where external_id is null or non-unique
        const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
        const contentAbstract = message_content ? message_content.substring(0, 100) : '';
        
        const recentDupStmt = this.db.prepare(`
          SELECT id FROM sms_messages 
          WHERE sender_number = ? 
          AND gsm_span = ? 
          AND message_content LIKE ? 
          AND received_at > ?
          LIMIT 1
        `);
        const recentDup = recentDupStmt.get(sender_number, gsm_span, contentAbstract + '%', fiveSecondsAgo);
        
        if (recentDup) {
          logger.debug(`ℹ️  SMS likely duplicate (received within 5s): sender=${sender_number}, gsm_span=${gsm_span}`);
          return false;
        }
        
        // Convert gsm_span (2-5) to sim_port (1-4)
        // gsm_span: 2→port 1, 3→port 2, 4→port 3, 5→port 4
        const simPort = Math.max(1, gsm_span - 1);
        
        // Use INSERT to add new message - storing BOTH sim_port (1-4) and gsm_span (2-5)
        const stmt = this.db.prepare(`
          INSERT INTO sms_messages 
          (external_id, sender_number, message_content, received_at, sim_port, gsm_span, status, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
          external_id || null,
          sender_number,
          message_content,
          received_at || new Date().toISOString(),
          simPort,
          gsm_span,
          status,
          category
        );
        
        if (result.changes > 0) {
          logger.debug(`✅ SMS inserted: id=${result.lastInsertRowid}, ext_id=${external_id}`);
          return true;
        }
        
        logger.warn(`⚠️  SMS insert returned 0 changes: ${sender_number} on GsmSpan ${gsm_span}`);
        return false;
        
      } catch (error) {
        lastError = error;
        
        // Check if it's a database locked error
        if (error.code === 'SQLITE_BUSY' || error.message?.includes('database is locked')) {
          if (attempt < maxRetries) {
            const waitMs = 200 * Math.pow(2, attempt - 1); // Exponential backoff: 200ms, 400ms, 800ms, 1600ms, 3200ms
            logger.warn(`⚠️  Database locked (attempt ${attempt}/${maxRetries}), retrying in ${waitMs}ms...`);
            const startWait = Date.now();
            while (Date.now() - startWait < waitMs) {} // Busy wait
            continue;
          }
        }
        
        // Non-transient error, give up
        logger.error(`❌ SMS INSERT ERROR (attempt ${attempt}/${maxRetries}): ${error.message}`);
        logger.error(`   Data: sender=${smsData.sender_number}, gsm_span=${smsData.gsm_span}, id=${smsData.external_id}`);
        if (error.code) logger.error(`   Code: ${error.code}`);
        
        break;
      }
    }
    
    logger.error(`❌ SMS INSERT FAILED after ${maxRetries} attempts: ${lastError?.message}`);
    return false;
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
      let query = `
        SELECT 
          sm.*,
          COALESCE(gsc.name, 'Port ' || (sm.gsm_span - 1)) as port_name
        FROM sms_messages sm
        LEFT JOIN gsm_span_config gsc ON sm.gsm_span = gsc.gsm_span
        WHERE 1=1
      `;
      const params = [];

      if (filters.sim_port) {
        // Legacy filter support: convert sim_port (1-4) to gsm_span (2-5)
        query += ' AND sm.gsm_span = ?';
        params.push(parseInt(filters.sim_port) + 1);
      }
      if (filters.gsm_span) {
        query += ' AND sm.gsm_span = ?';
        params.push(parseInt(filters.gsm_span));
      }
      if (filters.status) {
        query += ' AND sm.status = ?';
        params.push(filters.status);
      }
      if (filters.since) {
        query += ' AND sm.received_at >= ?';
        params.push(filters.since);
      }
      
      query += ' ORDER BY sm.received_at DESC';
      
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
      // Convert sim_port to gsm_span if needed (sim_port 1-4 -> gsm_span 2-5)
      const gsm_span = smsData.gsm_span || (smsData.sim_port ? smsData.sim_port + 1 : 2);
      const sim_port = smsData.sim_port || (smsData.gsm_span ? smsData.gsm_span - 1 : 1);
      
      const stmt = this.db.prepare(`
        INSERT INTO sms_messages (
          sender_number, message_content, sim_port, gsm_span, status, 
          external_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        smsData.sender_number,
        smsData.message_content,
        sim_port,
        gsm_span,
        smsData.status || 'unread',
        smsData.external_id || null,
        smsData.received_at || new Date().toISOString()
      );
      
      // ✅ Auto-save contact from SMS sender
      if (result.changes > 0 && smsData.sender_number) {
        this.saveOrUpdateContact(smsData.sender_number, null, 'sms');
      }
      
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
          sender_number, message_content, sim_port, gsm_span, status, 
          external_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = this.db.transaction((msgs) => {
        for (const msg of msgs) {
          // Convert sim_port to gsm_span if needed (sim_port 1-4 -> gsm_span 2-5)
          const gsm_span = msg.gsm_span || (msg.sim_port ? msg.sim_port + 1 : 2);
          const sim_port = msg.sim_port || (msg.gsm_span ? msg.gsm_span - 1 : 1);
          
          insert.run(
            msg.sender_number,
            msg.message_content,
            sim_port,
            gsm_span,
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

  // ========================================
  // CONTACTS MANAGEMENT
  // ========================================

  saveOrUpdateContact(phoneNumber, name = null, source = 'sms') {
    try {
      const existingContact = this.db.prepare('SELECT id FROM contacts WHERE phone_number = ?').get(phoneNumber);
      
      if (existingContact) {
        // Update existing contact
        this.db.prepare(`
          UPDATE contacts 
          SET name = COALESCE(?, name), 
              last_seen_at = CURRENT_TIMESTAMP,
              ${source === 'sms' ? 'sms_count = sms_count + 1' : source === 'call' ? 'call_count = call_count + 1' : ''},
              updated_at = CURRENT_TIMESTAMP
          WHERE phone_number = ?
        `).run(name, phoneNumber);
        return existingContact.id;
      } else {
        // Insert new contact
        const result = this.db.prepare(`
          INSERT INTO contacts (phone_number, name, source, first_seen_at, last_seen_at, sms_count, call_count)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?)
        `).run(
          phoneNumber,
          name,
          source,
          source === 'sms' ? 1 : 0,
          source === 'call' ? 1 : 0
        );
        return result.lastInsertRowid;
      }
    } catch (error) {
      console.error('Error saving contact:', error.message);
      return null;
    }
  }

  getContacts() {
    try {
      const stmt = this.db.prepare(`
        SELECT id, phone_number, name, source, first_seen_at, last_seen_at, sms_count, call_count, notes, created_at, updated_at
        FROM contacts
        ORDER BY last_seen_at DESC
      `);
      return stmt.all() || [];
    } catch (error) {
      console.error('Error getting contacts:', error.message);
      return [];
    }
  }

  getContact(id) {
    try {
      const stmt = this.db.prepare(`
        SELECT id, phone_number, name, source, first_seen_at, last_seen_at, sms_count, call_count, notes, created_at, updated_at
        FROM contacts
        WHERE id = ?
      `);
      return stmt.get(id) || null;
    } catch (error) {
      console.error('Error getting contact:', error.message);
      return null;
    }
  }

  updateContact(id, updates = {}) {
    try {
      const { name, notes } = updates;
      const fields = [];
      const values = [];

      if (name !== undefined) {
        fields.push('name = ?');
        values.push(name);
      }
      if (notes !== undefined) {
        fields.push('notes = ?');
        values.push(notes);
      }

      if (fields.length === 0) return false;

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      const sql = `UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...values);
      this.logActivity('contact_updated', `Contact updated: ${id}`, 'success');
      return true;
    } catch (error) {
      console.error('Error updating contact:', error.message);
      return false;
    }
  }

  mergeDuplicateContacts() {
    try {
      // Find duplicate phone patterns and merge
      const duplicates = this.db.prepare(`
        SELECT phone_number, COUNT(*) as cnt
        FROM contacts
        GROUP BY phone_number
        HAVING cnt > 1
      `).all();

      let mergedCount = 0;

      for (const dup of duplicates) {
        const contacts = this.db.prepare(`
          SELECT id, sms_count, call_count, notes
          FROM contacts
          WHERE phone_number = ?
          ORDER BY last_seen_at DESC
        `).all(dup.phone_number);

        if (contacts.length > 1) {
          const primary = contacts[0];
          const toMerge = contacts.slice(1);

          // Sum SMS and call counts
          let totalSms = primary.sms_count;
          let totalCalls = primary.call_count;
          let mergedNotes = primary.notes || '';

          for (const contact of toMerge) {
            totalSms += contact.sms_count;
            totalCalls += contact.call_count;
            if (contact.notes && !mergedNotes.includes(contact.notes)) {
              mergedNotes += (mergedNotes ? '\n' : '') + contact.notes;
            }
          }

          // Update primary contact
          this.db.prepare(`
            UPDATE contacts
            SET sms_count = ?, call_count = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(totalSms, totalCalls, mergedNotes, primary.id);

          // Delete duplicates
          const deleteIds = toMerge.map(c => c.id);
          for (const id of deleteIds) {
            this.db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
          }

          mergedCount++;
        }
      }

      if (mergedCount > 0) {
        this.logActivity('contacts_merged', `Merged ${mergedCount} duplicate contacts`, 'success');
      }
      return mergedCount;
    } catch (error) {
      console.error('Error merging duplicates:', error.message);
      return 0;
    }
  }

  importContacts(contactsList = []) {
    try {
      let importedCount = 0;

      for (const contact of contactsList) {
        if (!contact.phone_number) continue;
        
        const existing = this.db.prepare('SELECT id FROM contacts WHERE phone_number = ?').get(contact.phone_number);
        
        if (existing) {
          // Update if it already exists
          if (contact.name) {
            this.db.prepare('UPDATE contacts SET name = COALESCE(?, name), source = ?, updated_at = CURRENT_TIMESTAMP WHERE phone_number = ?')
              .run(contact.name, contact.source || 'import', contact.phone_number);
          }
        } else {
          // Insert new
          this.db.prepare(`
            INSERT INTO contacts (phone_number, name, source, first_seen_at, last_seen_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `).run(contact.phone_number, contact.name || null, contact.source || 'import');
        }
        importedCount++;
      }

      if (importedCount > 0) {
        this.logActivity('contacts_imported', `Imported ${importedCount} contacts`, 'success');
      }
      return importedCount;
    } catch (error) {
      console.error('Error importing contacts:', error.message);
      return 0;
    }
  }

  // Expose database prepare method for direct SQL queries
  prepare(sql) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db.prepare(sql);
  }

  // Expose database exec method for direct SQL execution
  exec(sql) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db.exec(sql);
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
