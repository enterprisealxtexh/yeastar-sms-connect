# Deployment Guide - calls.nosteq.co.ke (Single VPS)

## 📋 Simple Architecture

```
VPS (calls.nosteq.co.ke)
├─ Nginx (reverse proxy, port 80/443)
├─ Frontend (React/Vite build, served by Nginx, port 4173)
├─ API Server (Node.js, port 2003 - local only)
├─ TG400 Agent (SMS gateway connection)
└─ PM2 (process manager)
```

All services run on one server. Nginx routes:
- `/` → Frontend (static React build)
- `/api/` → Backend API Server (localhost:2003)

---

## 🚀 VPS Setup Instructions

### 1. **SSH into VPS**
```bash
ssh root@calls.nosteq.co.ke
```

### 2. **Update System**
```bash
apt update && apt upgrade -y
```

### 3. **Install Dependencies**
```bash
apt install -y \
  nodejs npm git sqlite3 \
  nginx certbot python3-certbot-nginx \
  build-essential curl wget
```

### 4. **Verify Versions**
```bash
node --version    # Should be v18+
npm --version     # Should be 8+
nginx -v
```

### 5. **Create Application Directory**
```bash
mkdir -p /opt/yeastar-sms-connect
cd /opt/yeastar-sms-connect

# If cloning from git:
git clone https://github.com/your-username/yeastar-sms-connect.git .
```

### 6. **Install Node Packages**
```bash
npm install
```

### 7. **Install PM2 Globally**
```bash
npm install -g pm2
```

### 8. **Create Data Directory**
```bash
mkdir -p /opt/yeastar-sms-connect/data
mkdir -p /opt/yeastar-sms-connect/logs
chmod 755 /opt/yeastar-sms-connect/data
```

### 9. **Build Frontend**
```bash
npm run build

# Verify build
ls -la dist/
```

### 10. **Setup .env.production** (Already configured)
```bash
cat /opt/yeastar-sms-connect/.env.production
```

The file should have:
```
VITE_API_URL="https://calls.nosteq.co.ke/api"
API_PORT=2003
API_HOST="127.0.0.1"
```

### 11. **Start PM2 Services**
```bash
cd /opt/yeastar-sms-connect
pm2 start ecosystem.config.js

# Check status
pm2 status

# Save for auto-restart
pm2 save
pm2 startup
```

Expected output:
```
┌────┬──────────────┬──────────┬──────┬─────────┬──────────┐
│ id │ name         │ mode     │ ↺    │ status  │ memory   │
├────┼──────────────┼──────────┼──────┼─────────┼──────────┤
│ 0  │ api-server   │ fork     │ 0    │ online  │ 45.2mb   │
│ 1  │ tg400-agent  │ fork     │ 0    │ online  │ 32.1mb   │
└────┴──────────────┴──────────┴──────┴─────────┴──────────┘
```

### 12. **Verify API Server Running**
```bash
curl http://127.0.0.1:2003/api/health
# Should return: {"status":"ok"}
```

### 13. **Setup Nginx Reverse Proxy**

Create `/etc/nginx/sites-available/calls.nosteq.co.ke`:

```bash
cat > /etc/nginx/sites-available/calls.nosteq.co.ke << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name calls.nosteq.co.ke www.calls.nosteq.co.ke;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name calls.nosteq.co.ke www.calls.nosteq.co.ke;

    ssl_certificate /etc/letsencrypt/live/calls.nosteq.co.ke/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calls.nosteq.co.ke/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    access_log /var/log/nginx/calls.nosteq.co.ke_access.log;
    error_log /var/log/nginx/calls.nosteq.co.ke_error.log;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # Frontend - Static files from dist/
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API endpoints - Routed to backend
    location /api/ {
        proxy_pass http://127.0.0.1:2003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_send_timeout 300;
        proxy_read_timeout 300;
    }
}
EOF
```

### 14. **Enable Nginx Site**
```bash
ln -s /etc/nginx/sites-available/calls.nosteq.co.ke /etc/nginx/sites-enabled/
```

