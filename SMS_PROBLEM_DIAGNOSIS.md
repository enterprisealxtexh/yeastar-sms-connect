# SMS Functionality - Problem Diagnosis & Implementation Status

## 🔴 CRITICAL ISSUE: API Implementation Gap

### The Problem Statement
The frontend application has a **Missed Call Rules** feature that allows users to:
1. Create rules that trigger when specific extensions receive N missed calls
2. Configure SMS to be sent to a number when the threshold is reached
3. Select which template and gateway to use

**However**: The backend API endpoints to MANAGE these rules do NOT EXIST.

### Evidence

**Frontend Calls** (from [src/hooks/useMissedCallRules.ts](src/hooks/useMissedCallRules.ts)):
- **Line 22**: `fetch(\`${API_URL}/api/missed-call-rules\`)`  - Reading rules
- **Line 36**: `fetch(\`${API_URL}/api/missed-call-rules\`, { method: "POST" })` - Creating rules
- **Line 65**: `fetch(\`${API_URL}/api/missed-call-rules/${id}\`, { method: "PUT" })` - Updating rules
- **Line 86**: `fetch(\`${API_URL}/api/missed-call-rules/${id}\`, { method: "DELETE" })` - Deleting rules

**Backend Status**: Search the entire [public/local-agent/api-server.cjs](public/local-agent/api-server.cjs) for `/api/missed-call-rules`

**Result**: ❌ ZERO matches for these endpoints

### Database Tables Exist But Unused

**Tables Created** (from [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs)):
- `missed_call_rules` (line 332)
- `missed_call_rule_calls` (line 346)

**But**: No code reads from or writes to these tables in the API layer.

### User Impact

When a user tries to:
- ✅ Create a rule → Click "New Rule" → Frontend sends POST to non-existent endpoint → **FAILS**
- ✅ Edit a rule → Click "Edit" → Frontend sends PUT to non-existent endpoint → **FAILS**
- ✅ Delete a rule → Click "Delete" → Frontend sends DELETE to non-existent endpoint → **FAILS**
- ✅ View existing rules → Page loads → Frontend sends GET to non-existent endpoint → **FAILS** (shows empty)

---

## 🟡 PARTIALLY BROKEN: SMS Gateway Management API

