# Yeastar SMS Connect - Production Setup Guide

## Architecture Overview

```
┌─────────────────────┐                    ┌──────────────────────┐
│   RDP Server        │                    │   VPS (86.48.5.84)   │
│  (Development)      │                    │  (Production)        │
│                     │                    │                      │
│  • API Server       │                    │  • Nginx Proxy       │
│    (Port 2003)      │────SSH Tunnel────▶ │    (Port 443/80)     │
│  • Vite Dev         │      (Port 3003)   │  • Frontend (8081)   │
│    (Port 8081)      │                    │  • SSL Certificate   │
│  • PM2 Manager      │                    │  • calls.nosteq.co.ke│
└─────────────────────┘                    └──────────────────────┘
       ↑                                             ↑
       └─────────────────────────────────────────────┘
              Users access via HTTPS
           calls.nosteq.co.ke:443
```

---

## Prerequisites

### RDP Server Requirements
- **OS**: Ubuntu/Linux or Windows with WSL2
- **Node.js**: v18+ (installed)
- **PM2**: Installed globally (`npm install -g pm2`)
- **Git**: For cloning repository
- **SSH Client**: For SSH tunnel
- **SSH Key**: `~/.ssh/vps_tunnel` (private key with VPS access)

### VPS Requirements
- **Server**: 86.48.5.84 (Port 2025 for SSH)
- **SSL**: Let's Encrypt certificate for calls.nosteq.co.ke
- **Nginx**: Reverse proxy configured
- **Frontend**: Built and ready to serve

---

## Step-by-Step RDP Setup

### 1. Clone Repository

```bash
cd ~/
git clone https://github.com/enterprisealxtexh/yeastar-sms-connect.git
cd yeastar-sms-connect
npm install
```

### 2. Setup SSH Key

Copy the SSH private key to your RDP server:
```bash
mkdir -p ~/.ssh
# Copy vps_tunnel key to ~/.ssh/vps_tunnel
# Set correct permissions
chmod 600 ~/.ssh/vps_tunnel
```

### 3. Create PM2 Ecosystem Config

Create `ecosystem.config.cjs` in project root:

```bash
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [
    {
      name: 'yeastar-dev',
      script: 'npm',
      args: 'run dev:full',
      watch: false
    },
    {
      name: 'ssh-tunnel',
      script: 'bash',
      args: '-c "ssh -p 2025 -i ~/.ssh/vps_tunnel -N -R 3003:127.0.0.1:2003 root@86.48.5.84"',
      watch: false,
      restart_delay: 5000,
      autorestart: true
    }
  ]
};
EOF
```

### 4. Start with PM2

```bash
# Delete any existing processes
pm2 delete all

# Start applications
pm2 start ecosystem.config.cjs

# Save for auto-start on reboot
pm2 save
pm2 startup

# View logs
pm2 logs
```

### 5. Verify Status

```bash
# Check process status
pm2 status

# Test API server
curl http://localhost:2003/api/health

# Test SSH tunnel connection
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 "curl -s http://127.0.0.1:3003/api/health"

# Test public access
curl https://calls.nosteq.co.ke/api/health -k
```

---

## VPS Setup (One-time Configuration)

### 1. Deploy Frontend

```bash
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 << 'EOF'
cd /root/yeastar-sms-connect
git clone https://github.com/enterprisealxtexh/yeastar-sms-connect.git
cd yeastar-sms-connect
npm install

# Create production environment
cat > .env.production << 'ENV'
VITE_API_URL="https://calls.nosteq.co.ke"
SMS_DB_PATH="/root/yeastar-sms-connect/public/local-agent/sms.db"
API_PORT=8081
API_HOST="0.0.0.0"
LOG_LEVEL="info"
CORS_ORIGIN="*"
ENV

# Build frontend
npm run build
EOF
```

### 2. Configure Nginx

Create `/etc/nginx/sites-available/calls.nosteq.co.ke`:

