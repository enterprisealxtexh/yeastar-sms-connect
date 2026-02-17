# Live Server Deployment Guide
## Yeastar SMS Connect - calls.alxtexh.top

Complete setup guide for deploying to a production server with the domain `calls.alxtexh.top`.

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

## 🔐 SSL Certificate (Let's Encrypt)

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

## 📦 Application Deployment

### 1. Clone Repository
```bash
# Create app directory
sudo mkdir -p /opt/yeastar-sms-connect
sudo chown $USER:$USER /opt/yeastar-sms-connect
cd /opt/yeastar-sms-connect

# Clone repo
git clone <your-repo-url> .
```

### 2. Install Dependencies
```bash
cd /opt/yeastar-sms-connect

# Install npm packages
npm install

# Or with bun (if preferred)
bun install
```

### 3. Create Environment Configuration
```bash
# Create .env file for production
cat > /opt/yeastar-sms-connect/.env.production << 'EOF'
# Server
NODE_ENV=production
API_PORT=2003
VITE_API_URL=https://calls.alxtexh.top

# Database
SMS_DB_PATH=/var/lib/yeastar-sms-connect/sms.db

# TG400 Gateway (configure these with your actual values)
GATEWAY_IP=192.168.1.100
GATEWAY_PORT=5038
GATEWAY_API_USERNAME=admin
GATEWAY_API_PASSWORD=admin

# PBX Configuration (Yeastar S100)
PBX_IP=192.168.1.101
PBX_PORT=8088
PBX_USERNAME=admin
PBX_PASSWORD=your_pbx_password

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
EOF
```

### 4. Build for Production
```bash
cd /opt/yeastar-sms-connect

# Build frontend
npm run build

# Output will be in dist/
```

---

## 🗄️ Database Setup

### 1. Create Database Directory
```bash
sudo mkdir -p /var/lib/yeastar-sms-connect
sudo chown nobody:nogroup /var/lib/yeastar-sms-connect
sudo chmod 755 /var/lib/yeastar-sms-connect
```

### 2. Initialize Database
```bash
# Run the database initialization
# This will be done automatically on first API server start
# Or manually:
node /opt/yeastar-sms-connect/public/local-agent/sqlite-db.cjs
```

### 3. Database Backup Setup
```bash
# Create backup directory
sudo mkdir -p /var/backups/yeastar-sms-connect
sudo chown nobody:nogroup /var/backups/yeastar-sms-connect

# Create backup script
sudo tee /usr/local/bin/backup-yeastar-db.sh > /dev/null << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/yeastar-sms-connect"
DB_FILE="/var/lib/yeastar-sms-connect/sms.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sms_db_$TIMESTAMP.sqlite3"

# Create backup
cp "$DB_FILE" "$BACKUP_FILE"

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "sms_db_*.sqlite3" -mtime +30 -delete

echo "Database backed up to $BACKUP_FILE"
EOF

sudo chmod +x /usr/local/bin/backup-yeastar-db.sh

# Add cron job for daily backups at 2 AM
echo "0 2 * * * /usr/local/bin/backup-yeastar-db.sh" | sudo tee -a /var/spool/cron/crontabs/root
```

---

## 🚀 Process Management with Systemd

### 1. Create Systemd Service File
```bash
sudo tee /etc/systemd/system/yeastar-api.service > /dev/null << 'EOF'
[Unit]
Description=Yeastar SMS Connect API Server
After=network.target
Wants=yeastar-api.service

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/yeastar-sms-connect
Environment="NODE_ENV=production"
Environment="API_PORT=2003"
Environment="SMS_DB_PATH=/var/lib/yeastar-sms-connect/sms.db"
EnvironmentFile=/opt/yeastar-sms-connect/.env.production

ExecStart=/usr/bin/node /opt/yeastar-sms-connect/public/local-agent/api-server.cjs

# Restart policy
Restart=on-failure
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=yeastar-api

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
```

### 2. Create Vite Frontend Service
```bash
sudo tee /etc/systemd/system/yeastar-vite.service > /dev/null << 'EOF'
[Unit]
Description=Yeastar SMS Connect Vite Frontend
After=network.target
Wants=yeastar-vite.service

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/yeastar-sms-connect
Environment="NODE_ENV=production"

ExecStart=/usr/bin/npm run preview

# Restart policy
Restart=on-failure
RestartSec=10

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=yeastar-vite

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
```

---

## 🌐 Nginx Reverse Proxy Configuration

### 1. Create Nginx Config
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

    # SSL Certificates
    ssl_certificate /etc/letsencrypt/live/calls.alxtexh.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calls.alxtexh.top/privkey.pem;

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Logging
    access_log /var/log/nginx/calls.alxtexh.top_access.log;
    error_log /var/log/nginx/calls.alxtexh.top_error.log;

    # Root directory for static files
    root /opt/yeastar-sms-connect/dist;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_min_length 1000;

    # Frontend - Vite preview server
    location / {
        try_files $uri $uri/ /index.html;
        proxy_pass http://localhost:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API - Node.js API server
    location /api/ {
        proxy_pass http://localhost:2003;
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
        
        # Longer timeouts for file operations
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:2003;
        access_log off;
    }
}
EOF
```

### 2. Enable Nginx Config
```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/calls.alxtexh.top /etc/nginx/sites-enabled/

