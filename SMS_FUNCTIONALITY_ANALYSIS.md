# Yeastar SMS Functionality - Comprehensive Analysis Report

**Investigation Date**: March 13, 2026  
**Scope**: SMS sending, missed call handling, auto-reply, and TG400 gateway integration

---

## 🔴 CRITICAL FINDING: Missing Backend API Endpoints

### The Problem
The frontend application attempts to call `/api/missed-call-rules` endpoints, but **these endpoints are NOT implemented in the backend API server**, despite the database tables existing.

**Frontend Calls (from [src/hooks/useMissedCallRules.ts](src/hooks/useMissedCallRules.ts))**:
```typescript
// Line 22: GET request
const response = await fetch(`${API_URL}/api/missed-call-rules`);

// Line 36: POST request  
const response = await fetch(`${API_URL}/api/missed-call-rules`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

// Line 65: PUT request
const response = await fetch(`${API_URL}/api/missed-call-rules/${id}`, {
  method: "PUT",
});

// Line 86: DELETE request
const response = await fetch(`${API_URL}/api/missed-call-rules/${id}`, {
  method: "DELETE",
});
```

**Backend Status**: NOT FOUND in [public/local-agent/api-server.cjs](public/local-agent/api-server.cjs)

---

## SMS Architecture & Implementation

### 1. Hardcoded SMS Gateway Configuration

