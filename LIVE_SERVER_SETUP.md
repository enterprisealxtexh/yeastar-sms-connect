# Live Server Deployment Guide
## Yeastar SMS Connect - calls.alxtexh.top

Complete setup guide for deploying to a production server with the domain `calls.alxtexh.top`.

---

## 🏗️ Architecture Overview

Since **TG400 Gateway** and **S100 PBX** are only accessible locally, we use a **Hybrid Deployment**:

```
┌─────────────────────────────────┐
│   Live Server (VPS/Cloud)       │
│  - Frontend (React/Vite)        │
│  - Nginx (Reverse Proxy)        │
│  - SSL/HTTPS                    │
│  calls.alxtexh.top              │
└──────────────────┬──────────────┘
                   │ HTTPS
                   │ Secure API Requests
                   │
              SSH Tunnel
          (Port 2003 tunneled)
                   │
┌──────────────────┼──────────────┐
│   Local Network  │              │
│  - API Server    │              │
│  - SQLite DB     │              │
│  - TG400 Gateway ├─ TCP/IP ─┐   │
│  - S100 PBX      │          │   │
└──────────────────┴──────────┬┘   │
                              │    │
                    ┌─────────┴───┐
                    │ Accessible  │
                    │ only locally │
                    └─────────────┘
```

### Best Approaches (in order of recommendation):

1. **✅ SSH Reverse Tunnel (RECOMMENDED)** - Secure, reliable, production-ready
2. **VPN (WireGuard/OpenVPN)** - Very secure, complex setup
3. **ngrok** - Quick testing, not for production
4. **Dedicated Local Server** - Keep both frontend & API local with port forwarding

---

## 📋 Prerequisites

### Server Requirements
- **OS**: Ubuntu 20.04 LTS or later (recommended)
- **CPU**: 2+ cores
- **RAM**: 2GB minimum (4GB recommended)
- **Storage**: 20GB minimum (for database and logs)
- **Network**: Stable internet connection, ports 80, 443 open

### Required Packages
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js (v18+) and npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install other dependencies
sudo apt install -y git curl wget nginx certbot python3-certbot-nginx sqlite3 build-essential

# Verify installations
node --version    # v18.x or higher
npm --version     # 8.x or higher
```

---

## 🔐 Method 1: SSH Reverse Tunnel (RECOMMENDED)

This is the **most secure and production-ready approach**. The API server stays local and securely tunnels through SSH.

### Step 1: Setup SSH Key Authentication (No password needed)

#### On Local Machine:
```bash
# Generate SSH key (if you haven't already)
ssh-keygen -t rsa -b 4096 -f ~/.ssh/vps_tunnel -N ""

# Copy public key to VPS
ssh-copy-id -i ~/.ssh/vps_tunnel.pub root@<VPS_IP>

# Test connection (should not ask for password)
ssh -i ~/.ssh/vps_tunnel root@<VPS_IP> "echo 'SSH key auth working'"
```

#### On VPS:
```bash
# Verify authorized_keys has your key
cat ~/.ssh/authorized_keys

# Restrict key to only allow tunnel (optional but recommended)
# Edit ~/.ssh/authorized_keys and add at the beginning of your key line:
# no-X11-forwarding,no-agent-forwarding,no-pty,permitopen="127.0.0.1:2003"
```

### Step 2: Create Reverse Tunnel Script on Local Machine

```bash
# Create the tunnel script
cat > ~/yeastar-tunnel.sh << 'EOF'
#!/bin/bash
VPS_IP="<your-vps-ip>"
VPS_USER="root"
SSH_KEY="$HOME/.ssh/vps_tunnel"
LOCAL_API_PORT=2003
REMOTE_BIND_PORT=2003

# Function to establish tunnel
create_tunnel() {
    echo "[$(date)] Starting SSH reverse tunnel to $VPS_IP..."
    
    # Create tunnel: local 2003 -> VPS 127.0.0.1:2003
    ssh -i "$SSH_KEY" \
        -N \
        -R 127.0.0.1:${REMOTE_BIND_PORT}:127.0.0.1:${LOCAL_API_PORT} \
        ${VPS_USER}@${VPS_IP} \
        -o StrictHostKeyChecking=accept-new \
        -o UserKnownHostsFile=~/.ssh/known_hosts \
        -o ConnectTimeout=10 \
        -o ServerAliveInterval=60 \
        -o ServerAliveCountMax=3 \
        -o ExitOnForwardFailure=yes
}

