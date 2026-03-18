// Quick test script to debug login issue
const SharedDatabase = require('./public/local-agent/shared-db.cjs');
const path = require('path');

const dbPath = path.join(__dirname, 'public/local-agent/sms.db');
const db = SharedDatabase.getInstance(dbPath);

if (!db) {
  console.error('Failed to initialize database');
  process.exit(1);
}

console.log('Database initialized successfully');

// Test authenticateUser
const result = db.authenticateUser('admin@nosteq.co.ke', 'wrongpassword');
console.log('authenticateUser result:', result);

// Test direct query with user_roles
try {
  const user = db.db.prepare(`
    SELECT u.*, COALESCE(ur.role, u.role) as effective_role
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    WHERE u.email = ?
    LIMIT 1
  `).get('admin@nosteq.co.ke');
  console.log('Direct query result:', user);
} catch (e) {
  console.error('Direct query failed:', e.message);
}

// Test if user_roles table exists
try {
  const count = db.db.prepare('SELECT COUNT(*) as count FROM user_roles').get().count;
  console.log('user_roles table exists with', count, 'records');
} catch (e) {
  console.error('user_roles check failed:', e.message);
}