**Location**: [public/local-agent/api-server.cjs](public/local-agent/api-server.cjs#L1532-L1538)

```javascript
// SMS Gateway Service (Hardcoded Credentials)
// ========================================

const SMS_GATEWAY_CONFIG = {
  url: 'https://sms.techrasystems.com/SMSApi/send',
  userid: 'nosteqltd',
  senderid: 'NOSTEQLTD',
  apikey: 'd5333c2f579ef1115d5984475e6fbecfffa2cdff'
};
```

**⚠️ Issues**:
- Credentials hardcoded in source code (security risk)
- Only one gateway supported at runtime, despite database schema supporting multiple
- Credentials exposed in version control
- No way to switch gateways without code changes

---

### 2. Main SMS Sending Function: `sendSmsViaGateway()`

**Location**: [public/local-agent/api-server.cjs](public/local-agent/api-server.cjs#L1543-L1590)

```javascript
async function sendSmsViaGateway(phoneNumberOrNumbers, messageText) {
  try {
    const numbers = Array.isArray(phoneNumberOrNumbers) ? phoneNumberOrNumbers : [phoneNumberOrNumbers];
    
    if (!numbers || numbers.length === 0 || !messageText) {
      logger.warn('SMS sending: No phone numbers or message provided');
      return false;
    }

    const mobileParam = numbers.map(n => n.trim()).join(',');
    
    logger.info(`📤 Sending SMS via gateway to: ${mobileParam}`);
    logger.info(`   Message: ${messageText.substring(0, 80)}...`);

    try {
      const { execSync } = require('child_process');
      const escapedMsg = messageText.replace(/'/g, "'\\'");
      
      const curlCommand = `curl -X POST '${SMS_GATEWAY_CONFIG.url}' \
-H 'Accept: application/json' \
-H 'apikey: ${SMS_GATEWAY_CONFIG.apikey}' \
-H 'Content-Type: application/x-www-form-urlencoded' \
-H 'Cookie: SERVERID=webC1' \
-d 'userid=${SMS_GATEWAY_CONFIG.userid}&senderid=${SMS_GATEWAY_CONFIG.senderid}&msgType=text&duplicatecheck=true&sendMethod=quick&msg=${escapedMsg}&mobile=${mobileParam}'`;

      const response = execSync(curlCommand, { 
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash' 
      });

      if (response && response.trim()) {
        logger.info(`✅ SMS sent successfully to ${numbers.length} recipient(s)`);
        return true;
      } else {
        logger.warn(`SMS gateway empty response`);
        return false;
      }
    } catch (execError) {
      logger.error(`SMS sending failed: ${execError.message}`);
      return false;
    }
  } catch (error) {
    logger.error(`SMS sending exception: ${error.message}`);
    return false;
  }
}
```

**Gateway Parameters**:
- `userid=nosteqltd`
- `senderid=NOSTEQLTD`
- `msgType=text`
- `duplicatecheck=true`
- `sendMethod=quick`
- `msg={escaped_message}`
- `mobile={phone_numbers_comma_separated}`

**⚠️ Issues**:
- Uses shell execution with `execSync()` - security risk
- Message escaping is basic (only escapes single quotes)
- Response validation only checks if non-empty (insufficient)
- No retry logic
- 30-second timeout may be too short or too long
- Does not use TG400 TCP API (which exists but is unused)

---

### 3. SMS Report Variant: `sendSmsReport()`

**Location**: [public/local-agent/api-server.cjs](public/local-agent/api-server.cjs#L1592-L1680)

Similar implementation to `sendSmsViaGateway()` with:
- Enhanced logging
- Database activity logging
- Better error handling with stderr/stdout capture

```javascript
const escapedMsg = messageText.replace(/'/g, "'\\''");  // Different escape pattern

const response = execSync(curlCommand, { 
  encoding: 'utf-8',
  timeout: 30000,
  maxBuffer: 10 * 1024 * 1024,
  shell: '/bin/bash' 
});

logger.info(`SMS Gateway Response: ${response}`);

if (response && response.trim()) {
  logger.info(`SMS sent successfully to ${numbers.length} recipient(s): ${mobileParam}`);
  db.logActivity('sms_report_sent', `SMS sent to ${mobileParam}`, 'success');
  return true;
}
```

---

## SMS Triggering Flows

### Flow 1: Call Auto-SMS (Answered & Missed Calls)

**Function**: `sendCallAutoSms()` [api-server.cjs](public/local-agent/api-server.cjs#L1187-L1241)

**Trigger Point**: Called in `syncCallRecords()` [api-server.cjs](public/local-agent/api-server.cjs#L1069-L1078)

```javascript
if (db.saveCallRecord(callRecord)) {
  savedCount++;
  
  // EVENT-DRIVEN: Send missed call alert and auto-SMS immediately when saved
  if (['missed', 'no-answer', 'noanswer', 'failed'].includes(callRecord.status)) {
    await sendMissedCallAlert(callRecord);
    await sendCallAutoSms(callRecord);
  } else if (['answered', 'connected'].includes(callRecord.status)) {
    // Send auto-SMS for answered calls
    await sendCallAutoSms(callRecord);
  }
}
```

**Implementation**:

```javascript
async function sendCallAutoSms(callRecord) {
  try {
    const callAutoSmsConfig = db.getCallAutoSmsConfig ? db.getCallAutoSmsConfig() : null;
    
    // Check if call auto-SMS is enabled
    if (!callAutoSmsConfig?.enabled) {
      logger.debug(' Call auto-SMS disabled - skipping');
      return false;
    }

    const callerNumber = callRecord.caller_number;
    if (!callerNumber) {
      logger.warn('Call auto-SMS: No caller number provided');
      return false;
    }

    // Determine message based on call status
    let messageTemplate;
    if (['missed', 'no-answer', 'noanswer', 'failed'].includes(callRecord.status)) {
      messageTemplate = callAutoSmsConfig.missed_message;
      logger.info(`📞 Sending missed call auto-SMS to: ${callerNumber}`);
    } else if (['answered', 'connected'].includes(callRecord.status)) {
      messageTemplate = callAutoSmsConfig.answered_message;
      logger.info(`☎️ Sending answered call auto-SMS to: ${callerNumber}`);
    } else {
      logger.debug(` Call auto-SMS: Status '${callRecord.status}' not matched for sending`);
      return false;
    }

    if (!messageTemplate) {
      logger.warn('Call auto-SMS: No message template available');
      return false;
    }

    // Replace template variables
    let message = messageTemplate
      .replace(/\{caller_name\}/g, callRecord.caller_name || callRecord.caller_number)
      .replace(/\{caller_number\}/g, callerNumber)
      .replace(/\{extension\}/g, callRecord.extension || 'N/A')
      .replace(/\{time\}/g, new Date(callRecord.start_time).toLocaleTimeString('en-KE'))
      .replace(/\{date\}/g, new Date(callRecord.start_time).toLocaleDateString('en-KE'))
      .replace(/\{duration\}/g, `${callRecord.talk_duration || 0}s`);

    logger.info(`   Message: ${message.substring(0, 80)}...`);
    
    const success = await sendSmsViaGateway(callerNumber, message);
    
    if (success) {
      logger.info(`✅ Call auto-SMS sent to ${callerNumber}`);
      db.logActivity('call_auto_sms_sent', `Call auto-SMS sent to ${callerNumber}`, 'success');
    } else {
      logger.error(`❌ Call auto-SMS failed for ${callerNumber}`);
      db.logActivity('call_auto_sms_failed', `Call auto-SMS failed for ${callerNumber}`, 'error');
    }
    
    return success;
  } catch (error) {
    logger.error(`Call auto-SMS exception: ${error.message}`);
    return false;
  }
}
```

**Template Variables Supported**:
- `{caller_name}` - Name of the caller
- `{caller_number}` - Phone number of the caller
- `{extension}` - Extension that received the call
- `{time}` - Time of call (Kenya timezone)
- `{date}` - Date of call (Kenya timezone)
- `{duration}` - How long the call rang

**API Configuration**: POST `/api/call-auto-sms-config` [api-server.cjs](public/local-agent/api-server.cjs#L4330-4344)

---

### Flow 2: Received SMS Auto-Reply

**Function**: `sendAutoReplySms()` [api-server.cjs](public/local-agent/api-server.cjs#L1147-L1178)

**Trigger Point**: When SMS is received from TG400 [api-server.cjs](public/local-agent/api-server.cjs#L2001)

```javascript
tg400Api.on('sms-received', async (sms) => {
  // ... validation and logging ...
  
  // EVENT-DRIVEN: Send auto-reply SMS if enabled
  await sendAutoReplySms(sms.sender_number);
});
```

**Implementation**:

```javascript
async function sendAutoReplySms(senderNumber) {
  try {
    const autoReplyConfig = db.getAutoReplyConfig ? db.getAutoReplyConfig() : null;
    
    // Check if auto-reply is enabled
    if (!autoReplyConfig?.enabled) {
      logger.debug(' Auto-reply disabled - skipping');
      return false;
    }

    if (!senderNumber || !autoReplyConfig.message) {
      logger.warn('Auto-reply: Missing phone number or message');
      return false;
    }

    logger.info(`📧 Sending auto-reply to: ${senderNumber}`);
    logger.info(`   Message: ${autoReplyConfig.message.substring(0, 80)}...`);
    
    const success = await sendSmsViaGateway(senderNumber, autoReplyConfig.message);
    
    if (success) {
      logger.info(`✅ Auto-reply SMS sent to ${senderNumber}`);
      db.logActivity('auto_reply_sms_sent', `Auto-reply sent to ${senderNumber}`, 'success');
    } else {
      logger.error(`❌ Auto-reply SMS failed for ${senderNumber}`);
      db.logActivity('auto_reply_sms_failed', `Auto-reply failed for ${senderNumber}`, 'error');
    }
    
    return success;
  } catch (error) {
    logger.error(`Auto-reply exception: ${error.message}`);
    return false;
  }
}
```

**API Configuration**: 
- GET `/api/auto-reply-config` [api-server.cjs](public/local-agent/api-server.cjs#L4288)
- POST `/api/auto-reply-config` [api-server.cjs](public/local-agent/api-server.cjs#L4297)

**Database**: [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs#L396-L407)

---

### Flow 3: Missed Call Telegram Alerts (NOT SMS)

**Function**: `sendMissedCallAlert()` [api-server.cjs](public/local-agent/api-server.cjs#L1253-L1381)

**Note**: This sends Telegram alerts, NOT SMS, but is part of the missed call notification system.

**Trigger Point**: When missed call is saved [api-server.cjs](public/local-agent/api-server.cjs#L1072)

**Key Features**:
- Event-driven (no polling)
- Uses alert checkpoint to prevent duplicates
- Queue-based processing with 300ms delay between alerts [api-server.cjs](public/local-agent/api-server.cjs#L1112)
- Formats with Nairobi timezone

**Queue Implementation**:

```javascript
const missedCallAlertQueue = [];
let isSendingMissedCallAlert = false;
const MISSED_CALL_DELAY_MS = 300; // 300ms delay between missed call sends (prevents rate limiting)

async function processMissedCallQueue() {
  if (isSendingMissedCallAlert || missedCallAlertQueue.length === 0) {
    return;
  }

  isSendingMissedCallAlert = true;

  while (missedCallAlertQueue.length > 0) {
    const item = missedCallAlertQueue.shift();
    
    try {
      await item.fn();
    } catch (error) {
      logger.error(`Queue processing error: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, MISSED_CALL_DELAY_MS));
  }
  
  isSendingMissedCallAlert = false;

  if (missedCallAlertQueue.length > 0) {
    processMissedCallQueue();
  }
}
```

---

## Missed Call Rules Feature

### Database Design

**Tables**: [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs#L332-L362)

```sql
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

CREATE TABLE IF NOT EXISTS missed_call_rule_calls (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  rule_id TEXT NOT NULL,
  caller_number TEXT NOT NULL,
  call_count INTEGER DEFAULT 1,
  last_call_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rule_id) REFERENCES missed_call_rules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_missed_call_active ON missed_call_rules(active);
```

### Frontend Component

**Location**: [src/components/MissedCallRulesTab.tsx](src/components/MissedCallRulesTab.tsx)

The UI allows:
- Creating rules with extension(s), threshold, template, and gateway
- Displaying active rules
- Deleting rules

**Rule Configuration**:
- **Extensions**: Select one or more extensions that trigger the rule
- **Threshold**: Number of missed calls before SMS is sent (default: 3)
- **Template**: SMS message template to use
- **Gateway**: Which SMS gateway to send through
- **Active**: Enable/disable the rule

### Missing Backend Implementation

**Required Endpoints** (NOT IMPLEMENTED):

1. **GET `/api/missed-call-rules`**
   - Should return all rules with their configuration
   
2. **POST `/api/missed-call-rules`**
   - Should create a new rule
   - Expected body:
     ```json
     {
       "extensions": ["101", "102"],
       "threshold": 3,
       "template_id": "template-uuid",
       "gateway_id": "gateway-uuid",
       "active": true
     }
     ```

3. **PUT `/api/missed-call-rules/{id}`**
   - Should update an existing rule

4. **DELETE `/api/missed-call-rules/{id}`**
   - Should delete a rule

---

## TG400 TCP API SMS Methods

**Location**: [public/local-agent/tg400-tcp-api.cjs](public/local-agent/tg400-tcp-api.cjs#L489-L530)

```javascript
async sendSms(port, destination, message, id) {
  // URL encode the message if it contains special characters
  let encodedMessage = message;
  try {
    // Check if message needs encoding
    if (/[^\x00-\x7F]/.test(message) || /[\r\n"\\]/.test(message)) {
      encodedMessage = encodeURIComponent(message);
    }
  } catch (e) {
    encodedMessage = encodeURIComponent(message);
  }

  const command = `Action: smscommand\r\ncommand: gsm send sms ${port + 1} ${destination} "${encodedMessage}" ${id}\r\n\r\n`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error(`SMS send timeout for ${id}`));
    }, 30000);

    this.pendingRequests.set(id, (status) => {
      clearTimeout(timeout);
      resolve(status);
    });

    try {
      this.sendCommand(command);
    } catch (error) {
      this.pendingRequests.delete(id);
      clearTimeout(timeout);
      reject(error);
    }
  });
}
```

**Protocol**: TCP/AMI (Asterisk Manager Interface) formatted command

**Message Encoding**:
- Detects non-ASCII characters: `/[^\x00-\x7F]/`
- Detects special characters: `/[\r\n"\\]/`
- URL encodes if needed: `encodeURIComponent()`

**⚠️ Issue**: This method exists but is NEVER CALLED by the SMS sending logic. The application uses HTTP curl to an external gateway instead.

---

## SMS Templates Management

### API Endpoints Implemented

1. **GET `/api/sms-templates`** [api-server.cjs](public/local-agent/api-server.cjs#L4220)
   - Returns all SMS templates

2. **POST `/api/sms-templates`** [api-server.cjs](public/local-agent/api-server.cjs#L4229)
   - Create new template with `name` and `message`

3. **PUT `/api/sms-templates/:id`** [api-server.cjs](public/local-agent/api-server.cjs#L4247)
   - Update template

4. **DELETE `/api/sms-templates/:id`** [api-server.cjs](public/local-agent/api-server.cjs#L4266)
   - Delete template (requires admin role)

### Database Table

**Location**: [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs#L320-L327)

```sql
CREATE TABLE IF NOT EXISTS sms_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## SMS Gateways Management

### Database Table

**Location**: [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs#L309-L318)

```sql
CREATE TABLE IF NOT EXISTS sms_gateways (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url TEXT NOT NULL,
  active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### API Implementation

**Partial Implementation**:

- **POST `/api/sms-gateway-url`** [api-server.cjs](public/local-agent/api-server.cjs#L3141)
  - Only saves a single gateway URL
  - Function: [sqlite-db.cjs](public/local-agent/sqlite-db.cjs#L1573)
  
  ```javascript
  saveSmsGatewayUrl(url) {
    try {
      const existing = this.db.prepare('SELECT id FROM sms_gateways WHERE url = ?').get(url);
      if (!existing) {
        this.db.prepare(`
          INSERT INTO sms_gateways (url, active, created_at, updated_at)
          VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(url);
      }
      return true;
    } catch (error) {
      // ...
    }
  }
  ```

**Missing Endpoints**:
- GET `/api/sms-gateways` (list all)
- PUT `/api/sms-gateways/:id` (update)
- DELETE `/api/sms-gateways/:id` (delete)
- POST `/api/sms-gateways` (create)

### Frontend Expectation

[src/hooks/useSmsGateways.ts](src/hooks/useSmsGateways.ts) expects CRUD endpoints that don't exist.

---

## Test/Debug Endpoints

### Missed Call Testing

**POST `/api/test-missed-call-alert`** [api-server.cjs](public/local-agent/api-server.cjs#L5366)
- Creates a test missed call record
- Sends test TG400 alert

**POST `/api/debug/inject-missed-call`** [api-server.cjs](public/local-agent/api-server.cjs#L5716)
- Injects a missed call for testing

**GET `/api/debug/missed-calls`** [api-server.cjs](public/local-agent/api-server.cjs#L5552)
- Lists all missed calls in database

**POST `/api/debug/reset-notifications`** [api-server.cjs](public/local-agent/api-server.cjs#L5760)
- Clears notification tracking and forces re-send

### SMS Testing

**POST `/api/sms-report-test`** [api-server.cjs](public/local-agent/api-server.cjs#L4346)
- Sends a test SMS to a phone number
- Uses: `sendSmsReport()` function

**POST `/api/test-sms-gateway`** [api-server.cjs](public/local-agent/api-server.cjs#L3166)
- Tests gateway URL connectivity

---

## Database Methods for SMS Configuration

### Auto-Reply Config

**Location**: [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs#L2358-L2385)

```javascript
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
        UPDATE auto_reply_config SET enabled = ?, message = ?, 
        notification_email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(!!enabled, message, notification_email, existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO auto_reply_config (enabled, message, notification_email) 
        VALUES (?, ?, ?)
      `).run(!!enabled, message, notification_email);
    }
    return true;
  } catch (error) {
    console.error('Error saving auto-reply config:', error.message);
    return false;
  }
}
```

### Call Auto-SMS Config

**Location**: [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs) (search for `getCallAutoSmsConfig`)

Similar structure with `answered_message` and `missed_message` fields.

---

## Summary of Issues & Recommendations

### 🔴 Critical Issues

1. **Missing Backend API Endpoints**
   - `/api/missed-call-rules` CRUD endpoints completely missing
   - `/api/sms-gateways` incomplete (only partial URL storage)
   - Frontend will fail when trying to manage missed call rules

2. **Hardcoded Gateway Credentials**
   - Credentials in plain code, exposed in version control
   - No way to use different gateways without code changes

### 🟡 Medium Priority Issues

3. **Shell Execution Security Risk**
   - Using `execSync()` with curl is a security vulnerability
   - Message escaping may not cover all edge cases

4. **Poor Error Handling**
   - Response validation only checks if non-empty
   - No retry logic for failed sends
   - No informative error messages

5. **Unused Code**
   - TG400 TCP API `sendSms()` method exists but is never called
   - Application uses external HTTP gateway instead

### 🟢 Lower Priority Issues

6. **Performance**
   - No async pooling for multiple SMS
   - Shell execution is slower than direct HTTP

7. **Testing**
   - Multiple debug endpoints that should be removed in production
   - Test SMS endpoints hardcoded to test values

---

## How SMS Currently Flows (Working Paths)

### Path 1: Incoming Call → Auto-SMS Response
1. Call sync from PBX → saved to database
2. `sendCallAutoSms()` triggered with call record
3. Message template with substitutions applied
4. `sendSmsViaGateway()` called with curl
5. SMS sent via Techrastems HTTP gateway

### Path 2: Incoming SMS → Auto-Reply
1. TG400 TCP API receives SMS
2. `sms-received` event emitted
3. `sendAutoReplySms()` triggered
4. Configured message sent via gateway
5. Activity logged

### Path 3: Incoming Call → Telegram Alert
1. Missed call saved to database
2. `sendMissedCallAlert()` triggered
3. Message queued with 300ms delay
4. Telegram bot API called
5. Alert sent to Telegram chat

---

## Files Summary

### Backend
- [public/local-agent/api-server.cjs](public/local-agent/api-server.cjs) - Main API (6000+ lines)
- [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs) - Database methods
- [public/local-agent/tg400-tcp-api.cjs](public/local-agent/tg400-tcp-api.cjs) - TG400 conn

### Frontend  
- [src/components/MissedCallRulesTab.tsx](src/components/MissedCallRulesTab.tsx) - Rules UI
- [src/components/AutoReplyPanel.tsx](src/components/AutoReplyPanel.tsx) - Auto-reply config
- [src/hooks/useMissedCallRules.ts](src/hooks/useMissedCallRules.ts) - Rules API calls
- [src/hooks/useSmsGateways.ts](src/hooks/useSmsGateways.ts) - Gateway API calls
- [src/hooks/useAutoReplyConfig.ts](src/hooks/useAutoReplyConfig.ts) - Auto-reply API calls

---

## Recommendations for Fix

### Immediate (Critical)
1. Implement `/api/missed-call-rules` CRUD endpoints
2. Move gateway credentials to environment variables
3. Implement gateway CRUD endpoints

### Near-term (Important)
4. Replace shell execution with direct HTTP client
5. Improve error handling and response validation
6. Add retry logic for failed SMS

### Long-term (Nice-to-have)
7. Remove test/debug endpoints from production
8. Implement proper request queuing
9. Add SMS delivery confirmations
10. Implement actual missed call rule processing logic

