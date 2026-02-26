# Production Deployment Guide - Step by Step
## Yeastar SMS Connect - Hybrid Setup (Local + VPS)

---

## 📋 Architecture Overview

```
┌────────────────────────────────────┐
│  VPS (calls.nosteq.co.ke)          │
│  ├─ Frontend (React/Vite)          │
│  ├─ Nginx (reverse proxy)          │
│  └─ SSL/HTTPS                      │
│      ↓                              │
│   SSH Tunnel (encrypted)           │
│      ↓                              │
┌────────────────────────────────────┐
│  LOCAL MACHINE                     │
│  ├─ API Server (PM2 managed)       │
│  ├─ SMS Service (PM2 managed)      │
│  ├─ TG400 Gateway (connected)      │
│  └─ S100 PBX (connected)           │
└────────────────────────────────────┘
```

Users visit VPS → Frontend loads → API calls tunnel back to local → Local accesses TG400/PBX

---

## 🚀 STEP 1: LOCAL MACHINE SETUP

### 1.1 Install PM2 Globally
```bash
sudo npm install -g pm2
```

### 1.2 Create PM2 Ecosystem Config

Create file: `ecosystem.config.js`
```bash
cat > ~/yeastar-sms-connect/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: 'api-server',
      script: './public/local-agent/api-server.cjs',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        API_PORT: 2003,
        SMS_DB_PATH: './public/local-agent/sms.db'
      },
      error_file: './logs/api-server-error.log',
      out_file: './logs/api-server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'sms-service',
      script: './public/local-agent/start-sms-service.sh',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      error_file: './logs/sms-service-error.log',
      out_file: './logs/sms-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'ssh-tunnel',
      script: './public/local-agent/start-ssh-tunnel.sh',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '100M',
      args: '<VPS_IP> ~/.ssh/vps_tunnel',
      error_file: './logs/ssh-tunnel-error.log',
      out_file: './logs/ssh-tunnel-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
EOF
```

**Replace `<VPS_IP>` with your actual VPS IP address**

### 1.3 Create Logs Directory
```bash
mkdir -p ~/yeastar-sms-connect/logs
```

### 1.4 Setup SSH Key for Tunnel (One Time)
```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t rsa -b 4096 -f ~/.ssh/vps_tunnel -N ""

# Display public key (copy this)
cat ~/.ssh/vps_tunnel.pub
```

### 1.5 Start Services with PM2
```bash
cd ~/yeastar-sms-connect

# Start all services
pm2 start ecosystem.config.js

# Check status
pm2 status

# Save for auto-restart on system reboot
pm2 save

# Enable auto-start on boot
pm2 startup
# Follow the output instructions (usually involves running a generated command)
```

### 1.6 Verify All Services Running
```bash
# All should show "online"
pm2 status

# Check API server
curl http://localhost:2003/api/health

# View logs
pm2 logs api-server
pm2 logs sms-service
pm2 logs ssh-tunnel
```

---

## 🌐 STEP 2: VPS SETUP

### 2.1 SSH into VPS
```bash
ssh root@<VPS_IP>
```

### 2.2 Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### 2.3 Install Dependencies
```bash
sudo apt install -y nodejs npm nginx git sqlite3 build-essential curl wget

# Verify installations
node --version   # v18+
npm --version    # 8+
```

### 2.4 Create Application Directory
```bash
sudo mkdir -p /opt/yeastar-sms-connect
sudo chown $USER:$USER /opt/yeastar-sms-connect
cd /opt/yeastar-sms-connect
```

### 2.5 Clone Repository
```bash
git clone https://github.com/your-repo/yeastar-sms-connect.git .
```

### 2.6 Install Dependencies
```bash
npm install
```

### 2.7 Build Frontend for Production
```bash
npm run build

# Verify build succeeded
ls -la dist/
```

### 2.8 Configure Environment
```bash
cat > .env.production << 'EOF'
VITE_API_URL="https://calls.nosteq.co.ke/api"
SMS_DB_PATH="/opt/yeastar-sms-connect/sms.db"
API_PORT=2003
API_HOST="0.0.0.0"
LOG_LEVEL="info"
CORS_ORIGIN="https://calls.nosteq.co.ke"
EOF
```

### 2.9 Create Systemd Service for Frontend
```bash
sudo tee /etc/systemd/system/yeastar-vite.service > /dev/null << 'EOF'
[Unit]
Description=Yeastar SMS Connect - Vite Frontend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/yeastar-sms-connect
ExecStart=/usr/bin/npm run preview
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable yeastar-vite
sudo systemctl start yeastar-vite
```

### 2.10 Verify Frontend Running
```bash
# Should see Vite preview on port 4173
sudo lsof -i :4173

# Or check service
sudo systemctl status yeastar-vite
```

---

## 🔧 STEP 3: NGINX SETUP (VPS)