# Reconnect on failure
while true; do
    create_tunnel
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date)] Tunnel closed normally"
    else
        echo "[$(date)] Tunnel error (code: $EXIT_CODE), reconnecting in 30s..."
    fi
    sleep 30
done
EOF

chmod +x ~/yeastar-tunnel.sh
```

### Step 3: Create Systemd Service (Auto-reconnect)

```bash
# Create tunnel service
sudo tee /etc/systemd/system/yeastar-tunnel.service > /dev/null << 'EOF'
[Unit]
Description=Yeastar SMS Connect - SSH Reverse Tunnel to VPS
After=network.target
Wants=yeastar-api.service

[Service]
Type=simple
User=<YOUR_LOCAL_USER>
WorkingDirectory=/home/<YOUR_LOCAL_USER>
ExecStart=/home/<YOUR_LOCAL_USER>/yeastar-tunnel.sh
Restart=always
RestartSec=30

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=yeastar-tunnel

[Install]
WantedBy=multi-user.target
EOF

# Replace <YOUR_LOCAL_USER> with actual username
# Then reload and start
sudo systemctl daemon-reload
sudo systemctl start yeastar-tunnel
sudo systemctl enable yeastar-tunnel

# Check status
sudo systemctl status yeastar-tunnel
```

### Step 4: Configure VPS Nginx to Use Local Tunnel

On the **VPS**, configure Nginx to proxy API requests through the local tunnel:

```bash
sudo tee /etc/nginx/sites-available/calls.alxtexh.top > /dev/null << 'EOF'
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name calls.alxtexh.top www.calls.alxtexh.top;
    return 301 https://$server_name$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name calls.alxtexh.top www.calls.alxtexh.top;

    # SSL Certificates (configured below)
    ssl_certificate /etc/letsencrypt/live/calls.alxtexh.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calls.alxtexh.top/privkey.pem;

    # ... other SSL config (same as before) ...

    # Frontend - Serve static files from dist/
    location / {
        root /opt/yeastar-sms-connect/dist;
        try_files $uri $uri/ /index.html;
        
        # Cache control
        expires 1h;
        add_header Cache-Control "public, immutable";
    }

    # API - Proxy to local tunnel (127.0.0.1:2003)
    location /api/ {
        proxy_pass http://127.0.0.1:2003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_request_buffering off;
        proxy_buffering off;
        
        # Important: Keep tunnel alive
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://127.0.0.1:2003;
        access_log off;
    }
}
EOF
```

### Step 5: Verify Tunnel Connection

```bash
# On VPS, check if tunnel is active
sudo netstat -tlnp | grep 2003
# Should show: 127.0.0.1:2003 LISTEN

# Test tunnel connectivity
curl http://127.0.0.1:2003/api/health
# Should return: {"status": "ok"}

# Monitor tunnel status
sudo journalctl -u yeastar-tunnel -f
```

---

## SSL/HTTPS Setup

### 1. Install Certbot and Generate Certificate
```bash
# Create directory for domain
sudo mkdir -p /var/www/calls.alxtexh.top

# Generate SSL certificate
sudo certbot certonly --standalone \
  -d calls.alxtexh.top \
  -d www.calls.alxtexh.top \
  --agree-tos \
  -m admin@alxtexh.top \
  --non-interactive

# Verify certificate
sudo ls -la /etc/letsencrypt/live/calls.alxtexh.top/
```

### 2. Auto-Renewal Setup
```bash
# Enable certbot timer for auto-renewal
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Test renewal (dry-run)
sudo certbot renew --dry-run
```

---

## 📦 VPS Application Setup (Frontend Only)

⚠️ **Important**: On the VPS, we only deploy the **frontend** (Vite build). The API server stays local and connects via SSH tunnel.

### 1. Clone Repository
```bash
# Create app directory
sudo mkdir -p /opt/yeastar-sms-connect
sudo chown $USER:$USER /opt/yeastar-sms-connect
cd /opt/yeastar-sms-connect

# Clone repo
git clone <your-repo-url> .
```

### 2. Install Dependencies & Build
```bash
cd /opt/yeastar-sms-connect

# Install npm packages
npm install

# Build frontend for production
npm run build

# Verify build output
ls -la dist/
```

### 3. Create Environment Configuration
```bash
# Create .env file for VPS production
cat > /opt/yeastar-sms-connect/.env.production << 'EOF'
# This is the PUBLIC URL for API requests (backend tunnel via Nginx)
VITE_API_URL=https://calls.alxtexh.top

