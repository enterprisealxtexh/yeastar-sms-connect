# VPS Nginx Setup - calls.alxtexh.top

Simple setup guide for deploying on VPS with Cloudflare proxy.

---

## 📋 Prerequisites

**On Your VPS:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install requirements
sudo apt install -y nodejs npm nginx git sqlite3 build-essential

# Verify
node --version  # v18+
npm --version   # 8+
```

---

## 🌐 Cloudflare Setup

1. **Add DNS Record in Cloudflare Dashboard:**
   - Type: A
   - Name: `calls.alxtexh.top`
   - Content: `<your_vps_ip>`
   - Proxy: ☁️ **Proxied** (orange cloud)
   - TTL: Auto

2. **Configure SSL/TLS:**
   - Go to SSL/TLS tab
   - Encryption mode: **Full** or **Full (strict)**

---

## 📦 Application Setup

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
npm install
npm run build
```

### 3. Create Database Directory
```bash
sudo mkdir -p /var/lib/yeastar-sms-connect
sudo chown nobody:nogroup /var/lib/yeastar-sms-connect
sudo chmod 755 /var/lib/yeastar-sms-connect
```

### 4. Create .env.production File
```bash
nano /opt/yeastar-sms-connect/.env.production
```

**Content:**
```env
# Local API Configuration
VITE_API_URL="http://localhost:2003"
VITE_API_ENABLED="true"

# Database
SMS_DB_PATH="/var/lib/yeastar-sms-connect/sms.db"
NODE_ENV="production"
```

> **Note:** Gateway and PBX settings are configured in the web dashboard after deployment, not via .env

---

## 🚀 Systemd Services

### 1. API Service
```bash
sudo tee /etc/systemd/system/yeastar-api.service > /dev/null << 'EOF'
[Unit]
Description=Yeastar SMS Connect API
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/yeastar-sms-connect
Environment="NODE_ENV=production"
EnvironmentFile=/opt/yeastar-sms-connect/.env.production
ExecStart=/usr/bin/node /opt/yeastar-sms-connect/public/local-agent/api-server.cjs
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 2. Frontend Service
```bash
sudo tee /etc/systemd/system/yeastar-vite.service > /dev/null << 'EOF'
[Unit]
Description=Yeastar SMS Connect Vite Frontend
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/yeastar-sms-connect
Environment="NODE_ENV=production"
ExecStart=/usr/bin/npm run preview
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
```

### 3. Start Services
```bash
sudo systemctl start yeastar-api yeastar-vite
sudo systemctl enable yeastar-api yeastar-vite

# Check status
sudo systemctl status yeastar-api yeastar-vite
```

---

## 🌐 Nginx Configuration

### Create Nginx Config (HTTP only - Cloudflare proxies)
```bash
sudo tee /etc/nginx/sites-available/calls.alxtexh.top > /dev/null << 'EOF'
# HTTP Server (Cloudflare handles HTTPS)
server {
    listen 80;
    listen [::]:80;
    server_name calls.alxtexh.top www.calls.alxtexh.top;

    # Logging
    access_log /var/log/nginx/calls.alxtexh.top_access.log;
    error_log /var/log/nginx/calls.alxtexh.top_error.log;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # Root for static files
    root /opt/yeastar-sms-connect/dist;

    # Frontend - Vite Preview
    location / {
        try_files $uri $uri/ /index.html;
        proxy_pass http://localhost:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API Backend
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
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:2003;
        access_log off;
    }
}
EOF
```

### Enable and Reload Nginx
```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/calls.alxtexh.top /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload
sudo systemctl reload nginx
sudo systemctl enable nginx
```

---

## ✅ Verification

```bash
# Check all services running
sudo systemctl status yeastar-api yeastar-vite nginx

# Verify ports listening
sudo lsof -i -P -n | grep LISTEN

# Test API locally
curl http://localhost:2003/api/health

# Visit in browser
https://calls.alxtexh.top
```

---

## 📊 Useful Commands

### View Logs
```bash
sudo journalctl -u yeastar-api -f       # Live API logs
sudo journalctl -u yeastar-vite -f      # Live frontend logs
tail -f /var/log/nginx/calls.alxtexh.top_error.log
```

### Restart Services
```bash
sudo systemctl restart yeastar-api yeastar-vite nginx
```

### Check Nginx Config
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Database Backup
```bash
# Manual backup
cp /var/lib/yeastar-sms-connect/sms.db /var/lib/yeastar-sms-connect/sms.db.backup.$(date +%s)

# Setup daily backup (cron)
echo "0 2 * * * cp /var/lib/yeastar-sms-connect/sms.db /var/backups/sms_db_\$(date +\%Y\%m\%d).sqlite3" | sudo crontab -
```

---

## 🔧 Troubleshooting

### Services Won't Start
```bash
# Check logs
sudo journalctl -u yeastar-api -n 50

# Check port availability
sudo lsof -i :2003
sudo lsof -i :5173
```

### Nginx Issues
```bash
# Test config
sudo nginx -t

# View error log
tail -f /var/log/nginx/calls.alxtexh.top_error.log

# Reload
sudo systemctl reload nginx
```

### Database Issues
```bash
# Check integrity
sqlite3 /var/lib/yeastar-sms-connect/sms.db "PRAGMA integrity_check;"

# Restart API
sudo systemctl restart yeastar-api
```

---

## 🔄 Updates

```bash
cd /opt/yeastar-sms-connect

# Backup first
cp /var/lib/yeastar-sms-connect/sms.db /var/lib/yeastar-sms-connect/sms.db.backup

# Pull and rebuild
git pull origin main
npm install
npm run build

# Restart
sudo systemctl restart yeastar-api yeastar-vite
```

---

**Domain:** calls.alxtexh.top  
**Last Updated:** 2026-02-17