```bash
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 << 'EOF'
cat > /etc/nginx/sites-available/calls.nosteq.co.ke << 'NGINX'
# HTTP redirect to HTTPS
server {
    listen 80;
    server_name calls.nosteq.co.ke;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name calls.nosteq.co.ke;
    
    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/calls.nosteq.co.ke/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calls.nosteq.co.ke/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # HSTS Header
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Frontend (served on port 8081)
    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # API proxy (tunneled from RDP server on port 3003)
    location /api {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
}
NGINX

# Enable site
ln -s /etc/nginx/sites-available/calls.nosteq.co.ke /etc/nginx/sites-enabled/

# Test and reload
nginx -t
systemctl reload nginx
EOF
```

### 3. Setup Frontend Server

```bash
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 << 'EOF'
cat > /tmp/serve-dist.js << 'SERVE'
const http = require('http');
const fs = require('fs');
const path = require('path');

const distPath = '/root/yeastar-sms-connect/dist';
const server = http.createServer((req, res) => {
  let filePath = path.join(distPath, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  let contentType = 'text/html';
  if (ext === '.js') contentType = 'text/javascript';
  else if (ext === '.css') contentType = 'text/css';
  else if (ext === '.json') contentType = 'application/json';
  else if (ext === '.svg') contentType = 'image/svg+xml';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(8081, '0.0.0.0', () => {
  console.log('Frontend server listening on http://0.0.0.0:8081');
});
SERVE

# Start frontend server in background
nohup node /tmp/serve-dist.js > /tmp/frontend.log 2>&1 &
EOF
```

### 4. SSL Certificate (If needed)

```bash
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 << 'EOF'
# Install certbot
apt-get update && apt-get install -y certbot python3-certbot-nginx

# Get certificate for calls.nosteq.co.ke
certbot certonly --nginx -d calls.nosteq.co.ke

# Enable auto-renewal
systemctl enable certbot.timer
EOF
```

---

## SSH Tunnel Details

### How It Works

The SSH reverse tunnel forwards RDP's port 2003 (API) through VPS port 3003:

```
RDP (localhost:2003) ──SSH─── VPS (127.0.0.1:3003)
     API Server                  Nginx proxies to
                                 calls.nosteq.co.ke/api
```

### Manual SSH Tunnel (If needed)

```bash
# Start tunnel on RDP
ssh -p 2025 -i ~/.ssh/vps_tunnel -N -R 3003:127.0.0.1:2003 root@86.48.5.84

# It will hang (that's normal - it's forwarding)
# Keep it running in background or use PM2
```

### Troubleshoot SSH Tunnel

```bash
# Check if tunnel is connected
ps aux | grep "ssh.*3003" | grep -v grep

# View tunnel logs
pm2 logs ssh-tunnel

# Restart tunnel
pm2 restart ssh-tunnel

# Check VPS side
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 "netstat -tlnp | grep 3003"
```

---

## PM2 Management

### Essential Commands

```bash
# View all processes
pm2 status
pm2 list

# View real-time logs
pm2 logs
pm2 logs yeastar-dev
pm2 logs ssh-tunnel

# Restart process
pm2 restart yeastar-dev
pm2 restart ssh-tunnel
pm2 restart all

# Stop/Start
pm2 stop all
pm2 start all

# Delete process
pm2 delete yeastar-dev

# View process details
pm2 show yeastar-dev
pm2 show ssh-tunnel

# Auto-start on reboot
pm2 startup
pm2 save

# Disable auto-start
pm2 unstartup
```

---

## Verification Checklist

### Step 1: RDP Services Running
```bash
pm2 status
# Both should show "online"
```

### Step 2: API Server Responsive
```bash
curl http://localhost:2003/api/health
# Should return: {"status":"ok",...}
```

### Step 3: SSH Tunnel Connected
```bash
ps aux | grep "ssh.*3003" | grep -v grep
# Should show active SSH process
```

### Step 4: VPS Can See RDP API
```bash
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 "curl -s http://127.0.0.1:3003/api/health"
# Should return JSON response
```

### Step 5: Public Access Works
```bash
curl https://calls.nosteq.co.ke/api/health -k
# Should return: {"status":"ok",...}

# Open in browser
https://calls.nosteq.co.ke
# Should load the dashboard
```

---

## Development Workflow

### Making Code Changes

