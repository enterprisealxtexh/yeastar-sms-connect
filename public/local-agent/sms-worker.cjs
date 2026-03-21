/**
 * SMS/Email Queue Worker Service
 * Dedicated worker process managed by PM2
 * - Processes pending SMS from queue
 * - Respects extension filters & delivery delays
 * - Handles call-auto-sms (Auto-Reply SMS feature removed)
 * - Non-blocking, scalable, production-ready
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const https = require('https');
const querystring = require('querystring');

// ==== SIMPLE LOGGING ====
const simpleLog = {
  info: (msg) => console.log(`[${new Date().toISOString()}] ✓ ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] ⚠ ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] ✗ ${msg}`),
  debug: (msg) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`[${new Date().toISOString()}] ◇ ${msg}`);
    }
  }
};

// ==== INITIALIZE DATABASE ====
const SMSDatabase = require('./sqlite-db.cjs');
const dbPath = process.env.SMS_DB_PATH || path.join(__dirname, 'sms.db');
const db = new SMSDatabase(dbPath);

simpleLog.info('Initializing SMS Queue Worker...');

if (!db.init()) {
  simpleLog.error('Failed to initialize database - exiting');
  process.exit(1);
}

simpleLog.info('========================================');
simpleLog.info('   SMS/Email Queue Worker Service');
simpleLog.info('========================================');
simpleLog.info(`PID: ${process.pid}`);
simpleLog.info(`Database: ${dbPath}`);

// ==== WORKER STATE ====
const workerState = {
  isProcessing: false,
  lastProcessedAt: null,
  totalProcessed: 0,
  totalFailed: 0,
  totalSkipped: 0,
  lastError: null,
};

// ==== SMS GATEWAY CONFIG ====
const SMS_GATEWAY_CONFIG = {
  url: 'https://sms.techrasystems.com/SMSApi/send',
  userid: 'nosteqltd',
  senderid: 'NOSTEQLTD',
  apikey: 'd5333c2f579ef1115d5984475e6fbecfffa2cdff'
};

// ==== UTILITIES ====

function formatPhoneNumber(number) {
  if (!number) return number;
  // Always strip non-digits first to handle '+254', '(07)', etc.
  const cleaned = String(number).replace(/\D/g, '');
  
  if (cleaned.startsWith('0')) {
    return '254' + cleaned.substring(1);
  }
  
  if (cleaned.startsWith('254')) {
    return cleaned;
  }
  
  // Assume if it's 9 digits (712...) it needs 254
  return '254' + cleaned;
}

function isValidPhoneNumber(number) {
  if (!number) return false;
  
  const digitsOnly = String(number).replace(/\D/g, '');
  
  if (digitsOnly.length < 10) {
    return false;
  }
  
  if (digitsOnly.length > 13) {
    return false;
  }
  
  return true;
}

// ==== SMS SENDING ====

async function sendSmsViaGateway(phoneNumber, messageText) {
  return new Promise((resolve) => {
    try {
      // Check if SMS is globally enabled
      if (!db.isSmsEnabled()) {
        simpleLog.debug('SMS sending is globally disabled - skipping');
        resolve(false);
        return;
      }
      
      if (!phoneNumber || !messageText) {
        simpleLog.warn('SMS: No phone number or message provided');
        resolve(false);
        return;
      }

      // Normalize phone number first for consistent duplicate checking
      const formattedNumber = formatPhoneNumber(phoneNumber).replace(/\D/g, '');

      // Check for recent duplicates (24-hour window)
      if (db.checkRecentSms(formattedNumber, 1440)) {
        simpleLog.debug(`SMS already sent to ${formattedNumber} today - skipping duplicate`);
        try { db.logActivity('sms_duplicate_prevented', `SMS to ${formattedNumber} skipped (duplicate within 24h)`, 'warning'); } catch (e) {}
        resolve(true); // Count as success to avoid retry loop
        return;
      }
      
      simpleLog.info(`📤 Sending SMS to: ${formattedNumber}`);

      try {
        // Use the exact working curl command structure from Techras Systems documentation
        // Escape message properly for shell: single quotes need special handling
        const escapedMsg = messageText.replace(/'/g, "'\\''");

        // Build the curl command on a single line for reliable execution
        // NOTE: --insecure flag added to bypass SSL certificate verification during provider certificate issues
        const curlCommand = `curl -k -L -X POST '${SMS_GATEWAY_CONFIG.url}' -H 'Accept: application/json' -H 'apikey: ${SMS_GATEWAY_CONFIG.apikey}' -H 'Content-Type: application/x-www-form-urlencoded' -H 'Cookie: SERVERID=webC1' -d 'userid=${SMS_GATEWAY_CONFIG.userid}&senderid=${SMS_GATEWAY_CONFIG.senderid}&msgType=text&duplicatecheck=true&sendMethod=quick&msg=${escapedMsg}&mobile=${formattedNumber}'`;

        const response = execSync(curlCommand, {
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024,
          shell: '/bin/bash'
        });

        if (response && response.trim()) {
          simpleLog.info(`✅ SMS sent successfully to ${formattedNumber}`);
          
          // Record successful SMS in database
          try {
            db.insertSMS({
              sender_number: formattedNumber,
              message_content: messageText,
              received_at: new Date().toISOString(),
              status: 'processed',
              direction: 'sent'
            });
          } catch (dbError) {
            simpleLog.warn(`Failed to log SMS to database: ${dbError.message}`);
          }
          
          resolve(true);
        } else {
          simpleLog.warn(`⚠️  SMS gateway returned empty response`);
          resolve(false);
        }
      } catch (execError) {
        simpleLog.error(`❌ SMS sending failed: ${execError.message}`);
        
        // Record failed SMS in database
        try {
          db.insertSMS({
            sender_number: formattedNumber,
            message_content: messageText,
            received_at: new Date().toISOString(),
            status: 'failed',
            direction: 'sent'
          });
        } catch (dbError) {
          simpleLog.warn(`Failed to log failed SMS to database: ${dbError.message}`);
        }
        
        resolve(false);
      }
    } catch (error) {
      simpleLog.error(`SMS wrapper exception: ${error.message}`);
      resolve(false);
    }
  });
}

// ==== QUEUE PROCESSOR ====

async function processSmsQueue() {
  if (workerState.isProcessing) {
    simpleLog.debug('Worker already processing - skipping');
    return;
  }

  workerState.isProcessing = true;
  let processedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  try {
    // Get configurations (Auto-Reply removed, only Call Auto-SMS supported)
    const callAutoSmsConfig = db.getCallAutoSmsConfig ? db.getCallAutoSmsConfig() : null;

    simpleLog.debug(`CallAutoSms enabled: ${callAutoSmsConfig && callAutoSmsConfig.enabled}`);
    
    // Get due items from queue
    const dueItems = db.getDueSmsItems ? db.getDueSmsItems() : [];
    
    if (dueItems.length === 0) {
      simpleLog.debug('No due items to process');
      return;
    }

    simpleLog.info(`Processing ${dueItems.length} due SMS items`);

    // Parse allowed extensions (only Call Auto-SMS)
    let callAutoSmsExtensions = [];
    
    if (callAutoSmsConfig && callAutoSmsConfig.allowed_extensions) {
      try {
        callAutoSmsExtensions = JSON.parse(callAutoSmsConfig.allowed_extensions || '[]');
      } catch (e) {
        simpleLog.warn('Could not parse callAutoSms allowed_extensions');
      }
    }

    for (const item of dueItems) {
      try {
        // Only Call Auto-SMS is supported (Auto-Reply removed)
        const source = 'call_auto_sms';

        // Check if enabled
        const isEnabled = callAutoSmsConfig && callAutoSmsConfig.enabled;

        if (!isEnabled) {
          simpleLog.debug(`Skipping call auto-sms to ${item.caller_number}`);
          try { db.logActivity('call_auto_sms_skipped_disabled', `Call auto-sms disabled - skipping ${item.caller_number}`, 'info'); } catch (e) {}
          if (db.markPendingSmsProcessed) {
            db.markPendingSmsProcessed(item.id, false);
          }
          skippedCount++;
          continue;
        }

        // Validate phone
        if (!isValidPhoneNumber(item.caller_number)) {
          simpleLog.warn(`Invalid phone: ${item.caller_number}`);
          try { db.logActivity('sms_invalid_number', `Invalid phone: ${item.caller_number}`, 'warning'); } catch (e) {}
          if (db.markPendingSmsProcessed) {
            db.markPendingSmsProcessed(item.id, false);
          }
          skippedCount++;
          continue;
        }

        // ✅ CHECK EXTENSION FILTER (only for call-auto-sms)
        const allowedExts = callAutoSmsExtensions;
        if (item.extension && allowedExts.length > 0 && !allowedExts.includes(String(item.extension))) {
          simpleLog.debug(`Extension '${item.extension}' not in filter [${allowedExts.join(', ')}]`);
          try { db.logActivity('call_auto_sms_extension_filtered', `Ext filtered: ${item.caller_number}`, 'info'); } catch (e) {}
          if (db.markPendingSmsProcessed) {
            db.markPendingSmsProcessed(item.id, false);
          }
          skippedCount++;
          continue;
        }

        simpleLog.info(`Processing ${source} to ${item.caller_number}`);

        // Send via gateway
        const success = await sendSmsViaGateway(item.caller_number, item.message);
        
        if (success) {
          simpleLog.info(`✓ ${source} sent successfully`);
          try { db.logActivity(`${source}_sent`, `${source} sent to ${item.caller_number}`, 'success'); } catch (e) {}
          processedCount++;
        } else {
          simpleLog.warn(`✗ ${source} failed`);
          try { db.logActivity(`${source}_failed`, `${source} failed for ${item.caller_number}`, 'error'); } catch (e) {}
          failedCount++;
        }

        // Mark in queue
        if (db.markPendingSmsProcessed) {
          db.markPendingSmsProcessed(item.id, success);
        }

      } catch (itemErr) {
        simpleLog.error(`Exception processing item ${item.id}: ${itemErr.message}`);
        failedCount++;
        
        try {
          if (db.markPendingSmsProcessed) {
            db.markPendingSmsProcessed(item.id, false);
          }
        } catch (e) {}
      }
    }

    // Cleanup old records (older than 7 days)
    try {
      if (db.cleanOldPendingQueue) {
        db.cleanOldPendingQueue(7);
      }
    } catch (cleanErr) {
      simpleLog.warn(`Cleanup failed: ${cleanErr.message}`);
    }

    // Cleanup permanently failed records (more than 3 attempts)
    try {
      if (db.cleanFailedQueue) {
        const cleanedCount = db.cleanFailedQueue();
        if (cleanedCount > 0) {
          simpleLog.info(`Cleaned up ${cleanedCount} permanently failed SMS from queue`);
        }
      }
    } catch (cleanErr) {
      simpleLog.warn(`Failed SMS cleanup failed: ${cleanErr.message}`);
    }

    workerState.lastProcessedAt = new Date().toISOString();
    workerState.totalProcessed += processedCount;
    workerState.totalFailed += failedCount;
    workerState.totalSkipped += skippedCount;
    workerState.lastError = null;

    simpleLog.info(`Complete: ${processedCount} sent, ${failedCount} failed, ${skippedCount} skipped`);

  } catch (error) {
    simpleLog.error(`Queue processing error: ${error.message}`);
    workerState.lastError = error.message;
    try { db.logActivity('worker_error', `Worker error: ${error.message}`, 'error'); } catch (e) {}
  } finally {
    workerState.isProcessing = false;
  }
}

// ==== WORKER LOOP ====

simpleLog.info('Starting worker loop (30 second interval)...');
setInterval(processSmsQueue, 30000);

// Process immediately on startup
setTimeout(processSmsQueue, 2000);

// ==== GRACEFUL SHUTDOWN ====

process.on('SIGTERM', () => {
  simpleLog.info('SIGTERM received - shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  simpleLog.info('SIGINT received - shutting down');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  simpleLog.error(`Uncaught exception: ${err.message}`);
  simpleLog.error(err.stack);
  process.exit(1);
});

simpleLog.info('Worker ready');
