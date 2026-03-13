# SMS Functionality - Quick Reference Guide

## Critical Missing Endpoints

### Missed Call Rules API (NOT IMPLEMENTED)
- **Route**: `/api/missed-call-rules`
- **Frontend Code**: [src/hooks/useMissedCallRules.ts](src/hooks/useMissedCallRules.ts) lines 22, 36, 65, 86
- **Required Methods**: GET, POST, PUT, DELETE
- **Database Tables Exist**: [public/local-agent/sqlite-db.cjs](public/local-agent/sqlite-db.cjs) lines 332-344
- **Status**: ❌ BACKEND NOT IMPLEMENTED - Frontend will fail

### SMS Gateway CRUD API (PARTIALLY IMPLEMENTED)
- **Existing Route**: POST `/api/sms-gateway-url` [api-server.cjs line 3141](public/local-agent/api-server.cjs#L3141)
- **Missing Routes**: GET `/api/sms-gateways`, PUT, DELETE
- **Database**: [sqlite-db.cjs lines 309-318](public/local-agent/sqlite-db.cjs#L309-L318)
- **Status**: ⚠️ Only URL saving implemented

---

## SMS Sending Functions

### 1. Call Auto-SMS (for answered/missed calls)
- **Function**: `sendCallAutoSms()` 
- **Location**: [api-server.cjs lines 1187-1241](public/local-agent/api-server.cjs#L1187-L1241)
- **Triggered By**: `syncCallRecords()` [line 1073](public/local-agent/api-server.cjs#L1073)
- **Uses**: `sendSmsViaGateway()` [line 1231](public/local-agent/api-server.cjs#L1231)
- **Config Endpoint**: POST `/api/call-auto-sms-config` [line 4330](public/local-agent/api-server.cjs#L4330)
- **Status**: ✅ WORKING

### 2. Auto-Reply SMS (incoming SMS response)
- **Function**: `sendAutoReplySms()`
- **Location**: [api-server.cjs lines 1147-1178](public/local-agent/api-server.cjs#L1147-L1178)
- **Triggered By**: TG400 `sms-received` event [line 2001](public/local-agent/api-server.cjs#L2001)
- **Uses**: `sendSmsViaGateway()` [line 1165](public/local-agent/api-server.cjs#L1165)
- **Config Endpoint**: GET/POST `/api/auto-reply-config` [lines 4288-4309](public/local-agent/api-server.cjs#L4288-L4309)
- **Status**: ✅ WORKING

### 3. Main Gateway Function (curl-based)
- **Function**: `sendSmsViaGateway()`
- **Location**: [api-server.cjs lines 1543-1590](public/local-agent/api-server.cjs#L1543-L1590)
- **Method**: HTTP POST via curl/execSync
- **Gateway URL**: `https://sms.techrasystems.com/SMSApi/send`
- **Credentials**: [Lines 1532-1538](public/local-agent/api-server.cjs#L1532-L1538) - HARDCODED
  - `userid: 'nosteqltd'`
  - `senderid: 'NOSTEQLTD'`
  - `apikey: 'd5333c2f579ef1115d5984475e6fbecfffa2cdff'`
- **Status**: ✅ WORKING but INSECURE

### 4. SMS Report Delivery
- **Function**: `sendSmsReport()`
- **Location**: [api-server.cjs lines 1592-1680](public/local-agent/api-server.cjs#L1592-L1680)
- **Test Endpoint**: POST `/api/sms-report-test` [line 4346](public/local-agent/api-server.cjs#L4346)
- **Status**: ✅ WORKING

---

## SMS-Related API Endpoints (Implemented)

| Endpoint | Method | Location | Status |
|----------|--------|----------|--------|
| `/api/sms-templates` | GET | [line 4220](public/local-agent/api-server.cjs#L4220) | ✅ |
| `/api/sms-templates` | POST | [line 4229](public/local-agent/api-server.cjs#L4229) | ✅ |
| `/api/sms-templates/:id` | PUT | [line 4247](public/local-agent/api-server.cjs#L4247) | ✅ |
| `/api/sms-templates/:id` | DELETE | [line 4266](public/local-agent/api-server.cjs#L4266) | ✅ |
| `/api/auto-reply-config` | GET | [line 4288](public/local-agent/api-server.cjs#L4288) | ✅ |
| `/api/auto-reply-config` | POST | [line 4297](public/local-agent/api-server.cjs#L4297) | ✅ |
| `/api/call-auto-sms-config` | GET | [line 4318](public/local-agent/api-server.cjs#L4318) | ✅ |
| `/api/call-auto-sms-config` | POST | [line 4330](public/local-agent/api-server.cjs#L4330) | ✅ |
| `/api/sms-gateway-url` | POST | [line 3141](public/local-agent/api-server.cjs#L3141) | ⚠️ Partial |
| `/api/sms-report-test` | POST | [line 4346](public/local-agent/api-server.cjs#L4346) | ✅ |
| `/api/missed-call-rules` | GET/POST/PUT/DELETE | (MISSING) | ❌ |

---

## Call Auto-SMS Template Variables

Used in [api-server.cjs lines 1218-1226](public/local-agent/api-server.cjs#L1218-L1226):

```
{caller_name}    → Name of the caller
{caller_number}  → Phone number of caller
{extension}      → Extension that received call
{time}           → Call time (Kenya timezone)
{date}           → Call date (Kenya timezone)
{duration}       → Duration in seconds
```

---

## TG400 TCP API SMS Method

- **Method**: `sendSms(port, destination, message, id)`
- **Location**: [tg400-tcp-api.cjs lines 489-530](public/local-agent/tg400-tcp-api.cjs#L489-L530)
- **Protocol**: TCP/AMI command
- **Status**: ❌ EXISTS BUT NEVER CALLED
- **Note**: Application uses HTTP gateway instead

---

## Database Tables for SMS

### sms_gateways
**Location**: [sqlite-db.cjs lines 309-318](public/local-agent/sqlite-db.cjs#L309-L318)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| url | TEXT | Gateway URL |
| active | BOOLEAN | Enable/disable |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### sms_templates
**Location**: [sqlite-db.cjs lines 320-327](public/local-agent/sqlite-db.cjs#L320-L327)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT | Template name |
| message | TEXT | SMS message text |
| active | BOOLEAN | Enable/disable |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### missed_call_rules
**Location**: [sqlite-db.cjs lines 332-344](public/local-agent/sqlite-db.cjs#L332-L344)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| extensions | TEXT | Comma-separated ext IDs |
| threshold | INTEGER | Missed calls before SMS |
| template_id | TEXT FK | References sms_templates |
| gateway_id | TEXT FK | References sms_gateways |
| active | BOOLEAN | Enable/disable |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### missed_call_rule_calls
**Location**: [sqlite-db.cjs lines 346-362](public/local-agent/sqlite-db.cjs#L346-L362)

Tracks individual calls against rules.

### auto_reply_config
**Location**: Search in sqlite-db.cjs for `auto_reply_config` table creation

| Column | Type | Notes |
|--------|------|-------|
| enabled | BOOLEAN | Enable/disable auto-reply |
| message | TEXT | Response message |
| notification_email | TEXT | Email for notifications |

---

## Flow Diagrams

### Auto-SMS for Call (Answered/Missed)
```
Call saved in DB (syncCallRecords)
    ↓
sendCallAutoSms() checks status
    ↓
Missed? → Use callAutoSmsConfig.missed_message
Answered? → Use callAutoSmsConfig.answered_message
    ↓
Replace template variables {caller_number}, {date}, etc.
    ↓
sendSmsViaGateway(callerNumber, message)
    ↓
curl HTTP POST to Techrastems gateway
    ↓
Log result to activity_logs table
```

### Auto-Reply for Incoming SMS
```
TG400 receives SMS
    ↓
Emits 'sms-received' event [line 1943]
    ↓
sendAutoReplySms(senderNumber) called [line 2001]
    ↓
Check if enabled in auto_reply_config
    ↓
sendSmsViaGateway(senderNumber, configMessage)
    ↓
curl HTTP POST to gateway
    ↓
Log result
```

---

## Debugging & Testing Endpoints

**Debug Endpoints** (should be removed in production):

- `POST /api/test-missed-call-alert` [line 5366](public/local-agent/api-server.cjs#L5366) - Test missed call behavior
- `POST /api/debug/inject-missed-call` [line 5716](public/local-agent/api-server.cjs#L5716) - Inject test missed call
- `GET /api/debug/missed-calls` [line 5552](public/local-agent/api-server.cjs#L5552) - List all missed calls
- `POST /api/debug/reset-notifications` [line 5760](public/local-agent/api-server.cjs#L5760) - Clear notification tracking
- `POST /api/sms-report-test` [line 4346](public/local-agent/api-server.cjs#L4346) - Send test SMS
- `POST /api/test-sms-gateway` [line 3166](public/local-agent/api-server.cjs#L3166) - Test gateway connectivity

---

## Key Code Lines Reference

| What | File | Lines | Status |
|------|------|-------|--------|
| Hardcoded SMS gateway credentials | api-server.cjs | 1532-1538 | 🔴 Security risk |
| sendSmsViaGateway() | api-server.cjs | 1543-1590 | ⚠️ Uses shell/curl |
| sendSmsReport() | api-server.cjs | 1592-1680 | ✅ Enhanced logging |
| sendAutoReplySms() | api-server.cjs | 1147-1178 | ✅ Working |
| sendCallAutoSms() | api-server.cjs | 1187-1241 | ✅ Working |
| Call save triggers SMS | api-server.cjs | 1069-1078 | ✅ Event-driven |
| sendMissedCallAlert() | api-server.cjs | 1253-1381 | ✅ Telegram only |
| Queue processor | api-server.cjs | 1114-1138 | ✅ 300ms delay |
| TG400 SMS method (unused) | tg400-tcp-api.cjs | 489-530 | ❌ Never called |
| Missed call rules schema | sqlite-db.cjs | 332-362 | ⚠️ No API impl |
| SMS templates schema | sqlite-db.cjs | 320-327 | ✅ Full CRUD API |
| SMS gateways schema | sqlite-db.cjs | 309-318 | ⚠️ Partial API |

