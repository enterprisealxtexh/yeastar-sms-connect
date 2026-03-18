const path = require('path');
const SMSDatabase = require('./public/local-agent/sqlite-db.cjs');

// Test with the actual database path
const dbPath = '/home/alxtexh/yeastar-sms-connect/public/local-agent/sms.db';
console.log('Creating fresh database instance with path:', dbPath);

const db = new SMSDatabase(dbPath);
const initResult = db.init();
console.log('Init result:', initResult);

// Test table access
try {
  const count = db.db.prepare('SELECT COUNT(*) as count FROM user_roles').get();
  console.log('user_roles table query: SUCCESS, count =', count.count);
} catch(e) {
  console.log('user_roles table query: FAILED -', e.message);
}

// Test authenticateUser with wrong password
console.log('\n--- Test 1: Wrong password ---');
const result1 = db.authenticateUser('admin@nosteq.co.ke', 'wrongpassword');
console.log('Result:', result1);

// Test authenticateUser with the hash as password (simulating what curl sends)
console.log('\n--- Test 2: Hash as password ---');
const result2 = db.authenticateUser('admin@nosteq.co.ke', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9');
console.log('Result:', result2);

// Test authenticateUser with "admin" password
console.log('\n--- Test 3: "admin" password ---');
const result3 = db.authenticateUser('admin@nosteq.co.ke', 'admin');
console.log('Result:', result3);

// Check the actual password hash in the database
console.log('\n--- Actual database state ---');
const userRecord = db.db.prepare('SELECT email, password_hash FROM users WHERE email = ?').get('admin@nosteq.co.ke');
console.log('User record:', userRecord);
