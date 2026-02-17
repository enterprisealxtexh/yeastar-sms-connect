/**
 * Shared SQLite Database Singleton Manager
 * Ensures only ONE database instance is created across all processes
 * Both api-server.cjs and tg400-agent.cjs use this singleton
 */

const path = require('path');
const SMSDatabase = require('./sqlite-db.cjs');

class SharedDatabase {
  static instance = null;
  static instancePath = null;

  static getInstance(dbPath) {
    const normalizedPath = path.resolve(dbPath || process.env.SMS_DB_PATH || path.join(__dirname, 'sms.db'));
    
    // If instance exists and paths match, return it
    if (SharedDatabase.instance && SharedDatabase.instancePath === normalizedPath) {
      return SharedDatabase.instance;
    }
    
    // Create new instance only if path changes or doesn't exist
    if (!SharedDatabase.instance || SharedDatabase.instancePath !== normalizedPath) {
      const logger = require('./logger.cjs');
      logger.debug(`[SharedDB] Creating new database instance: ${normalizedPath}`);
      
      SharedDatabase.instancePath = normalizedPath;
      SharedDatabase.instance = new SMSDatabase(normalizedPath);
      SharedDatabase.instance.init();
    }
    
    return SharedDatabase.instance;
  }

  /**
   * Reset singleton (for testing only)
   */
  static reset() {
    SharedDatabase.instance = null;
    SharedDatabase.instancePath = null;
  }
}

// Export singleton getter
module.exports = SharedDatabase;
