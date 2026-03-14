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
        direction TEXT DEFAULT 'received' CHECK (direction IN ('received', 'sent')),
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sms_gsm_span ON sms_messages(gsm_span);
      CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_messages(status);
      CREATE INDEX IF NOT EXISTS idx_sms_direction ON sms_messages(direction);
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

    // SIM Port Configuration table - stores port labels and metadata
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sim_port_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        port_number INTEGER UNIQUE NOT NULL CHECK (port_number >= 1 AND port_number <= 4),
        label TEXT,
        phone_number TEXT,
        carrier TEXT,
        signal_strength INTEGER DEFAULT 0,
        status TEXT DEFAULT 'unknown',
        last_seen_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sim_port_number ON sim_port_config(port_number);
    `);

    // SMS Sent Deduplication table - track sent SMS to prevent duplicates within 24 hours
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_sent_log (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        phone_number TEXT NOT NULL,
        message_hash TEXT NOT NULL,
        last_sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_sms_sent_phone ON sms_sent_log(phone_number);
      CREATE INDEX IF NOT EXISTS idx_sms_sent_last_time ON sms_sent_log(last_sent_at DESC);
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
        sim_port INTEGER CHECK (sim_port IS NULL OR (sim_port >= 1 AND sim_port <= 4)),
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
        pin TEXT,
        telegram_chat_id TEXT,
        notification_channel TEXT DEFAULT 'telegram',
        name TEXT,
        is_active BOOLEAN DEFAULT 1,
        last_login DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // user_roles table - allow mapping to support super_admin and role history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('super_admin','admin','operator','viewer')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // User Port Permissions - which SIM ports each user can access
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_port_permissions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL,
        sim_port INTEGER NOT NULL CHECK (sim_port >= 1 AND sim_port <= 4),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, sim_port),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // User Extension Permissions - which extensions each user can access
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_extension_permissions (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        user_id TEXT NOT NULL,
        extension TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, extension),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // Telegram configuration table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        bot_token TEXT,
        chat_id TEXT,
        enabled BOOLEAN DEFAULT 0,
        email_enabled BOOLEAN DEFAULT 0,
        email_recipients TEXT DEFAULT '[]',
        email_smtp_host TEXT DEFAULT '',
        email_smtp_port INTEGER DEFAULT 587,
        email_smtp_user TEXT DEFAULT '',
        email_smtp_pass TEXT DEFAULT '',
        email_from TEXT DEFAULT '',
        sms_enabled BOOLEAN DEFAULT 1,
        notify_missed_calls BOOLEAN DEFAULT 1,
        notify_new_sms BOOLEAN DEFAULT 0,
        notify_system_errors BOOLEAN DEFAULT 1,
        notify_shift_changes BOOLEAN DEFAULT 1,
        daily_report_enabled BOOLEAN DEFAULT 0,
        daily_report_time TEXT DEFAULT '18:00',
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

    // Auto-Reply Config table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auto_reply_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        enabled BOOLEAN DEFAULT 0,
        message TEXT DEFAULT 'Thank you for your message. We will get back to you shortly.',
        notification_email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Call Auto-SMS Config table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS call_auto_sms_config (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        enabled BOOLEAN DEFAULT 0,
        answered_message TEXT DEFAULT '',
        missed_message TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // System Settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default settings if not exist
    this.db.exec(`
      INSERT OR IGNORE INTO system_settings (key, value, description)
      VALUES 
        ('sms_enabled', 'true', 'Enable or disable SMS sending globally')
    `);

    // ========== STAFF MANAGEMENT TABLES ==========

    // Agents table - staff members
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        name TEXT NOT NULL UNIQUE,
        pin TEXT NOT NULL DEFAULT '0000',
        email TEXT UNIQUE,
        phone TEXT,
        extension TEXT UNIQUE,
        telegram_chat_id TEXT,
        notification_channel TEXT DEFAULT 'telegram',
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Agent Shifts - clock in/out records
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_shifts (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_id TEXT NOT NULL,
        clock_in DATETIME NOT NULL,
        clock_out DATETIME,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `);

    // Shift Schedule - scheduled shifts
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shift_schedule (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_id TEXT NOT NULL,
        shift_date DATE NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `);

    // Shift Swap Requests
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shift_swap_requests (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        requester_agent_id TEXT NOT NULL,
        requester_shift_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        target_shift_id TEXT NOT NULL,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        reviewed_by TEXT,
        review_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (requester_agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (target_agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `);

    // Agent Ratings
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_ratings (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_id TEXT NOT NULL,
        rated_by TEXT,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        comment TEXT,
        rating_date DATE DEFAULT CURRENT_DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
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
      // Ensure role mapping exists for default admin
      const adminUser = this.db.prepare('SELECT id FROM users WHERE email = ?').get('admin@nosteq.co.ke');
      if (adminUser) {
        try {
          this.db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, ?)`).run(adminUser.id, 'super_admin');
        } catch (e) {
          // ignore duplicate
        }
      }
      const logger = require('./logger.cjs');
      logger.info('Default admin user created (admin@nosteq.co.ke)');
    }

    // Insert default Auto-Reply config if empty
    const autoReplyCount = this.db.prepare('SELECT COUNT(*) as cnt FROM auto_reply_config').get().cnt;
    if (autoReplyCount === 0) {
      this.db.prepare(`
        INSERT INTO auto_reply_config (enabled, message)
        VALUES (0, 'Thank you for your message. We will get back to you shortly.')
      `).run();
    }

    // Insert default Call Auto-SMS config if empty
    const callAutoSmsCount = this.db.prepare('SELECT COUNT(*) as cnt FROM call_auto_sms_config').get().cnt;
    if (callAutoSmsCount === 0) {
      this.db.prepare(
        'INSERT INTO call_auto_sms_config (enabled, answered_message, missed_message) VALUES (?, ?, ?)'
      ).run(
        0,
        'Thank you for calling us! We appreciate your business and are here to help anytime.',
        "We missed your call! Sorry we couldn't answer. We'll get back to you shortly. Your call is important to us."
      );
    }

    // Insert default Telegram config if empty
    const telegramCount = this.db.prepare('SELECT COUNT(*) as cnt FROM telegram_config').get().cnt;
    if (telegramCount === 0) {
      this.db.prepare(`
        INSERT INTO telegram_config (
          bot_token,
          chat_id,
          enabled,
          email_enabled,
          email_recipients,
          sms_enabled,
          notify_missed_calls,
          notify_new_sms,
          notify_system_errors,
          notify_shift_changes,
          daily_report_enabled,
          daily_report_time,
          is_active
        )
        VALUES ('', '', 0, 0, '[]', 1, 1, 0, 1, 1, 0, '18:00', 1)
      `).run();
    }
  }

  runMigrations() {
    try {
      const logger = require('./logger.cjs');
      const tableInfo = this.db.prepare(`PRAGMA table_info(sms_messages)`).all();
      
      // Migration: Add direction column to sms_messages if it doesn't exist
      const hasDirectionColumn = tableInfo.some(col => col.name === 'direction');
      if (!hasDirectionColumn) {
        logger.info('🔄 Migrating: Adding direction column to sms_messages table...');
        try {
          this.db.exec(`ALTER TABLE sms_messages ADD COLUMN direction TEXT DEFAULT 'received' CHECK (direction IN ('received', 'sent'))`);
          this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sms_direction ON sms_messages(direction)`);
          logger.info('✅ Migration complete: direction column added');
        } catch (e) {
          if (!e.message.includes('duplicate column name')) {
            logger.warn(`⚠️  Could not add direction column: ${e.message}`);
          }
        }
      }
      
      // Migration: Add gsm_span column to sms_messages if it doesn't exist
      const hasGsmSpanColumn = tableInfo.some(col => col.name === 'gsm_span');
      
      if (!hasGsmSpanColumn) {
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

      // Migration: Add notification settings columns to telegram_config
      const telegramTableInfo = this.db.prepare(`PRAGMA table_info(telegram_config)`).all();
      const telegramColumns = new Set(telegramTableInfo.map(col => col.name));
      const telegramColumnMigrations = [
        { name: 'email_enabled', ddl: 'ALTER TABLE telegram_config ADD COLUMN email_enabled BOOLEAN DEFAULT 0' },
        { name: 'email_recipients', ddl: "ALTER TABLE telegram_config ADD COLUMN email_recipients TEXT DEFAULT '[]'" },
        { name: 'sms_enabled', ddl: 'ALTER TABLE telegram_config ADD COLUMN sms_enabled BOOLEAN DEFAULT 1' },
        { name: 'notify_missed_calls', ddl: 'ALTER TABLE telegram_config ADD COLUMN notify_missed_calls BOOLEAN DEFAULT 1' },
        { name: 'notify_new_sms', ddl: 'ALTER TABLE telegram_config ADD COLUMN notify_new_sms BOOLEAN DEFAULT 0' },
        { name: 'notify_system_errors', ddl: 'ALTER TABLE telegram_config ADD COLUMN notify_system_errors BOOLEAN DEFAULT 1' },
        { name: 'notify_shift_changes', ddl: 'ALTER TABLE telegram_config ADD COLUMN notify_shift_changes BOOLEAN DEFAULT 1' },
        { name: 'daily_report_enabled', ddl: 'ALTER TABLE telegram_config ADD COLUMN daily_report_enabled BOOLEAN DEFAULT 0' },
        { name: 'daily_report_time', ddl: "ALTER TABLE telegram_config ADD COLUMN daily_report_time TEXT DEFAULT '18:00'" },
        { name: 'email_smtp_host', ddl: "ALTER TABLE telegram_config ADD COLUMN email_smtp_host TEXT DEFAULT ''" },
        { name: 'email_smtp_port', ddl: 'ALTER TABLE telegram_config ADD COLUMN email_smtp_port INTEGER DEFAULT 587' },
        { name: 'email_smtp_user', ddl: "ALTER TABLE telegram_config ADD COLUMN email_smtp_user TEXT DEFAULT ''" },
        { name: 'email_smtp_pass', ddl: "ALTER TABLE telegram_config ADD COLUMN email_smtp_pass TEXT DEFAULT ''" },
        { name: 'email_from', ddl: "ALTER TABLE telegram_config ADD COLUMN email_from TEXT DEFAULT ''" }
      ];

      for (const migration of telegramColumnMigrations) {
        if (!telegramColumns.has(migration.name)) {
          try {
            this.db.exec(migration.ddl);
          } catch (e) {
            if (!e.message.includes('duplicate column name')) {
              throw e;
            }
          }
        }
      }

      // Migration: Clean up activity_logs with invalid sim_port values (not 1-4 and not null)
      try {
        const logger = require('./logger.cjs');
        const result = this.db.prepare(`
          DELETE FROM activity_logs 
          WHERE sim_port IS NOT NULL AND (sim_port < 1 OR sim_port > 4)
        `).run();
        if (result.changes > 0) {
          logger.info(`🔄 Migration: Cleaned up ${result.changes} activity_logs with invalid sim_port values`);
        }
      } catch (e) {
        // ignore if table doesn't exist yet
      }

      // Migration: Ensure agent_shifts uses `agent_id` column (older DBs used `user_id`)
      try {
        const agentShiftsInfo = this.db.prepare(`PRAGMA table_info(agent_shifts)`).all();
        const hasAgentId = agentShiftsInfo.some(col => col.name === 'agent_id');
        const hasUserId = agentShiftsInfo.some(col => col.name === 'user_id');

        if (!hasAgentId && hasUserId) {
          const logger = require('./logger.cjs');
          logger.info('🔄 Migrating: Renaming agent_shifts.user_id -> agent_id');
          try {
            // Add new column and copy values from user_id
            this.db.exec(`ALTER TABLE agent_shifts ADD COLUMN agent_id TEXT`);
            this.db.prepare(`UPDATE agent_shifts SET agent_id = user_id WHERE agent_id IS NULL OR agent_id = ''`).run();
            // Note: Cannot drop column in SQLite easily; keep `user_id` for compatibility.
            logger.info('✅ Migration complete: agent_shifts.agent_id populated from user_id');
          } catch (e) {
            if (!e.message.includes('duplicate column name')) {
              throw e;
            }
          }
        }
      } catch (e) {
        // ignore migration failures here but log
        try { const logger = require('./logger.cjs'); logger.warn(`⚠️  agent_shifts migration check failed: ${e.message}`); } catch (e2) {}
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

  // User management helpers used by API server
  getAllUsers() {
    try {
      const stmt = this.db.prepare(`
        SELECT u.id, u.email, u.name, COALESCE(ur.role, u.role) as role, u.pin, u.telegram_chat_id, u.notification_channel, u.is_active, u.last_login, u.created_at, u.updated_at
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        ORDER BY u.email
      `);
      return stmt.all();
    } catch (error) {
      console.error('Error getting all users:', error.message);
      return [];
    }
  }

  createUser({ email, password, name = '', role = 'operator', pin = null, telegram_chat_id = null, notification_channel = 'telegram' }) {
    try {
      const crypto = require('crypto');
      const password_hash = crypto.createHash('sha256').update(password).digest('hex');
      const stmt = this.db.prepare(`INSERT INTO users (email, password_hash, role, pin, telegram_chat_id, notification_channel, name, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`);
      const result = stmt.run(email, password_hash, role === 'super_admin' ? 'admin' : role, pin, telegram_chat_id, notification_channel, name);
      if (result.changes > 0) {
        const userId = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
        try {
          this.db.prepare('INSERT OR REPLACE INTO user_roles (user_id, role) VALUES (?, ?)').run(userId, role === 'super_admin' ? 'super_admin' : role);
        } catch (e) {
          // ignore
        }
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error creating user:', error.message);
      return false;
    }
  }

  setUserRole(userId, role) {
    try {
      // Update users.role (legacy field) and user_roles mapping
      const allowed = ['super_admin', 'admin', 'operator', 'viewer'];
      if (!allowed.includes(role)) return false;

      // Map super_admin to admin for users.role column to maintain compatibility
      const legacyRole = role === 'super_admin' ? 'admin' : role;
      this.db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(legacyRole, userId);

      // Upsert into user_roles
      this.db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, created_at = CURRENT_TIMESTAMP').run(userId, role);
      return true;
    } catch (error) {
      console.error('Error setting user role:', error.message);
      return false;
    }
  }

  // Port permisions management
  setUserPortPermissions(userId, ports) {
    try {
      // Clear existing permissions
      this.db.prepare('DELETE FROM user_port_permissions WHERE user_id = ?').run(userId);
      
      // Add new permissions (empty array means all ports)
      if (ports && ports.length > 0) {
        const stmt = this.db.prepare('INSERT INTO user_port_permissions (user_id, sim_port) VALUES (?, ?)');
        ports.forEach(port => stmt.run(userId, port));
      }
      return true;
    } catch (error) {
      console.error('Error setting user port permissions:', error.message);
      return false;
    }
  }

  getUserPortPermissions(userId) {
    try {
      const stmt = this.db.prepare('SELECT sim_port FROM user_port_permissions WHERE user_id = ? ORDER BY sim_port');
      const rows = stmt.all(userId);
      return rows.map(r => r.sim_port);
    } catch (error) {
      console.error('Error getting user port permissions:', error.message);
      return [];
    }
  }

  // Extension permissions management
  setUserExtensionPermissions(userId, extensions) {
    try {
      // Clear existing permissions
      this.db.prepare('DELETE FROM user_extension_permissions WHERE user_id = ?').run(userId);
      
      // Add new permissions (empty array means all extensions)
      if (extensions && extensions.length > 0) {
        const stmt = this.db.prepare('INSERT INTO user_extension_permissions (user_id, extension) VALUES (?, ?)');
        extensions.forEach(ext => stmt.run(userId, ext));
      }
      return true;
    } catch (error) {
      console.error('Error setting user extension permissions:', error.message);
      return false;
    }
  }

  getUserExtensionPermissions(userId) {
    try {
      const stmt = this.db.prepare('SELECT extension FROM user_extension_permissions WHERE user_id = ? ORDER BY extension');
      const rows = stmt.all(userId);
      return rows.map(r => r.extension);
    } catch (error) {
      console.error('Error getting user extension permissions:', error.message);
      return [];
    }
  }

  saveTelegramConfig(config) {
    try {
      const {
        bot_token,
        chat_id,
        enabled,
        email_enabled = false,
        email_recipients = [],
        email_smtp_host = '',
        email_smtp_port = 587,
        email_smtp_user = '',
        email_smtp_pass = '',
        email_from = '',
        sms_enabled = true,
        notify_missed_calls = true,
        notify_new_sms = false,
        notify_system_errors = true,
        notify_shift_changes = true,
        daily_report_enabled = false,
        daily_report_time = '18:00'
      } = config;
      const stmt = this.db.prepare(`
        UPDATE telegram_config 
        SET
          bot_token = ?,
          chat_id = ?,
          enabled = ?,
          email_enabled = ?,
          email_recipients = ?,
          email_smtp_host = ?,
          email_smtp_port = ?,
          email_smtp_user = ?,
          email_smtp_pass = ?,
          email_from = ?,
          sms_enabled = ?,
          notify_missed_calls = ?,
          notify_new_sms = ?,
          notify_system_errors = ?,
          notify_shift_changes = ?,
          daily_report_enabled = ?,
          daily_report_time = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = (SELECT id FROM telegram_config LIMIT 1)
      `);
      stmt.run(
        bot_token || '',
        chat_id || '',
        enabled ? 1 : 0,
        email_enabled ? 1 : 0,
        JSON.stringify(Array.isArray(email_recipients) ? email_recipients : []),
        email_smtp_host || '',
        email_smtp_port || 587,
        email_smtp_user || '',
        email_smtp_pass || '',
        email_from || '',
        sms_enabled ? 1 : 0,
        notify_missed_calls ? 1 : 0,
        notify_new_sms ? 1 : 0,
        notify_system_errors ? 1 : 0,
        notify_shift_changes ? 1 : 0,
        daily_report_enabled ? 1 : 0,
        daily_report_time || '18:00'
      );
      
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

  // SMS Template methods
  getSmsTemplates() {
    try {
      const stmt = this.db.prepare('SELECT * FROM sms_templates ORDER BY created_at DESC');
      return stmt.all() || [];
    } catch (error) {
      console.error('Error getting SMS templates:', error.message);
      return [];
    }
  }

  createSmsTemplate({ name, message, active = true }) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO sms_templates (name, message, active)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(name, message, active ? 1 : 0);
      if (result.changes > 0) {
        this.logActivity('sms_template_created', `SMS template created: ${name}`, 'success');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error creating SMS template:', error.message);
      return false;
    }
  }

  updateSmsTemplate(id, { name, message, active = true }) {
    try {
      const stmt = this.db.prepare(`
        UPDATE sms_templates
        SET name = ?, message = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      const result = stmt.run(name, message, active ? 1 : 0, id);
      if (result.changes > 0) {
        this.logActivity('sms_template_updated', `SMS template updated: ${name}`, 'success');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating SMS template:', error.message);
      return false;
    }
  }

  deleteSmsTemplate(id) {
    try {
      const stmt = this.db.prepare('DELETE FROM sms_templates WHERE id = ?');
      const result = stmt.run(id);
      if (result.changes > 0) {
        this.logActivity('sms_template_deleted', `SMS template deleted: ${id}`, 'success');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error deleting SMS template:', error.message);
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
  getCallStats(filterDate = null, extension = null) {
    try {
      // If filterDate is not provided, use today's date
      const dateToFilter = filterDate || new Date().toISOString().split('T')[0];
      
      // For filtering by date, use LIKE to match YYYY-MM-DD at the start of the timestamp
      const dateFilterClause = `start_time LIKE '${dateToFilter}%'`;
      const extClause = extension ? ` AND (caller_number = ? OR callee_number = ?)` : '';
      const extParams = extension ? [extension, extension] : [];
      
      const totalCalls = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE ${dateFilterClause}${extClause}`).get(...extParams).count;
      const answered = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE status = 'answered' AND ${dateFilterClause}${extClause}`).get(...extParams).count;
      const missed = this.db.prepare(`SELECT COUNT(*) as count FROM call_records WHERE status = 'missed' AND ${dateFilterClause}${extClause}`).get(...extParams).count;
      const totalTalk = this.db.prepare(`SELECT SUM(talk_duration) as total FROM call_records WHERE status = 'answered' AND ${dateFilterClause}${extClause}`).get(...extParams).total || 0;
      const totalRing = this.db.prepare(`SELECT SUM(ring_duration) as total FROM call_records WHERE ${dateFilterClause}${extClause}`).get(...extParams).total || 0;

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

  getAllTimeCallStats(extension = null) {
    try {
      const whereClause = extension ? `WHERE (caller_number = ? OR callee_number = ?)` : '';
      const extParams = extension ? [extension, extension] : [];
      const totalCalls = this.db.prepare(`SELECT COUNT(*) as count FROM call_records ${whereClause}`).get(...extParams).count;
      const answered = this.db.prepare(`SELECT COUNT(*) as count FROM call_records ${extension ? 'WHERE (caller_number = ? OR callee_number = ?) AND' : 'WHERE'} status = 'answered'`).get(...extParams).count;
      const missed = this.db.prepare(`SELECT COUNT(*) as count FROM call_records ${extension ? 'WHERE (caller_number = ? OR callee_number = ?) AND' : 'WHERE'} status = 'missed'`).get(...extParams).count;
      const totalTalk = this.db.prepare(`SELECT SUM(talk_duration) as total FROM call_records ${extension ? 'WHERE (caller_number = ? OR callee_number = ?) AND' : 'WHERE'} status = 'answered'`).get(...extParams).total || 0;
      const totalRing = this.db.prepare(`SELECT SUM(ring_duration) as total FROM call_records ${whereClause}`).get(...extParams).total || 0;

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

  // System Settings methods
  getSystemSetting(key) {
    try {
      const stmt = this.db.prepare('SELECT value FROM system_settings WHERE key = ?');
      const result = stmt.get(key);
      return result ? result.value : null;
    } catch (error) {
      console.error(`Error getting system setting ${key}:`, error.message);
      return null;
    }
  }

  setSystemSetting(key, value) {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO system_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      stmt.run(key, String(value));
      const logger = require('./logger.cjs');
      logger.info(`System setting updated: ${key} = ${value}`);
      return true;
    } catch (error) {
      console.error(`Error setting system setting ${key}:`, error.message);
      return false;
    }
  }

  isSmsEnabled() {
    const setting = this.getSystemSetting('sms_enabled');
    return setting === null || setting === 'true'; // Default to true if not set
  }

  // SMS message methods
  insertSMS(smsData) {
    const logger = require('./logger.cjs');
    const maxRetries = 5; // Increased from 3 to 5
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const {
          external_id, sender_number, message_content, received_at, gsm_span, status = 'unread', direction = 'received', category = null
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
          return true; // Already stored — not an error
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
          return true; // Already stored — not an error
        }
        
        // sim_port (1-4) derived from gsm_span (2-5): sim_port = gsm_span - 1
        const simPort = Math.max(1, Math.min(4, gsm_span - 1));
        
        const stmt = this.db.prepare(`
          INSERT INTO sms_messages 
          (external_id, sender_number, message_content, received_at, sim_port, gsm_span, status, direction, category)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
          external_id || null,
          sender_number,
          message_content,
          received_at || new Date().toISOString(),
          simPort,
          gsm_span,
          status,
          direction,
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
      if (filters.direction) {
        query += ' AND sm.direction = ?';
        params.push(filters.direction);
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
  
  markAllRead() {
    try {
      const stmt = this.db.prepare(`
        UPDATE sms_messages
        SET status = 'read', updated_at = CURRENT_TIMESTAMP
        WHERE status != 'read'
      `);
      const result = stmt.run();
      return result.changes || 0;
    } catch (error) {
      console.error('Error marking all SMS as read:', error.message);
      return 0;
    }
  }
  saveSMSMessage(smsData) {
    try {
      // gsm_span (2-5), sim_port (1-4): sim_port = gsm_span - 1
      const gsm_span = smsData.gsm_span || (smsData.sim_port ? smsData.sim_port + 1 : 2);
      const sim_port = smsData.sim_port || Math.max(1, Math.min(4, gsm_span - 1));
      
      // Validate gsm_span is in valid range
      if (gsm_span < 2 || gsm_span > 5) {
        throw new Error(`Invalid gsm_span: ${gsm_span}. Must be 2-5`);
      }
      
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
      console.error('❌ Error saving SMS message:', error.message);
      console.error('   Data:', { sender: smsData.sender_number, gsm_span: smsData.gsm_span });
      return false;
    }
  }

  saveBulkSMS(messages) {
    try {
      // sim_port (1-4), gsm_span (2-5): sim_port = gsm_span - 1
      const insert = this.db.prepare(`
        INSERT INTO sms_messages (
          sender_number, message_content, sim_port, gsm_span, status, 
          external_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = this.db.transaction((msgs) => {
        for (const msg of msgs) {
          const gsm_span = msg.gsm_span || (msg.sim_port ? msg.sim_port + 1 : 2);
          const sim_port = msg.sim_port || Math.max(1, Math.min(4, gsm_span - 1));
          
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

  // SMS Sent Log methods - prevent duplicate SMS to same number within 24 hours
  hasSentSmsToday(phoneNumber, messageHash = null) {
    try {
      // Check if SMS was sent to this number in the last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      let query = `
        SELECT id FROM sms_sent_log 
        WHERE phone_number = ? AND last_sent_at >= ?
      `;
      const params = [phoneNumber, oneDayAgo];
      
      // If message hash provided, check for exact duplicate
      if (messageHash) {
        query += ` AND message_hash = ?`;
        params.push(messageHash);
      }
      
      const result = this.db.prepare(query).get(...params);
      return result !== undefined;
    } catch (error) {
      console.error('Error checking SMS sent log:', error.message);
      return false;
    }
  }

  logSmsSent(phoneNumber, messageHash = null) {
    try {
      // Check if record exists for this phone number
      const existing = this.db.prepare(
        `SELECT id FROM sms_sent_log WHERE phone_number = ?`
      ).get(phoneNumber);
      
      if (existing) {
        // Update existing record
        this.db.prepare(
          `UPDATE sms_sent_log 
           SET message_hash = ?, last_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
           WHERE phone_number = ?`
        ).run(messageHash || '', phoneNumber);
      } else {
        // Create new record
        this.db.prepare(
          `INSERT INTO sms_sent_log (phone_number, message_hash) VALUES (?, ?)`
        ).run(phoneNumber, messageHash || '');
      }
      
      return true;
    } catch (error) {
      console.error('Error logging SMS sent:', error.message);
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
      
      // Ensure sim_port is within valid range (1-4) or null
      const validPort = (sim_port && sim_port >= 1 && sim_port <= 4) ? sim_port : null;
      
      stmt.run(
        eventType,
        message,
        severity,
        validPort,
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
      
      const stmt = this.db.prepare(`
        SELECT u.*, COALESCE(ur.role, u.role) as effective_role
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.email = ? AND u.password_hash = ? AND u.is_active = 1
        LIMIT 1
      `);
      const user = stmt.get(email, passwordHash);
      
      if (user) {
        // Update last login
        this.db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
        return { success: true, user: { id: user.id, email: user.email, role: user.effective_role, name: user.name } };
      }
      
      return { success: false, error: 'Invalid email or password' };
    } catch (error) {
      console.error('Error authenticating user:', error.message);
      return { success: false, error: error.message };
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

  // Auto-Reply Config methods
  getAutoReplyConfig() {
    try {
      return this.db.prepare('SELECT * FROM auto_reply_config LIMIT 1').get() || null;
    } catch (error) {
      console.error('Error getting auto-reply config:', error.message);
      return null;
    }
  }

  saveAutoReplyConfig({ enabled, message, notification_email }) {
    try {
      const existing = this.db.prepare('SELECT id FROM auto_reply_config LIMIT 1').get();
      if (existing) {
        this.db.prepare(`
          UPDATE auto_reply_config SET enabled = ?, message = ?, notification_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(enabled ? 1 : 0, message, notification_email || null, existing.id);
      } else {
        this.db.prepare(`
          INSERT INTO auto_reply_config (enabled, message, notification_email) VALUES (?, ?, ?)
        `).run(enabled ? 1 : 0, message, notification_email || null);
      }
      return true;
    } catch (error) {
      console.error('Error saving auto-reply config:', error.message);
      return false;
    }
  }

  // Call Auto-SMS Config methods
  getCallAutoSmsConfig() {
    try {
      return this.db.prepare('SELECT * FROM call_auto_sms_config LIMIT 1').get() || null;
    } catch (error) {
      console.error('Error getting call auto-SMS config:', error.message);
      return null;
    }
  }

  saveCallAutoSmsConfig({ enabled, answered_message, missed_message }) {
    try {
      const existing = this.db.prepare('SELECT id FROM call_auto_sms_config LIMIT 1').get();
      if (existing) {
        this.db.prepare(`
          UPDATE call_auto_sms_config SET enabled = ?, answered_message = ?, missed_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(enabled ? 1 : 0, answered_message, missed_message, existing.id);
      } else {
        this.db.prepare(`
          INSERT INTO call_auto_sms_config (enabled, answered_message, missed_message) VALUES (?, ?, ?)
        `).run(enabled ? 1 : 0, answered_message, missed_message);
      }
      return true;
    } catch (error) {
      console.error('Error saving call auto-SMS config:', error.message);
      return false;
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

  // ========== STAFF MANAGEMENT METHODS ==========

  // Agents CRUD
  createAgent(agentData) {
    try {
      const { name, pin, email, phone, extension, telegram_chat_id, notification_channel } = agentData;
      const stmt = this.db.prepare(`
        INSERT INTO agents (name, pin, email, phone, extension, telegram_chat_id, notification_channel)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(name, pin || '0000', email, phone, extension, telegram_chat_id, notification_channel || 'telegram');
      return this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name);
    } catch (error) {
      console.error('Error creating agent:', error.message);
      return null;
    }
  }

  getAgents() {
    try {
      return this.db.prepare('SELECT * FROM agents WHERE is_active = 1 ORDER BY name ASC').all();
    } catch (error) {
      console.error('Error getting agents:', error.message);
      return [];
    }
  }

  getAgentById(agentId) {
    try {
      return this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    } catch (error) {
      console.error('Error getting agent:', error.message);
      return null;
    }
  }

  updateAgent(agentId, agentData) {
    try {
      const { name, email, phone, extension, telegram_chat_id, notification_channel, is_active } = agentData;
      const stmt = this.db.prepare(`
        UPDATE agents 
        SET name = ?, email = ?, phone = ?, extension = ?, telegram_chat_id = ?, notification_channel = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      const result = stmt.run(name, email, phone, extension, telegram_chat_id, notification_channel, is_active, agentId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error updating agent:', error.message);
      return false;
    }
  }

  verifyAgentPin(pin) {
    try {
      return this.db.prepare('SELECT id, name, email, extension FROM agents WHERE pin = ? AND is_active = 1').get(pin);
    } catch (error) {
      console.error('Error verifying PIN:', error.message);
      return null;
    }
  }

  updateAgentPin(agentId, newPin) {
    try {
      const stmt = this.db.prepare('UPDATE agents SET pin = ? WHERE id = ?');
      const result = stmt.run(newPin, agentId);
      return result.changes > 0;

    } catch (error) {
      console.error('Error updating PIN:', error.message);
      return false;
    }
  }

  // Agent Shifts - Clock In/Out
  clockIn(agentId) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO agent_shifts (agent_id, clock_in, status)
        VALUES (?, CURRENT_TIMESTAMP, 'active')
      `);
      const result = stmt.run(agentId);
      return result.changes > 0 ? this.getActiveShift(agentId) : null;
    } catch (error) {
      console.error('Error clocking in:', error.message);
      return null;
    }
  }

  clockOut(agentId) {
    try {
      const stmt = this.db.prepare(`
        UPDATE agent_shifts 
        SET clock_out = CURRENT_TIMESTAMP, status = 'completed'
        WHERE agent_id = ? AND status = 'active'
      `);
      const result = stmt.run(agentId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error clocking out:', error.message);
      return false;
    }
  }

  getActiveShift(agentId) {
    try {
      return this.db.prepare(`
        SELECT s.*, a.name, a.email 
        FROM agent_shifts s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.agent_id = ? AND s.status = 'active'
        ORDER BY s.clock_in DESC LIMIT 1
      `).get(agentId);
    } catch (error) {
      console.error('Error getting active shift:', error.message);
      return null;
    }
  }

  getActiveShifts() {
    try {
      return this.db.prepare(`
        SELECT s.id, s.clock_in, s.agent_id, a.name, a.email, a.extension
        FROM agent_shifts s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.status = 'active'
        ORDER BY s.clock_in DESC
      `).all();
    } catch (error) {
      console.error('Error getting active shifts:', error.message);
      return [];
    }
  }

  getShiftHistory(agentId, days = 30) {
    try {
      return this.db.prepare(`
        SELECT * FROM agent_shifts 
        WHERE agent_id = ? AND DATE(clock_in) >= DATE('now', '-' || ? || ' days')
        ORDER BY clock_in DESC
      `).all(agentId, days);
    } catch (error) {
      console.error('Error getting shift history:', error.message);
      return [];
    }
  }

  // Shift Schedule
  createShiftSchedule(scheduleData) {
    try {
      const { agent_id, shift_date, start_time, end_time, notes } = scheduleData;
      const stmt = this.db.prepare(`
        INSERT INTO shift_schedule (agent_id, shift_date, start_time, end_time, notes)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(agent_id, shift_date, start_time, end_time, notes);
      return true;
    } catch (error) {
      console.error('Error creating shift schedule:', error.message);
      return false;
    }
  }

  getShiftSchedule(agentId, startDate, endDate) {
    try {
      return this.db.prepare(`
        SELECT s.*, a.name FROM shift_schedule s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.agent_id = ? AND s.shift_date BETWEEN ? AND ?
        ORDER BY s.shift_date, s.start_time
      `).all(agentId, startDate, endDate);
    } catch (error) {
      console.error('Error getting shift schedule:', error.message);
      return [];
    }
  }

  getAllSchedules(startDate, endDate) {
    try {
      return this.db.prepare(`
        SELECT s.*, a.name, a.email FROM shift_schedule s
        JOIN agents a ON s.agent_id = a.id
        WHERE s.shift_date BETWEEN ? AND ?
        ORDER BY s.shift_date, s.start_time
      `).all(startDate, endDate);
    } catch (error) {
      console.error('Error getting all schedules:', error.message);
      return [];
    }
  }

  deleteSchedule(scheduleId) {
    try {
      const stmt = this.db.prepare('DELETE FROM shift_schedule WHERE id = ?');
      const result = stmt.run(scheduleId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error deleting schedule:', error.message);
      return false;
    }
  }

  // Shift Swap Requests
  createSwapRequest(swapData) {
    try {
      const { requester_agent_id, requester_shift_id, target_agent_id, target_shift_id, reason } = swapData;
      const stmt = this.db.prepare(`
        INSERT INTO shift_swap_requests (requester_agent_id, requester_shift_id, target_agent_id, target_shift_id, reason)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(requester_agent_id, requester_shift_id, target_agent_id, target_shift_id, reason);
      return true;
    } catch (error) {
      console.error('Error creating swap request:', error.message);
      return false;
    }
  }

  getSwapRequests(status = 'pending') {
    try {
      return this.db.prepare(`
        SELECT sr.*, 
               ra.name as requester_name, ta.name as target_name,
               rs.shift_date as requester_date, ts.shift_date as target_date
        FROM shift_swap_requests sr
        JOIN agents ra ON sr.requester_agent_id = ra.id
        JOIN agents ta ON sr.target_agent_id = ta.id
        LEFT JOIN shift_schedule rs ON sr.requester_shift_id = rs.id
        LEFT JOIN shift_schedule ts ON sr.target_shift_id = ts.id
        WHERE sr.status = ?
        ORDER BY sr.created_at DESC
      `).all(status);
    } catch (error) {
      console.error('Error getting swap requests:', error.message);
      return [];
    }
  }

  approveSwapRequest(swapId, reviewedBy) {
    try {
      const stmt = this.db.prepare(`
        UPDATE shift_swap_requests 
        SET status = 'approved', reviewed_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      const result = stmt.run(reviewedBy, swapId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error approving swap request:', error.message);
      return false;
    }
  }

  rejectSwapRequest(swapId, reviewedBy, reason) {
    try {
      const stmt = this.db.prepare(`
        UPDATE shift_swap_requests 
        SET status = 'rejected', reviewed_by = ?, review_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      const result = stmt.run(reviewedBy, reason, swapId);
      return result.changes > 0;
    } catch (error) {
      console.error('Error rejecting swap request:', error.message);
      return false;
    }
  }

  // Agent Ratings
  rateAgent(ratingData) {
    try {
      const { agent_id, rating, comment, rated_by } = ratingData;
      const stmt = this.db.prepare(`
        INSERT INTO agent_ratings (agent_id, rating, comment, rated_by, rating_date)
        VALUES (?, ?, ?, ?, CURRENT_DATE)
      `);
      stmt.run(agent_id, rating, comment, rated_by);
      return true;
    } catch (error) {
      console.error('Error rating agent:', error.message);
      return false;
    }
  }

  getAgentRatings(agentId) {
    try {
      return this.db.prepare(`
        SELECT * FROM agent_ratings 
        WHERE agent_id = ?
        ORDER BY created_at DESC
      `).all(agentId);
    } catch (error) {
      console.error('Error getting agent ratings:', error.message);
      return [];
    }
  }

  getAgentAverageRating(agentId) {
    try {
      const result = this.db.prepare(`
        SELECT AVG(rating) as avg_rating, COUNT(*) as total_ratings
        FROM agent_ratings 
        WHERE agent_id = ?
      `).get(agentId);
      return result;
    } catch (error) {
      console.error('Error getting average rating:', error.message);
      return { avg_rating: 0, total_ratings: 0 };
    }
  }
}

module.exports = SMSDatabase;