# Frontend only - no local API on VPS
NODE_ENV=production
EOF
```

---

## 🗄️ Database Setup (LOCAL MACHINE ONLY)

The database and API server stay on your local machine with TG400 and S100 PBX access.

### 1. Local Machine: Ensure API Server Running
```bash
cd /opt/yeastar-sms-connect  # or where you cloned it locally

# Start the API server (development mode)
npm run sms:start

# Or for production (using systemd - see Local Systemd Setup below)
sudo systemctl start yeastar-api-local
```

### 2. Local Machine: Create Database
```bash
mkdir -p /var/lib/yeastar-sms-connect
# Database will be auto-created on first API server startup
```

### 3. Local Machine: Database Backups
```bash
# Create backup directory
mkdir -p ~/yeastar-backups

# Create backup script
cat > ~/backup-yeastar-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="$HOME/yeastar-backups"
DB_FILE="/var/lib/yeastar-sms-connect/sms.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sms_db_$TIMESTAMP.sqlite3"

mkdir -p "$BACKUP_DIR"
cp "$DB_FILE" "$BACKUP_FILE"

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "sms_db_*.sqlite3" -mtime +30 -delete

echo "Database backed up to $BACKUP_FILE"
EOF

chmod +x ~/backup-yeastar-db.sh

# Add to crontab for daily backups at 2 AM
crontab -e
# Add this line: 0 2 * * * $HOME/backup-yeastar-db.sh
```

---

## 🚀 Systemd Services Setup

### 1. LOCAL MACHINE: API Server Service

### 1. LOCAL MACHINE: API Server Service

Create this on your **local machine** where TG400 and S100 PBX are accessible:

```bash
# Create .env.local for local machine
cat > ~/.config/yeastar/.env.local << 'EOF'
NODE_ENV=production
API_PORT=2003
SMS_DB_PATH=/var/lib/yeastar-sms-connect/sms.db

# TG400 Gateway
GATEWAY_IP=192.168.1.100
GATEWAY_PORT=5038
GATEWAY_API_USERNAME=admin
GATEWAY_API_PASSWORD=admin

# PBX Configuration
PBX_IP=192.168.1.101
PBX_PORT=8088
PBX_USERNAME=admin
PBX_PASSWORD=your_pbx_password
EOF

# Create systemd service
sudo tee /etc/systemd/system/yeastar-api-local.service > /dev/null << 'EOF'
[Unit]
Description=Yeastar SMS Connect API Server (Local)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/path/to/yeastar-sms-connect
Environment="NODE_ENV=production"
Environment="API_PORT=2003"
EnvironmentFile=$HOME/.config/yeastar/.env.local

ExecStart=/usr/bin/node /path/to/yeastar-sms-connect/public/local-agent/api-server.cjs

Restart=on-failure
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=yeastar-api-local

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable yeastar-api-local
sudo systemctl start yeastar-api-local
```

### 2. VPS: Nginx Service (Static Files + Proxy)

On the **VPS**, Nginx serves the built frontend and proxies API calls through the SSH tunnel:

```bash
# Nginx is automatically started with the config from earlier
sudo systemctl enable nginx
sudo systemctl start nginx
sudo systemctl reload nginx

# Check status
sudo systemctl status nginx
```

---

## 🔧 Configuration

### 1. Configure Gateway & PBX via Dashboard

1. **Determine Local Network Access**:
   - On your local machine go to: `http://localhost:5173`
   - On VPS, it will be: `https://calls.alxtexh.top`

2. **Verify API Connection**:
   ```bash
   # On local machine
   curl http://localhost:2003/api/health
   
   # On VPS (through tunnel)
   curl https://calls.alxtexh.top/api/health
   ```

3. **Go to Configuration Tab**:
   - **Gateway Settings**: TG400 IP, port, credentials
   - **PBX Settings**: S100 IP, port, credentials
   - **Telegram Bot** (optional): Add bot token and chat ID

### 2. Database Backups (Local Machine Only)
- Automated daily backups at 2 AM on local machine
- Location: `~/yeastar-backups/`
- Retention: 30 days

---

## 📊 Monitoring & Logs

### Local Machine Logs
```bash
# Check API server status
sudo systemctl status yeastar-api-local

# Check tunnel status
sudo systemctl status yeastar-tunnel

# View API logs
sudo journalctl -u yeastar-api-local -f

# View tunnel logs
sudo journalctl -u yeastar-tunnel -f
```