# Test nginx config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## ▶️ Start Services

### 1. Start API Server
```bash
sudo systemctl start yeastar-api
sudo systemctl enable yeastar-api

# Check status
sudo systemctl status yeastar-api
```

### 2. Start Frontend Server
```bash
sudo systemctl start yeastar-vite
sudo systemctl enable yeastar-vite

# Check status
sudo systemctl status yeastar-vite
```

### 3. Verify Services Running
```bash
# Check if services are listening
sudo netstat -tlnp | grep -E '2003|5173|80|443'

# View logs
sudo journalctl -u yeastar-api -n 50
sudo journalctl -u yeastar-vite -n 50
```

---

## 🔧 Configuration

### 1. Configure via Web Dashboard
1. Open browser: `https://calls.alxtexh.top`
2. Login with default credentials (if set up)
3. Go to Configuration tab
4. Set up:
   - **Gateway Settings**: TG400 IP, port, credentials
   - **PBX Settings**: S100 IP, port, credentials
   - **Telegram Bot** (optional): Add bot token and chat ID

### 2. Database Backups
- Automated daily backups at 2 AM UTC
- Location: `/var/backups/yeastar-sms-connect/`
- Retention: 30 days

### 3. Log Rotation
```bash
sudo tee /etc/logrotate.d/yeastar-sms-connect > /dev/null << 'EOF'
/var/log/nginx/calls.alxtexh.top_*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
EOF
```

---

## 📊 Monitoring & Logs

### 1. View Service Logs
```bash
# API Server
sudo journalctl -u yeastar-api -f

# Frontend
sudo journalctl -u yeastar-vite -f

# Nginx
tail -f /var/log/nginx/calls.alxtexh.top_error.log
```

### 2. Check Database Size
```bash
du -sh /var/lib/yeastar-sms-connect/sms.db
```

### 3. Monitor System Resources
```bash
# Install monitoring
sudo apt install -y htop

# View resources
htop
```

---

## 🔄 Update & Maintenance

### 1. Backup Before Update
```bash
/usr/local/bin/backup-yeastar-db.sh
```

### 2. Update Application
```bash
cd /opt/yeastar-sms-connect

# Pull latest changes
git pull origin main

# Reinstall dependencies
npm install

# Rebuild frontend
npm run build

# Restart services
sudo systemctl restart yeastar-api yeastar-vite
```

### 3. Restart Services
```bash
# Restart all
sudo systemctl restart yeastar-api yeastar-vite nginx

# Check status
sudo systemctl status yeastar-api yeastar-vite
```

---

## 🛡️ Firewall Setup

### 1. Configure UFW (Ubuntu Firewall)
```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Restrict API port (local only if needed)
# sudo ufw allow from 192.168.1.0/24 to any port 2003

# Check firewall status
sudo ufw status
```

---

## ⚠️ Troubleshooting

### API Server Won't Start
```bash
# Check logs
sudo journalctl -u yeastar-api -n 100

# Verify database path exists
ls -la /var/lib/yeastar-sms-connect/

# Check port 2003 not in use
sudo lsof -i :2003
```

### Gateway Connection Issues
```bash
# Test connectivity to TG400
ping <gateway_ip>

# Test if TG400 port is open
nc -zv <gateway_ip> 5038
```

### SSL Certificate Issues
```bash
# Check certificate expiration
sudo certbot certificates

# Manually renew
sudo certbot renew --force-renewal
```

### Database Lock Error
```bash
# Database may be locked - restart services
sudo systemctl restart yeastar-api

# Check if multiple instances running
ps aux | grep node
```

---

## 📞 Support Resources

- **Yeastar Documentation**: https://docs.yeastar.com
- **Let's Encrypt**: https://letsencrypt.org/
- **Nginx**: https://nginx.org/
- **Node.js**: https://nodejs.org/

---

## ✅ Post-Deployment Checklist

- [ ] Domain `calls.alxtexh.top` resolvable
- [ ] SSL certificate valid and auto-renewing
- [ ] Services running (yeastar-api, yeastar-vite, nginx)
- [ ] Database initialized at `/var/lib/yeastar-sms-connect/sms.db`
- [ ] Gateway configured and connected
- [ ] PBX configured and authenticated
- [ ] Telegram bot configured (optional)
- [ ] Backups running daily
- [ ] Logs being collected and rotated
- [ ] Firewall rules configured
- [ ] Speed test: https://calls.alxtexh.top loads

---

**Created**: 2026-02-17
**For Domain**: calls.alxtexh.top