### 3.1 Add SSH Public Key to VPS
```bash
# Back on LOCAL machine, copy your public key
cat ~/.ssh/vps_tunnel.pub

# On VPS, add it to authorized_keys
echo "YOUR_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys

# Restrict tunnel (optional but secure)
# Edit ~/.ssh/authorized_keys and add at START of your key line:
# no-X11-forwarding,no-agent-forwarding,no-pty,permitopen="127.0.0.1:2003"
```

### 3.2 Create Nginx Configuration
```bash
sudo tee /etc/nginx/sites-available/calls.nosteq.co.ke > /dev/null << 'EOF'
server {
    listen 80;
    server_name calls.nosteq.co.ke www.calls.nosteq.co.ke;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name calls.nosteq.co.ke www.calls.nosteq.co.ke;

    ssl_certificate /etc/letsencrypt/live/calls.nosteq.co.ke/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calls.nosteq.co.ke/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/calls.nosteq.co.ke_access.log;
    error_log /var/log/nginx/calls.nosteq.co.ke_error.log;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # Frontend - Vite on 4173
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API - Through SSH tunnel on 2003
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
    }
}
EOF
```

### 3.3 Enable Nginx Site
```bash
sudo ln -s /etc/nginx/sites-available/calls.nosteq.co.ke /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload
sudo systemctl reload nginx
```

### 3.4 Setup SSL Certificate
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Generate certificate
sudo certbot certonly --standalone \
  -d calls.nosteq.co.ke \
  -d www.calls.nosteq.co.ke \
  --non-interactive \
  --agree-tos \
  -m admin@nosteq.co.ke

# Enable auto-renewal
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Test renewal (dry-run)
sudo certbot renew --dry-run
```

### 3.5 Update Nginx with SSL Paths
```bash
sudo systemctl reload nginx
```

---

## 🔒 STEP 4: VERIFY TUNNEL CONNECTION

### 4.1 Test SSH Connection from Local
```bash
# SSH to VPS should work without password
ssh -i ~/.ssh/vps_tunnel root@<VPS_IP> "echo 'SSH key auth working'"
```

### 4.2 Check Tunnel is Running (Local)
```bash
# Should show "online"
pm2 status

# Check logs
pm2 logs ssh-tunnel
```

### 4.3 Verify Tunnel on VPS
```bash
# SSH to VPS
ssh root@<VPS_IP>

# Check if tunnel port is listening
sudo netstat -tlnp | grep 2003
# Should show: 127.0.0.1:2003 LISTEN

# Test API through tunnel
curl http://127.0.0.1:2003/api/health
# Should return: {"status":"ok"}
```

---

## ✅ STEP 5: TESTING

### 5.1 Test Frontend Access
```bash
# Open browser
https://calls.nosteq.co.ke

# Should load the dashboard (may need to configure PBX/Gateway first)
```

### 5.2 Test API Access
```bash
# From anywhere (not just VPS), test API through HTTPS
curl https://calls.nosteq.co.ke/api/health

# Response: {"status":"ok"}
```

### 5.3 Test Configuration
```bash
# Go to Configuration tab in dashboard
# Add Gateway: 192.168.1.100:5038
# Add PBX: 192.168.1.101:8088

# Should show "Connected" status
```

### 5.4 Test SMS/Calls Reception
```bash
# Send test SMS to gateway
# Should appear in dashboard within seconds

# Make test call
# Should appear in Recent Calls
```

---

## 📊 STEP 6: MONITORING & MAINTENANCE

### 6.1 View Service Status (Local)
```bash
# All running services
pm2 status

# Real-time dashboard
pm2 monit

# Live logs
pm2 logs

# Specific service
pm2 logs api-server -f
pm2 logs sms-service -f
pm2 logs ssh-tunnel -f
```

### 6.2 Common PM2 Commands (Local)
```bash
# Restart all services
pm2 restart all

# Restart specific service
pm2 restart api-server

# Stop all
pm2 stop all

# Delete from PM2
pm2 delete all

# Check logs
pm2 logs api-server
pm2 logs sms-service
pm2 logs ssh-tunnel
```

### 6.3 Monitor Tunnel (VPS)
```bash
ssh root@<VPS_IP>

# Check tunnel still active
sudo netstat -tlnp | grep 2003

# Test tunnel
curl http://127.0.0.1:2003/api/health

# View Nginx logs
tail -f /var/log/nginx/calls.nosteq.co.ke_access.log
tail -f /var/log/nginx/calls.nosteq.co.ke_error.log
```

### 6.4 Database Backups (Local)
```bash
# Create backup directory
mkdir -p ~/yeastar-backups

# Backup database
cp ./public/local-agent/sms.db ~/yeastar-backups/sms.db.$(date +%Y%m%d_%H%M%S).bak

# Add to crontab for daily backups
crontab -e
# Add: 0 2 * * * cp /home/$USER/yeastar-sms-connect/public/local-agent/sms.db /home/$USER/yeastar-backups/sms.db.\$(date +\%Y\%m\%d).bak
```

---

## 🔄 STEP 7: UPDATES & MAINTENANCE

### 7.1 Update Frontend (VPS)
```bash
ssh root@<VPS_IP>
cd /opt/yeastar-sms-connect

