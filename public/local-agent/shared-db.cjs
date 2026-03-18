/**
 * Shared SQLite Database Singleton Manager
 * Ensures only ONE database instance is created across all processes
 */

const path = require('path');
const fs = require('fs');
const SMSDatabase = require('./sqlite-db.cjs');

function initDatabase(dbPath) {
	try {
		const resolvedPath = path.resolve(dbPath);
		const dir = path.dirname(resolvedPath);
		fs.mkdirSync(dir, { recursive: true });

		const instance = new SMSDatabase(resolvedPath);
		const ok = instance.init();
		return ok ? instance : null;
	} catch (error) {
		console.error('Shared DB init failed for path', dbPath, error && error.message ? error.message : error);
		return null;
	}
}

// Try configured path first, then local fallback path.
const configuredPath = process.env.SMS_DB_PATH || path.join(__dirname, 'sms.db');
const fallbackPath = path.join(__dirname, 'sms.db');

let instance = initDatabase(configuredPath);
if (!instance && path.resolve(configuredPath) !== path.resolve(fallbackPath)) {
	instance = initDatabase(fallbackPath);
}

module.exports = instance;
