

const net = require('net');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// File-based debug logging (bypasses logger level system)
const DEBUG_LOG_FILE = path.join(__dirname, 'sms-debug.log');
function fileLog(label, data) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${label}: ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}\n`;
  fs.appendFileSync(DEBUG_LOG_FILE, logLine, 'utf8');
}

class TG400TcpApi extends EventEmitter {
  constructor(gatewayIp, port = 5038, username = 'admin', password = '', logger = console) {
    super();
    this.gatewayIp = gatewayIp;
    this.port = port;
    this.username = username;
    this.password = password;
    
    // Normalize logger to have consistent interface (level, message)
    if (typeof logger === 'object' && logger.log && typeof logger.log === 'function') {
      // Already has .log() method
      this.logger = logger;
    } else if (typeof logger === 'object' && typeof logger.info === 'function') {
      // Has .info(), .warn(), .error(), .debug() methods - wrap them
      this.logger = {
        log: (level, msg) => {
          if (level === 'info' && typeof logger.info === 'function') logger.info(msg);
          else if (level === 'warn' && typeof logger.warn === 'function') logger.warn(msg);
          else if (level === 'error' && typeof logger.error === 'function') logger.error(msg);
          else if (level === 'debug' && typeof logger.debug === 'function') logger.debug(msg);
          else if (level === 'success' && typeof logger.info === 'function') logger.info(msg);
          else console.log(`[${level}]`, msg); // Fallback
        }
      };
    } else {
      // Default to console with proper level handling
      this.logger = {
        log: (level, msg) => {
          if (level === 'error') console.error(`[${level}]`, msg);
          else if (level === 'warn') console.warn(`[${level}]`, msg);
          else console.log(`[${level}]`, msg);
        }
      };
    }
    
    this.socket = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.buffer = '';
    this.pendingRequests = new Map(); // Track command responses
    this.commandCounter = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 5000; // ms
    this.heartbeatInterval = null;
    this.lastActivityTime = Date.now();
  }

  /**
   * Connect to TG400 and authenticate
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = net.createConnection(this.port, this.gatewayIp);

        this.socket.on('connect', () => {
          this.logger.log('info', `Connected to TG400 at ${this.gatewayIp}:${this.port}`);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          // Configure TCP keepalive to PREVENT connection drops
          // These settings ensure the connection stays alive even when idle
          this.socket.setKeepAlive(true, 15000);  // Start keepalive after 15 seconds idle
          this.socket.setNoDelay(true);           // Disable Nagle's algorithm for faster response
          
          // Try to set system-level keepalive on Linux for aggressive probing
          try {
            if (this.socket.setsockopt) {
              this.socket.setsockopt(6, 4, 10);    // TCP_KEEPIDLE = 10 seconds
              this.socket.setsockopt(6, 5, 5);     // TCP_KEEPINTVL = 5 seconds  
              this.socket.setsockopt(6, 6, 3);     // TCP_KEEPCNT = 3 probes
            }
          } catch (e) {
            this.logger.log('debug', `System keepalive options not available: ${e.message}`);
          }
          
          this.lastActivityTime = Date.now();
          
          // Send login command
          this.sendCommand(`Action: Login\r\nUsername: ${this.username}\r\nSecret: ${this.password}\r\n\r\n`, true);
        });

        this.socket.on('data', (data) => {
          this.handleData(data.toString());
        });

        this.socket.on('error', (error) => {
          this.logger.log('error', `TCP connection error: ${error.message}`);
          this.isConnected = false;
          this.isAuthenticated = false;
          this.attemptReconnect();
          reject(error);
        });

        this.socket.on('close', () => {
          this.logger.log('warn', 'TCP connection closed, attempting to reconnect...');
          this.isConnected = false;
          this.isAuthenticated = false;
          this.attemptReconnect();
        });

        // Wait for authentication
        const authTimeout = setTimeout(() => {
          reject(new Error('Authentication timeout'));
        }, 10000);

        this.once('authenticated', () => {
          clearTimeout(authTimeout);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Attempt to reconnect with exponential backoff
   * This ensures the TCP connection is ALWAYS maintained
   */
  attemptReconnect() {
    // Don't give up - keep trying forever with backoff
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      60000  // Cap at 60 seconds max backoff
    );
    
    this.logger.log('info', `Attempting to reconnect to TG400 in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    
    setTimeout(() => {
      this.connect().catch(error => {
        this.logger.log('error', `Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`);
        // Keep trying - never give up
        this.attemptReconnect();
      });
    }, delay);
  }

  /**
   * Handle incoming data from socket
   */
  handleData(data) {
    this.buffer += data;

    // Process complete messages (delimited by \r\n\r\n)
    while (this.buffer.includes('\r\n\r\n')) {
      const endIndex = this.buffer.indexOf('\r\n\r\n') + 4;
      const message = this.buffer.substring(0, endIndex);
      this.buffer = this.buffer.substring(endIndex);

      this.processMessage(message);
    }
  }

  /**
   * Process received message from TG400
   */
  processMessage(message) {
    const lines = message.split('\r\n').filter(l => l.trim());
    const firstLine = lines[0] || '';

    // Parse key-value pairs from message
    const messageData = {};
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        messageData[key.trim()] = valueParts.join(':').trim();
      }
    }

    // DEBUG: Log raw message if it's a received SMS (to both logger and file)
    if (message.includes('ReceivedSMS')) {
      this.logger.log('info', `\n┌─── RAW TG400 MESSAGE ───┐`);
      this.logger.log('info', `${message.substring(0, 500)}`);
      this.logger.log('info', `└─────────────────────────┘`);
      this.logger.log('info', `\n┌─── PARSED FIELDS ───┐`);
      this.logger.log('info', JSON.stringify(messageData, null, 2));
      this.logger.log('info', `└────────────────────┘\n`);
      
      // ALSO log to file (bypasses LOG level system)
      fileLog('RAW_SMS_MESSAGE', message.substring(0, 800));
      fileLog('PARSED_FIELDS', messageData);
    }

    // Check for authentication response (look for Success in any line)
    const hasSuccess = lines.some(l => l.includes('Response: Success'));
    if (hasSuccess) {
      this.isAuthenticated = true;
      this.lastActivityTime = Date.now();
      this.logger.log('success', 'Successfully authenticated with TG400');
      
      // Start heartbeat to keep connection alive
      if (!this.heartbeatInterval) {
        this.startHeartbeat();
      }
      
      this.emit('authenticated');
      return;
    }

    // Check for authentication failed
    const hasFailed = lines.some(l => l.includes('Response: Error') || l.includes('Response: Failed'));
    if (hasFailed) {
      this.logger.log('error', `Authentication failed: ${message}`);
      this.emit('authentication-failed', message);
      this.disconnect();
      return;
    }

    // Handle different event types
    if (messageData['Event'] === 'ReceivedSMS') {
      this.handleReceivedSms(messageData);
    } else if (messageData['Event'] === 'UpdateSMS') {
      this.handleSmsStatus(messageData);
    } else if (messageData['Response']) {
      this.handleCommandResponse(message);
    } else if (message.includes('--END COMMAND--')) {
      this.handleCommandResponse(message);
    }
  }

  /**
   * Handle received SMS event
   */
  handleReceivedSms(data) {
    this.lastActivityTime = Date.now();
    
    // DEBUG: Log raw event data to see all fields
    this.logger.log('info', `\n🔍 RAW SMS EVENT FIELDS: ${JSON.stringify(data, null, 2)}\n`);
    fileLog('HANDLE_RECEIVED_SMS_DATA', data); // File log
    
    // Get GsmSpan from the raw data
    const rawGsmSpan = data['GsmSpan'];
    this.logger.log('info', `✅ FIELD CHECK: GsmSpan field value = "${rawGsmSpan}" (type: ${typeof rawGsmSpan})`);
    
    // Map GsmSpan (2-5 from TG400 API) to actual port (1-4)
    // GsmSpan: 2 = Port 1, GsmSpan: 3 = Port 2, GsmSpan: 4 = Port 3, GsmSpan: 5 = Port 4
    const gsmSpan = parseInt(rawGsmSpan) || 2;
    const actualPort = Math.max(1, gsmSpan - 1);
    
    this.logger.log('info', `✅ Port Mapping: GsmSpan=${rawGsmSpan} (parsed=${gsmSpan}) -> Port=${actualPort}`);
    fileLog('PORT_MAPPING', { GsmSpan: rawGsmSpan, gsmSpan, actualPort, allKeys: Object.keys(data) }); // File log
    
    const sms = {
      id: data['ID'],
      port: actualPort,
      gsmSpan: gsmSpan,  // Store GSM span number (2-5)
      sender: data['Sender'] || 'Unknown',
      receivedAt: data['Recvtime'],
      content: data['Content'],
      index: parseInt(data['Index']) || 1,
      total: parseInt(data['Total']) || 1,
      smsc: data['Smsc'],
    };

    // Decode URL-encoded content if needed
    if (sms.content) {
      try {
        sms.content = decodeURIComponent(sms.content);
      } catch (e) {
        // Content might not be URL-encoded
      }
    }

    this.logger.log('info', `Received SMS on port ${sms.port} (GsmSpan ${sms.gsmSpan}) from ${sms.sender}`);
    this.emit('sms-received', sms);
  }

  /**
   * Handle SMS send status update
   */
  handleSmsStatus(data) {
    this.lastActivityTime = Date.now();
    const status = {
      id: data['ID'],
      smsc: data['Smsc'],
      status: data['Status'] === '1' ? 'sent' : 'failed',
    };

    this.logger.log('info', `SMS ${status.id} status: ${status.status}`);
    this.emit('sms-status-update', status);

    // Resolve pending request if exists
    if (this.pendingRequests.has(status.id)) {
      const resolve = this.pendingRequests.get(status.id);
      resolve(status);
      this.pendingRequests.delete(status.id);
    }
  }

  /**
   * Handle command response
   */
  handleCommandResponse(message) {
    this.logger.log('debug', `Command response: ${message.substring(0, 100)}...`);
    // This would be handled by specific command methods
    this.emit('command-response', message);
  }

  /**
   * Send raw command to TG400
   */
  sendCommand(command, isAuth = false) {
    if (!isAuth && (!this.isConnected || !this.isAuthenticated)) {
      this.logger.log('error', 'Not connected or authenticated');
      throw new Error('Not connected or authenticated to TG400');
    }

    if (!this.socket) {
      throw new Error('Socket not initialized');
    }

    this.logger.log('debug', `Sending command: ${command.substring(0, 100)}...`);
    this.socket.write(command);
  }

  /**
   * Get all GSM spans/ports status
   * Returns info about all 4 ports
   */
  async getAllPortsInfo() {
    const command = `Action: smscommand\r\ncommand: gsm show spans\r\n\r\n`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Get all ports timeout'));
      }, 10000);

      const listener = (message) => {
        clearTimeout(timeout);
        this.removeListener('command-response', listener);
        resolve(this.parseAllPortsInfo(message));
      };

      this.on('command-response', listener);
      this.sendCommand(command);
    });
  }

  /**
   * Check detailed port info
   */
  async checkPortStatus(port) {
    // port should be 0-3, but TG400 uses 1-based indexing
    const portNumber = port + 1;
    const command = `Action: smscommand\r\ncommand: gsm show ${portNumber}\r\n\r\n`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Port ${port} status check timeout`));
      }, 10000);

      const listener = (message) => {
        clearTimeout(timeout);
        this.removeListener('command-response', listener);
        resolve(this.parsePortStatus(message, port));
      };

      this.on('command-response', listener);
      this.sendCommand(command);
    });
  }

  /**
   * Parse all ports info from gsm show spans
   */
  parseAllPortsInfo(message) {
    // Split by newlines (handle both \r\n and \n)
    const lines = message.split(/[\r\n]+/).filter(l => l.trim());
    const ports = [];

    for (const line of lines) {
      // Format: "GSM span 2: Power on, Provisioned, Up, Active, Standard"
      const match = line.match(/GSM\s+span\s+(\d+):\s*(.+)/i);
      if (match) {
        const portNum = parseInt(match[1]);
        const portIndex = portNum - 1; // Convert to 0-based index
        const statusStr = match[2];
        
        // Port is active if it has "Up" status AND either "Provisioned" OR has Power on with Active
        // Inactive ports typically show "PowerOff" or missing "Up"
        const hasUp = statusStr.includes('Up');
        const hasActive = statusStr.includes('Active');
        const isPowerOn = statusStr.includes('Power on');
        const isPowerOff = statusStr.includes('Power off') || statusStr.toLowerCase().includes('power off');
        
        const isUp = hasUp && (!isPowerOff);  // If power is explicitly off, it's not up
        
        ports.push({
          port: portIndex,
          portNumber: portNum,
          status: statusStr,
          isUp: isUp,
          isPowerOn: isPowerOn,
          isPowerOff: isPowerOff,
          isActive: hasActive,
          isProvisioned: statusStr.includes('Provisioned'),
          raw: line,
        });
      }
    }

    return ports;
  }

  /**
   * Parse port status response
   */
  parsePortStatus(message, port) {
    const lines = message.split('\r\n').filter(l => l.trim());
    const status = {
      port: port,
      isUp: false,
      signalQuality: 0,
      networkName: 'Unknown',
      simStatus: 'Unknown',
      raw: message,
    };

    for (const line of lines) {
      if (line.includes('Status:')) {
        const statusValue = line.split(':')[1]?.trim() || '';
        status.isUp = statusValue.includes('Up') || statusValue.includes('Active');
      }
      if (line.includes('Signal Quality')) {
        const match = line.match(/\((\d+),\d+\)/);
        if (match) status.signalQuality = parseInt(match[1]);
      }
      if (line.includes('Network Name:')) {
        status.networkName = line.split(':')[1]?.trim() || 'Unknown';
      }
      if (line.includes('SIM')) {
        status.simStatus = line.split(':')[0]?.trim() || 'Unknown';
      }
    }

    return status;
  }

  /**
   * Check all ports status
   */
  async checkAllPortsStatus(ports) {
    const statuses = [];
    for (const port of ports) {
      try {
        const status = await this.checkPortStatus(port);
        statuses.push(status);
      } catch (error) {
        this.logger.log('error', `Failed to check port ${port}: ${error.message}`);
        statuses.push({
          port: port,
          isUp: false,
          error: error.message,
        });
      }
    }
    return statuses;
  }

  /**
   * Send SMS via TG400
   * @param {number} port - SIM port (1-4)
   * @param {string} destination - Phone number
   * @param {string} message - SMS content
   * @param {string} id - Unique message ID
   */
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

  /**
   * Send USSD
   */
  async sendUssd(port, code, timeout = 30) {
    const command = `Action: SMSCommand\r\ncommand: gsm send ussd ${port + 1} "${code}" ${timeout}\r\n\r\n`;

    return new Promise((resolve, reject) => {
      const requestTimeout = setTimeout(() => {
        reject(new Error(`USSD send timeout for port ${port}`));
      }, (timeout + 5) * 1000);

      const listener = (message) => {
        clearTimeout(requestTimeout);
        this.removeListener('command-response', listener);
        resolve(message);
      };

      this.on('command-response', listener);
      this.sendCommand(command);
    });
  }

  /**
   * Health check - verify connection is alive
   * Called periodically to ensure socket stays connected
   */
  async healthCheck() {
    if (!this.isConnected || !this.isAuthenticated) {
      this.logger.log('warn', 'Health check: Connection not ready');
      return false;
    }

    try {
      const allPorts = await this.getAllPortsInfo();
      this.logger.log('debug', `Health check: Connection OK. Ports: ${allPorts.length}`);
      return true;
    } catch (error) {
      this.logger.log('warn', `Health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   * Sends a "ping" command every 20 seconds to prevent device from closing connection
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      this.logger.log('debug', 'Heartbeat already running');
      return;
    }

    this.logger.log('info', 'Starting keepalive heartbeat (every 20 seconds)');
    
    this.heartbeatInterval = setInterval(() => {
      if (!this.socket || !this.isConnected || !this.isAuthenticated) {
        this.logger.log('warn', 'Heartbeat: Connection not ready, stopping heartbeat');
        this.stopHeartbeat();
        return;
      }

      try {
        // Send a ping command - safe read-only command
        const pingCmd = `Action: Ping\r\n\r\n`;
        this.socket.write(pingCmd);
        this.lastActivityTime = Date.now();
        this.logger.log('debug', `Heartbeat sent`);
      } catch (err) {
        this.logger.log('error', `Failed to send heartbeat: ${err.message}`);
        this.stopHeartbeat();
      }
    }, 20000);  // Send heartbeat every 20 seconds
  }

  /**
   * Stop the heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.logger.log('info', 'Heartbeat stopped');
    }
  }

  /**
   * Disconnect from TG400
   */
  disconnect() {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
    this.isAuthenticated = false;
  }
}

module.exports = TG400TcpApi;