### What Works
- **POST `/api/sms-gateway-url`** [api-server.cjs line 3141](public/local-agent/api-server.cjs#L3141)
  - Can save ONE gateway URL to database
  - Function: [sqlite-db.cjs](public/local-agent/sqlite-db.cjs#L1573) `saveSmsGatewayUrl()`

### What's Missing
- **GET `/api/sms-gateways`** - List all gateways
- **POST `/api/sms-gateways`** - Create new gateway 
- **PUT `/api/sms-gateways/{id}`** - Update gateway
- **DELETE `/api/sms-gateways/{id}`** - Delete gateway

### Impact
- Frontend ([src/hooks/useSmsGateways.ts](src/hooks/useSmsGateways.ts)) expects full CRUD
- Can't manage multiple gateways through UI
- Dropdown for gateway selection in Missed Call Rules will always be empty

---

## ✅ WORKING: Current SMS Sending Methods

### Path 1: Call Auto-SMS (Answered/Missed Calls)

**Mechanism**: Automatic SMS sent when a call completes

**Code Flow**:
```
1. syncCallRecords() [line 1061]
   ↓
2. Call saved to database
   ↓
3. Check status: 'missed', 'no-answer', 'noanswer', 'failed' 
   ↓
4. sendCallAutoSms(callRecord) [line 1187]
   ↓
5. Load config: callAutoSmsConfig from database
   ↓
6. Substitute template variables (caller_number, date, time, duration)
   ↓
7. sendSmsViaGateway(callerNumber, message) [line 1231]
   ↓
8. HTTP POST via curl to Techrastems gateway
   ↓
9. Log activity
```

**Configuration**: POST `/api/call-auto-sms-config` [line 4330](public/local-agent/api-server.cjs#L4330)

**Example Config**:
```json
{
  "enabled": true,
  "answered_message": "Thanks for calling. {caller_name} spoke at {time}.",
  "missed_message": "We missed your call, {caller_number}! Please call back at {time}."
}
```

**Status**: ✅ FULLY WORKING

---

### Path 2: Incoming SMS Auto-Reply

**Mechanism**: Automatic response when someone texts the gateway

**Code Flow**:
```
1. TG400 TCP API receives SMS [line 1943]
   ↓
2. Emits 'sms-received' event
   ↓
3. Event handler called [line 2001]
   ↓
4. sendAutoReplySms(senderNumber) [line 1147]
   ↓
5. Load config: autoReplyConfig.message
   ↓
6. sendSmsViaGateway(senderNumber, message) [line 1165]
   ↓
7. HTTP POST via curl to gateway
   ↓
8. Log activity
```

**Configuration**: POST `/api/auto-reply-config` [line 4297](public/local-agent/api-server.cjs#L4297)

**Example Config**:
```json
{
  "enabled": true,
  "message": "Thanks for messaging us! We'll respond shortly.",
  "notification_email": "admin@company.com"
}
```

**Status**: ✅ FULLY WORKING

---

### Path 3: SMS Gateway (Hardcoded but Functional)

**SMS Sending Implementation**: [api-server.cjs lines 1543-1590](public/local-agent/api-server.cjs#L1543-L1590)

**Current Gateway**:
```javascript
const SMS_GATEWAY_CONFIG = {
  url: 'https://sms.techrasystems.com/SMSApi/send',
  userid: 'nosteqltd',
  senderid: 'NOSTEQLTD',
  apikey: 'd5333c2f579ef1115d5984475e6fbecfffa2cdff'
};
```

**How It Works**:
1. Takes phone number(s) and message text
2. Escapes message with single-quote escaping
3. Builds curl command with parameters:
   - `userid=nosteqltd`
   - `senderid=NOSTEQLTD` (sender name/ID)
   - `msgType=text`
   - `duplicatecheck=true`
   - `sendMethod=quick`
   - `msg={escaped_message}`
   - `mobile={comma_separated_numbers}`

4. Executes curl command synchronously
5. Returns true if response is non-empty

**Example Execution**:
```bash
curl -X POST 'https://sms.techrasystems.com/SMSApi/send' \
  -H 'Accept: application/json' \
  -H 'apikey: d5333c2f579ef1115d5984475e6fbecfffa2cdff' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Cookie: SERVERID=webC1' \
  -d 'userid=nosteqltd&senderid=NOSTEQLTD&msgType=text&duplicatecheck=true&sendMethod=quick&msg=Hello%20World&mobile=254712345678'
```

**Issues**:
- ⚠️ Credentials hardcoded in code
- ⚠️ Uses shell execution with execSync
- ⚠️ Basic message escaping may not handle all characters
- ⚠️ No retry logic
- ⚠️ No connection pooling
- ⚠️ Only validates response is non-empty (poor validation)

**Status**: ✅ WORKING but INSECURE

---

## 🤔 Confusing Architecture

### TG400 TCP API SMS Method Exists But Unused

**Location**: [public/local-agent/tg400-tcp-api.cjs](public/local-agent/tg400-tcp-api.cjs#L489-L530)

```javascript
async sendSms(port, destination, message, id) {
  // URL encode the message if it contains special characters
  let encodedMessage = message;
  try {
    if (/[^\x00-\x7F]/.test(message) || /[\r\n"\\]/.test(message)) {
      encodedMessage = encodeURIComponent(message);
    }
  } catch (e) {
    encodedMessage = encodeURIComponent(message);
  }

  const command = `Action: smscommand\r\ncommand: gsm send sms ${port + 1} ${destination} "${encodedMessage}" ${id}\r\n\r\n`;
  // ... sends via TCP/AMI ...
}
```

**This Method**:
- Can send SMS directly through the TG400 device
- Would be more efficient than HTTP gateway
- Uses proper URL encoding for special characters
- Has timeout and request tracking

**Why It's Not Used**:
1. Application was probably modified to use external HTTP gateway
2. TG400 method remains in code but is never called
3. No HTTP fallback if gateway is down
4. Adds unnecessary complexity

**Impact**: 
- Application is dependent on external Techrastems service
- No local fallback SMS sending capability
- More complexity than needed

---

## Summary Table: What Works vs. What Doesn't

| Feature | Implemented | Working | Tested | Issues |
|---------|-------------|---------|--------|--------|
| Call Auto-SMS | ✅ Full | ✅ Yes | ✅ Yes | Hardcoded gateway |
| Incoming SMS Auto-Reply | ✅ Full | ✅ Yes | ✅ Yes | Hardcoded gateway |
| SMS Templates CRUD | ✅ Full | ✅ Yes | ✅ Yes | None |
| Missed Call Rules CRUD | ✅ DB Only | ❌ No | ❌ No | NO API ENDPOINTS |
| SMS Gateways CRUD | ⚠️ Partial | ⚠️ Partial | ❌ No | Missing 4/5 endpoints |
| SMS Sending (HTTP) | ✅ Full | ✅ Yes | ✅ Yes | Security/Architecture |
| SMS Sending (TG400) | ✅ Code | ❌ Unused | ❌ No | Never called |
| Telegram Alerts | ✅ Full | ✅ Yes | ✅ Yes | Not SMS but related |

---

## Implementation Specification: What's Needed

### To Make Missed Call Rules Work

You need to implement these 4 API endpoints in [api-server.cjs](public/local-agent/api-server.cjs):

#### 1. GET /api/missed-call-rules
```javascript
app.get('/api/missed-call-rules', (req, res) => {
  try {
    const rules = db.getMissedCallRules(); // Need DB method
    res.json({ success: true, data: rules });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

#### 2. POST /api/missed-call-rules
```javascript
app.post('/api/missed-call-rules', (req, res) => {
  try {
    const { extensions, threshold, template_id, gateway_id, active } = req.body;
    const success = db.createMissedCallRule({ 
      extensions, 
      threshold, 
      template_id, 
      gateway_id, 
      active 
    });
    if (success) {
      res.json({ success: true, message: 'Rule created' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to create rule' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

#### 3. PUT /api/missed-call-rules/:id
```javascript
app.put('/api/missed-call-rules/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { extensions, threshold, template_id, gateway_id, active } = req.body;
    const success = db.updateMissedCallRule(id, {
      extensions,
      threshold,
      template_id,
      gateway_id,
      active
    });
    if (success) {
      res.json({ success: true, message: 'Rule updated' });
    } else {
      res.status(404).json({ success: false, error: 'Rule not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

#### 4. DELETE /api/missed-call-rules/:id
```javascript
app.delete('/api/missed-call-rules/:id', (req, res) => {
  try {
    const { id } = req.params;
    const success = db.deleteMissedCallRule(id);
    if (success) {
      res.json({ success: true, message: 'Rule deleted' });
    } else {
      res.status(404).json({ success: false, error: 'Rule not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### To Make SMS Gateways CRUD Work

Add these endpoints (or enhance the existing one):

```javascript
// GET all gateways
app.get('/api/sms-gateways', (req, res) => {
  try {
    const gateways = db.getSmsGateways();
    res.json({ success: true, data: gateways });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST new gateway
app.post('/api/sms-gateways', (req, res) => {
  try {
    const { url } = req.body;
    const success = db.saveSmsGateway({ url, active: true });
    res.json({ success: true, message: 'Gateway created' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update gateway
app.put('/api/sms-gateways/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { url, active } = req.body;
    const success = db.updateSmsGateway(id, { url, active });
    res.json({ success: true, message: 'Gateway updated' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE gateway
app.delete('/api/sms-gateways/:id', (req, res) => {
  try {
    const { id } = req.params;
    const success = db.deleteSmsGateway(id);
    res.json({ success: true, message: 'Gateway deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### To Process Missed Call Rules

You'd also need logic to:

1. **Track missed calls per extension/number**
   - Count consecutive missed calls from same number
   - Reset counter when they call back

2. **Check rules on each missed call**
   - Load all active rules
   - Check if extensions match
   - Increment call count
   - If threshold reached: trigger SMS

3. **Send SMS using configured gateway and template**
   - Load template from database
   - Substitute any variables
   - Use the configured gateway (currently hardcoded)
   - Log the result

**This logic does NOT currently exist in the codebase.**

---

## Current SMS Sending: Why It Works Without Rules

The system currently sends SMS for:
1. **Every answered/missed call** via auto-SMS (not conditional)
2. **Every incoming SMS** with auto-reply

It does NOT:
- Check for thresholds
- Count missed calls from a number
- Require rule configuration
- Select specific gateways

This is why auto-SMS works even though rules don't exist - it's unconditional.

