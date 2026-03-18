/**
 * Shared SQLite Database Singleton Manager
 * Ensures only ONE database instance is created across all processes
 */

const path = require('path');
const SMSDatabase = require('./sqlite-db.cjs');

// Initialize database once at module load time — path resolved relative to __dirname
const dbPath = path.resolve(process.env.SMS_DB_PATH || path.join(__dirname, 'sms.db'));

const instance = new SMSDatabase(dbPath);
instance.init();

module.exports = instance;