### VPS Logs
```bash
# SSH to VPS
ssh root@<VPS_IP>

# Check Nginx status
sudo systemctl status nginx

# View Nginx access logs
tail -f /var/log/nginx/calls.alxtexh.top_access.log

# View Nginx error logs
tail -f /var/log/nginx/calls.alxtexh.top_error.log

# Verify tunnel connection
sudo netstat -tlnp | grep 2003
# Should show: 127.0.0.1:2003 LISTEN
```

### 1. Monitor Tunnel Connection
```bash
# On VPS, check if tunnel is active
ssh root@<VPS_IP> "sudo netstat -tlnp | grep 2003"

# Test tunnel is working
ssh root@<VPS_IP> "curl http://127.0.0.1:2003/api/health"
```

### 2. Check Database Size (Local)
```bash
du -sh /var/lib/yeastar-sms-connect/sms.db
```

### 3. Monitor System Resources
```bash
# Install monitoring
htop

# View resources
top
```

---

## 🔄 Update & Maintenance

### 1. Update Frontend (VPS)
```bash
# SSH to VPS
ssh root@<VPS_IP>

cd /opt/yeastar-sms-connect

# Pull latest changes
git pull origin main

# Reinstall dependencies
npm install

# Rebuild frontend
npm run build

# Verify build succeeded
ls -la dist/

# Reload Nginx (no restart needed)
sudo systemctl reload nginx
```

### 2. Update API Server (Local Machine)
```bash
cd /opt/yeastar-sms-connect

# Backup database first
~/backup-yeastar-db.sh

# Pull latest changes
git pull origin main

# Reinstall dependencies
npm install

# Restart API server
sudo systemctl restart yeastar-api-local

# Check status
sudo systemctl status yeastar-api-local
```

### 3. Verify Tunnel Still Works
```bash
# Check tunnel is still connected
sudo journalctl -u yeastar-tunnel -n 20

# On VPS:
ssh root@<VPS_IP> "curl https://calls.alxtexh.top/api/health"
```

---

## 🛡️ Firewall Setup

### VPS Firewall (UFW)
```bash
ssh root@<VPS_IP>

# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS (for users)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Monitor status
sudo ufw status
```

### Local Machine Firewall
```bash
# Allow inbound SSH on port 22 (for tunnel)
sudo ufw allow 22/tcp

# Allow outbound SSH (for creating tunnel)
sudo ufw allow out 22/tcp

# Only allow VPS IP to connect
sudo ufw allow from <VPS_IP> to any port 22
```

---

## ⚠️ Troubleshooting

### SSH Tunnel Not Connecting
```bash
# On local machine, check tunnel logs
sudo journalctl -u yeastar-tunnel -n 50 -f

# Test manual SSH connection
ssh -i ~/.ssh/vps_tunnel -N -R 127.0.0.1:2003:127.0.0.1:2003 root@<VPS_IP>

# If connection hangs, check:
# 1. SSH key exists: ls -la ~/.ssh/vps_tunnel
# 2. VPS is reachable: ping <VPS_IP>
# 3. SSH port open on VPS: nc -zv <VPS_IP> 22
```

### API Server Won't Start (Local)
```bash
# Check logs
sudo journalctl -u yeastar-api-local -n 100

# Verify database path exists
ls -la /var/lib/yeastar-sms-connect/

# Check port 2003 not in use
sudo lsof -i :2003

# Try manual start
node /opt/yeastar-sms-connect/public/local-agent/api-server.cjs
```

### Frontend Not Loading on VPS
```bash
# SSH to VPS
ssh root@<VPS_IP>

# Check Nginx is running
sudo systemctl status nginx

# Check build files exist
ls -la /opt/yeastar-sms-connect/dist/

# Test Nginx config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Check logs
tail -f /var/log/nginx/calls.alxtexh.top_error.log
```

### API Requests Failing (Tunnel Issue)
```bash
# On VPS, verify tunnel is listening
sudo netstat -tlnp | grep 2003

# Test tunnel API
curl -v http://127.0.0.1:2003/api/health

# Check tunnel service
sudo journalctl -u yeastar-tunnel -f

# Restart tunnel on local machine
sudo systemctl restart yeastar-tunnel
```

### Gateway Connection Issues
```bash
# Test connectivity to TG400 from local machine
ping <gateway_ip>

# Test if TG400 port is open
nc -zv <gateway_ip> 5038

# Check API server logs
sudo journalctl -u yeastar-api-local -n 50
```

### SSL Certificate Issues (VPS)
```bash
ssh root@<VPS_IP>

# Check certificate expiration
sudo certbot certificates

# Manually renew
sudo certbot renew --force-renewal

# Check auto-renewal
sudo systemctl status certbot.timer
sudo systemctl list-timers certbot
```