1. **Edit code on RDP** (using IDE/SSH)
2. **Vite auto-rebuilds** (watches for changes)
3. **Refresh browser** to see changes
4. **API picks up changes** automatically

### Viewing Logs

```bash
# Real-time development logs
pm2 logs yeastar-dev

# Follow specific log
pm2 logs yeastar-dev --lines 100 --follow
```

### Restarting Services

```bash
# Restart API/Vite
pm2 restart yeastar-dev

# Restart tunnel (if connection lost)
pm2 restart ssh-tunnel
```

---

## Troubleshooting

### Issue: SSH Tunnel Not Connecting

**Solution:**
```bash
# Check SSH key permissions
chmod 600 ~/.ssh/vps_tunnel

# Verify VPS connectivity
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 "echo 'Connected'"

# Restart tunnel
pm2 restart ssh-tunnel
pm2 logs ssh-tunnel
```

### Issue: API Not Responding

**Solution:**
```bash
# Check if API server running
curl http://localhost:2003/api/health

# Restart API
pm2 restart yeastar-dev
pm2 logs yeastar-dev

# Check port is listening
lsof -i :2003
```

### Issue: Frontend Returns HTML Instead of JSON

**Solution:**
- This means API is not reachable
- Check SSH tunnel is connected: `ps aux | grep ssh | grep 3003`
- Check RDP API is running: `curl http://localhost:2003/api/health`
- Verify Nginx config on VPS: `ssh root@86.48.5.84 "nginx -t"`

### Issue: SSL Certificate Error

**Solution:**
```bash
# SSH to VPS and check certificate
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84

# View certificate status
certbot certificates

# Renew if needed
certbot renew

# Check Nginx is using correct paths
cat /etc/nginx/sites-available/calls.nosteq.co.ke | grep ssl_
```

### Issue: Vite Hot Module Reload Not Working

**Solution:**
- This is expected in production via SSH tunnel
- Hard refresh browser (Ctrl+F5 or Cmd+Shift+R)
- Restart PM2: `pm2 restart yeastar-dev`

---

## Maintenance

### Regular Tasks

```bash
# Check PM2 status daily
pm2 status

# Monitor logs for errors
pm2 logs

# Update Node packages (on RDP)
npm update

# Check disk space on VPS
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 "df -h"

# Check database size
ls -lh /root/yeastar-sms-connect/public/local-agent/sms.db
```

### Backup

```bash
# Backup database on VPS
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 << 'EOF'
cp /root/yeastar-sms-connect/public/local-agent/sms.db \
   /root/yeastar-sms-connect/public/local-agent/sms.db.backup
EOF

# Copy to local for safekeeping (from RDP)
scp -P 2025 -i ~/.ssh/vps_tunnel \
  root@86.48.5.84:/root/yeastar-sms-connect/public/local-agent/sms.db.backup \
  ~/backups/sms-db-$(date +%Y%m%d).db
```

### Updates

```bash
# Pull latest code (on RDP)
cd ~/yeastar-sms-connect
git pull origin main
npm install
pm2 restart yeastar-dev

# Update on VPS if needed
ssh -p 2025 -i ~/.ssh/vps_tunnel root@86.48.5.84 << 'EOF'
cd /root/yeastar-sms-connect
git pull origin main
npm run build
EOF
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Start all | `pm2 start ecosystem.config.cjs` |
| Stop all | `pm2 stop all` |
| Restart all | `pm2 restart all` |
| View status | `pm2 status` |
| View logs | `pm2 logs` |
| Test API | `curl http://localhost:2003/api/health` |
| Test public access | `curl https://calls.nosteq.co.ke/api/health -k` |
| Check tunnel | `ps aux \| grep ssh \| grep 3003` |
| View Nginx config | `cat /etc/nginx/sites-available/calls.nosteq.co.ke` |
| Reload Nginx | `ssh root@86.48.5.84 "systemctl reload nginx"` |

---

## Support

For issues or questions:
1. Check logs: `pm2 logs`
2. Verify connectivity: Test commands from verification checklist
3. Review troubleshooting section above
4. Check system resources: `pm2 monit`

---

**Last Updated:** February 26, 2026
**Status:** Production Ready ✅