# Backup first
cp .env.production .env.production.bak

# Pull latest
git pull origin main

# Reinstall
npm install

# Rebuild
npm run build

# Reload Nginx (no restart needed)
sudo systemctl reload nginx
```

### 7.2 Update API Server (Local)
```bash
cd ~/yeastar-sms-connect

# Backup database
cp ./public/local-agent/sms.db ./public/local-agent/sms.db.bak

# Pull latest
git pull origin main

# Reinstall
npm install

# Restart services
pm2 restart all

# Check status
pm2 status
```

### 7.3 Verify Update Success
```bash
# Test API
curl https://calls.nosteq.co.ke/api/health

# Check logs
pm2 logs api-server
```

---

## 🚨 TROUBLESHOOTING

### SSH Tunnel Not Connecting
```bash
# Check tunnel logs
pm2 logs ssh-tunnel

# Test manual tunnel
ssh -i ~/.ssh/vps_tunnel \
  -N -R 127.0.0.1:2003:127.0.0.1:2003 \
  root@<VPS_IP>

# If hangs, check:
# 1. SSH key exists: ls ~/.ssh/vps_tunnel
# 2. Public key on VPS: ssh -i ~/.ssh/vps_tunnel root@<VPS_IP> "grep $(cat ~/.ssh/vps_tunnel.pub | awk '{print $NF}') ~/.ssh/authorized_keys"
# 3. Port 2003 available locally: lsof -i :2003
```

### API Server Won't Start (Local)
```bash
# Check logs
pm2 logs api-server

# Try manual start
node ./public/local-agent/api-server.cjs

# Check port not in use
lsof -i :2003

# Database permissions
chmod 755 ./public/local-agent/
ls -la ./public/local-agent/sms.db
```

### Frontend Not Loading (VPS)
```bash
ssh root@<VPS_IP>

# Check frontend running
sudo systemctl status yeastar-vite

# Check Nginx
sudo nginx -t
sudo systemctl status nginx

# Check logs
tail -f /var/log/nginx/calls.nosteq.co.ke_error.log
```

### Tunnel Connection Drops
```bash
# Check tunnel is running
pm2 status

# Restart tunnel
pm2 restart ssh-tunnel

# Check network
ping <VPS_IP>
ssh -i ~/.ssh/vps_tunnel root@<VPS_IP> "echo 'OK'"
```

---

## 📋 CHECKLIST: Before Going Live

### Local Machine
- [ ] PM2 installed globally
- [ ] ecosystem.config.js created
- [ ] SSH key generated (~/.ssh/vps_tunnel)
- [ ] pm2 start ecosystem.config.js runs without errors
- [ ] pm2 status shows all 3 services "online"
- [ ] curl http://localhost:2003/api/health returns {"status":"ok"}
- [ ] Database exists: ./public/local-agent/sms.db
- [ ] TG400 Gateway accessible (ping test)
- [ ] S100 PBX accessible (ping test)

### VPS Setup
- [ ] SSH key copied to ~/.ssh/authorized_keys
- [ ] Repository cloned to /opt/yeastar-sms-connect
- [ ] npm install completed
- [ ] npm run build completed successfully
- [ ] .env.production configured correctly
- [ ] yeastar-vite systemd service running
- [ ] Nginx configured and reloaded
- [ ] SSL certificate installed and valid
- [ ] sudo netstat -tlnp | grep 2003 shows tunnel listening

### Connectivity
- [ ] SSH to VPS works without password
- [ ] curl http://127.0.0.1:2003/api/health works from VPS
- [ ] pm2 logs ssh-tunnel shows "connected"
- [ ] https://calls.nosteq.co.ke loads in browser
- [ ] https://calls.nosteq.co.ke/api/health returns 200
- [ ] SSL certificate shows green lock in browser

### Final Tests
- [ ] Dashboard loads
- [ ] Can view gateway status
- [ ] Can view PBX status
- [ ] Send test SMS - appears in dashboard
- [ ] Make test call - appears in dashboard
- [ ] All data populates correctly
- [ ] Analytics show data

---

## 🎉 Deployment Complete!

Your system is now running in production with:
- ✅ Local API server managed by PM2
- ✅ Secure SSH tunnel for API communication
- ✅ Frontend hosted on VPS with HTTPS
- ✅ Auto-restart on crashes
- ✅ Auto-start on server reboot

**Monitor it with:**
```bash
# Local machine - real-time monitoring
pm2 monit

# Or view logs
pm2 logs
```

---

## 📞 Support

For issues, check logs:
```bash
# Local machine
pm2 logs

# VPS
ssh root@<VPS_IP> "tail -f /var/log/nginx/calls.nosteq.co.ke_error.log"
```

Script auto-restarts services on failure. System runs 24/7 without manual intervention.

**Last Updated:** 2026-02-24