---

## 📞 Comparison: Architecture Options

### Option 1: SSH Reverse Tunnel (RECOMMENDED) ✅
| Aspect | Rating | Notes |
|--------|--------|-------|
| Security | ⭐⭐⭐⭐⭐ | Encrypted tunnel, secure |
| Setup Complexity | ⭐⭐⭐ | Moderate, well documented |
| Maintenance | ⭐⭐⭐⭐ | Low, auto-reconnect |
| Performance | ⭐⭐⭐⭐ | Good, low latency |
| Cost | Free | Uses existing SSH |
| Reliability | ⭐⭐⭐⭐⭐ | Very stable with auto-restart |

### Option 2: VPN (WireGuard)
| Aspect | Rating | Notes |
|--------|--------|-------|
| Security | ⭐⭐⭐⭐⭐ | Very secure, encrypted |
| Setup Complexity | ⭐⭐⭐⭐ | Complex, requires VPN setup |
| Maintenance | ⭐⭐⭐⭐ | Moderate |
| Performance | ⭐⭐⭐⭐⭐ | Excellent |
| Cost | Free | Uses WireGuard |
| Reliability | ⭐⭐⭐⭐ | Stable |

### Option 3: ngrok/Cloudflare Tunnel
| Aspect | Rating | Notes |
|--------|--------|-------|
| Security | ⭐⭐⭐ | Good but relays data |
| Setup Complexity | ⭐ | Very simple |
| Maintenance | ⭐⭐ | Minimal |
| Performance | ⭐⭐⭐ | Decent, external provider |
| Cost | Free/Paid | Has plan limits |
| Reliability | ⭐⭐⭐ | Good but third-party |

---

## ✅ Post-Deployment Checklist

### Local Machine Setup
- [ ] API server running: `sudo systemctl status yeastar-api-local`
- [ ] SSH tunnel running: `sudo systemctl status yeastar-tunnel`
- [ ] Local health check: `curl http://localhost:2003/api/health`
- [ ] Database exists: `ls -la /var/lib/yeastar-sms-connect/sms.db`
- [ ] TG400 Gateway reachable: `ping <gateway_ip>`
- [ ] S100 PBX reachable: `ping <pbx_ip>`
- [ ] Daily backups configured: check crontab

### VPS Deployment
- [ ] Domain `calls.alxtexh.top` resolves: `nslookup calls.alxtexh.top`
- [ ] SSL certificate valid: `sudo certbot certificates`
- [ ] SSL auto-renewal enabled: `sudo systemctl status certbot.timer`
- [ ] Frontend built: `ls -la /opt/yeastar-sms-connect/dist/`
- [ ] Nginx running: `sudo systemctl status nginx`
- [ ] Tunnel accessible: `ssh root@<VPS_IP> 'netstat -tlnp | grep 2003'`

### Integration Tests
- [ ] Frontend loads: `https://calls.alxtexh.top`
- [ ] API accessible: `https://calls.alxtexh.top/api/health`
- [ ] Login works
- [ ] Dashboard loads with data
- [ ] Gateway status shows connected
- [ ] PBX status shows connected
- [ ] SMS can be sent/received
- [ ] Can view call records

---

## 🚀 Quick Deployment Summary

### Step 1: Prepare Local Machine
```bash
# Clone repo, install deps, setup local configs
cd ~/yeastar-sms-connect
npm install
cat > ~/.config/yeastar/.env.local << 'EOF'
NODE_ENV=production
API_PORT=2003
GATEWAY_IP=192.168.1.100
GATEWAY_PORT=5038
PBX_IP=192.168.1.101
PBX_PORT=8088
EOF

# Start services
sudo systemctl start yeastar-api-local
sudo systemctl start yeastar-tunnel
```

### Step 2: Prepare VPS
```bash
ssh root@<VPS_IP>
cd /opt/yeastar-sms-connect
git clone <repo-url> .
npm install && npm run build
sudo certbot certonly --standalone -d calls.alxtexh.top
sudo systemctl enable nginx && sudo systemctl start nginx
```

### Step 3: Test Connection
```bash
# Verify tunnel
sudo journalctl -u yeastar-tunnel -n 5
ssh root@<VPS_IP> "sudo netstat -tlnp | grep 2003"
# Visit: https://calls.alxtexh.top
```

---

**Last Updated**: 2026-02-20  
**Architecture**: SSH Reverse Tunnel (Hybrid Local + VPS)  
**Domain**: calls.alxtexh.top  
**Status**: Production Ready ✅