### 15. **Test Nginx Config**
```bash
nginx -t
# Should output: "syntax is ok" and "test is successful"
```

### 16. **Setup SSL Certificate**
```bash
certbot certonly --nginx \
  -d calls.nosteq.co.ke \
  -d www.calls.nosteq.co.ke \
  --non-interactive \
  --agree-tos \
  -m admin@nosteq.co.ke
```

### 17. **Start Nginx**
```bash
systemctl enable nginx
systemctl start nginx
systemctl status nginx
```

### 18. **Create Frontend Service (Alternative to Nginx proxy)**

If you want to serve the static build directly instead of through Vite preview:

```bash
npm install -g serve
```

Then update `ecosystem.config.js` to add:
```javascript
{
  name: 'frontend',
  script: 'serve',
  args: '-s dist -l 4173',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
}
```

Then reload PM2:
```bash
pm2 reload ecosystem.config.js --env production
```

---

## ✅ Verification Checklist

### Test Locally on VPS
```bash
# 1. Check API server
curl http://127.0.0.1:2003/api/health

# 2. Check frontend on Vite preview port
curl -I http://127.0.0.1:4173

# 3. Check PM2 status
pm2 status

# 4. Check Nginx is running
systemctl status nginx
```

### Test from Browser
```
https://calls.nosteq.co.ke
```

Should load the frontend. Open DevTools → Network tab. API calls should go to:
```
https://calls.nosteq.co.ke/api/...
```

### Test Nginx Routing
```bash
# From another machine or using curl
curl -I https://calls.nosteq.co.ke  # Should return frontend (200)
curl -I https://calls.nosteq.co.ke/api/health  # Should return API response
```

---

## 🔄 Common Operations

### View Logs
```bash
# API Server
pm2 logs api-server

# TG400 Agent
pm2 logs tg400-agent

# All
pm2 logs

# Nginx
tail -f /var/log/nginx/calls.nosteq.co.ke_error.log
tail -f /var/log/nginx/calls.nosteq.co.ke_access.log
```

### Restart Services
```bash
# Single service
pm2 restart api-server

# All services
pm2 restart all

# Reload (no downtime)
pm2 reload ecosystem.config.js --env production

# Nginx
systemctl reload nginx
```

### Check Port Usage
```bash
lsof -i :2003   # API
lsof -i :4173   # Frontend
lsof -i :80     # HTTP
lsof -i :443    # HTTPS
```

### Monitor Resources
```bash
pm2 monit
```

---

## 🚨 Troubleshooting

### API returns CORS errors
- Check `CORS_ORIGIN` in `.env.production`
- Should allow `https://calls.nosteq.co.ke`

### 502 Bad Gateway from Nginx
```bash
# Check if API is running
curl http://127.0.0.1:2003/api/health

# Check nginx error log
tail -f /var/log/nginx/calls.nosteq.co.ke_error.log

# Restart API
pm2 restart api-server
```

### PM2 services not auto-starting on reboot
```bash
pm2 startup systemd -u root --hp /root
pm2 save
```

### Frontend not loading
- Check `VITE_API_URL` matches domain: `https://calls.nosteq.co.ke/api`
- Check Nginx is routing `/` to port 4173
- Check `npm run build` output: `ls -la dist/`

---

## 📦 Deployment Script

To automate VPS setup, create `deploy.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Starting deployment to calls.nosteq.co.ke..."

cd /opt/yeastar-sms-connect

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building frontend..."
npm run build

echo "🔄 Restarting PM2 services..."
pm2 reload ecosystem.config.js --env production

echo "🔄 Restarting Nginx..."
systemctl reload nginx

echo "✅ Deployment complete!"
echo "🌐 Visit: https://calls.nosteq.co.ke"
```

Run once to setup, then use for updates:
```bash
bash deploy.sh
```

---

## 📝 Notes

- **Database:** Located at `/opt/yeastar-sms-connect/data/sms.db`
- **Logs:** Check `/opt/yeastar-sms-connect/logs/` and `pm2 logs`
- **SSL auto-renewal:** Certbot timer runs automatically
- **Auto-start on reboot:** PM2 systemd integration handles this
