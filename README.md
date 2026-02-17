# Yeastar SMS Connect

A comprehensive SMS and call management system for **Yeastar TG400 SMS Gateway** and **S100 PBX** integration with a modern React web interface.

## 🏗️ Architecture

**Frontend**: React 18 + TypeScript + Tailwind CSS + shadcn/ui  
**Backend**: Node.js Express API with SQLite database  
**Communication**: TCP/HTTP APIs for TG400 Gateway and S100 PBX  
**Deployment**: Local-only system (no cloud dependencies)

## ✨ Key Features

### SMS Management
- **Multi-SIM monitoring** (4 SIM ports) with real-time status
- **Message categorization** with AI-powered classification
- **Contact lookup** and management integration
- **SMS-to-Telegram** notifications and forwarding

### Call Management  
- **Call Detail Records (CDR)** with comprehensive tracking
- **Real-time call queue** monitoring and statistics
- **Extension management** with status monitoring
- **Call back functionality** for missed calls

### System Monitoring
- **TG400 Gateway** connection and port status
- **S100 PBX** integration with extension tracking
- **Signal strength** monitoring for all SIM cards
- **Predictive maintenance** alerts and diagnostics

### Advanced Features
- **Role-based authentication** (admin/operator/viewer)
- **Activity logging** with severity levels
- **Error tracking** with automatic recovery
- **24-hour time format** with Africa/Nairobi timezone
- **Auto-retry mechanisms** with exponential backoff

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment** (`.env`):
   ```env
   VITE_API_URL="http://localhost:2003"
   SMS_DB_PATH="./public/local-agent/sms.db"
   TG400_IP="192.168.1.100"
   TG400_PASSWORD="your_password"
   ```

3. **Start the application**:
   ```bash
   # Full stack (frontend + SMS service)
   npm run dev:full
   
   # Frontend only
   npm run dev
   ```

4. **Access the dashboard**: http://localhost:5173

## 📱 SMS Service Management

Control the SMS polling agent:
```bash
npm run sms:start    # Start SMS service
npm run sms:status   # Check service status
npm run sms:logs     # View service logs
npm run sms:stop     # Stop SMS service
```

---
**Developer**: Alxtexh | **Version**: 4.1.0 | **License**: Private