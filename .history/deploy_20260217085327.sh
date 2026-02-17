#!/bin/bash

#############################################################
# Yeastar SMS Connect - Automated Deployment Script
# Domain: calls.alxtexh.top
# Usage: sudo bash deploy.sh
#############################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN="calls.alxtexh.top"
APP_DIR="/opt/yeastar-sms-connect"
DB_DIR="/var/lib/yeastar-sms-connect"
BACKUP_DIR="/var/backups/yeastar-sms-connect"
API_PORT=2003
VITE_PORT=5173

# Functions
print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
    print_error "This script must be run as root"
    exit 1
fi

#############################################################
# 1. Update System
#############################################################
print_header "Step 1: Updating System Packages"

apt update && apt upgrade -y
apt install -y git curl wget nginx certbot python3-certbot-nginx sqlite3 build-essential htop

print_success "System packages updated"

#############################################################
# 2. Install Node.js
#############################################################
print_header "Step 2: Installing Node.js"

if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
    print_success "Node.js installed: $(node --version)"
else
    print_info "Node.js already installed: $(node --version)"
fi

#############################################################
# 3. Setup Application Directory
#############################################################
print_header "Step 3: Setting Up Application Directory"

if [ ! -d "$APP_DIR" ]; then
    mkdir -p "$APP_DIR"
    print_success "Created directory: $APP_DIR"
else
    print_info "Directory already exists: $APP_DIR"
fi

# Copy application files (assuming we're running from same directory)
if [ -f "package.json" ]; then
    print_info "Found package.json in current directory"
    print_info "IMPORTANT: You need to manually clone/copy the repository to $APP_DIR"
    print_info "Or provide the repo URL to clone"
    read -p "Enter Git repository URL (leave blank to skip): " REPO_URL
    
    if [ ! -z "$REPO_URL" ]; then
        print_info "Cloning repository..."
        cd "$APP_DIR"
        git clone "$REPO_URL" .
        print_success "Repository cloned"
    fi
fi

#############################################################
# 4. Create Environment File
#############################################################
print_header "Step 4: Creating Environment Configuration"

if [ ! -f "$APP_DIR/.env.production" ]; then
    cat > "$APP_DIR/.env.production" << 'EOF'
NODE_ENV=production
API_PORT=2003
VITE_API_URL=https://calls.alxtexh.top
SMS_DB_PATH=/var/lib/yeastar-sms-connect/sms.db

# Gateway Configuration - CHANGE THESE TO YOUR ACTUAL VALUES
GATEWAY_IP=192.168.1.100
GATEWAY_PORT=5038
GATEWAY_API_USERNAME=admin
GATEWAY_API_PASSWORD=admin

# PBX Configuration - CHANGE THESE TO YOUR ACTUAL VALUES
PBX_IP=192.168.1.101
PBX_PORT=8088
PBX_USERNAME=admin
PBX_PASSWORD=your_pbx_password

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
EOF
    
    print_success "Created .env.production"
    print_info "IMPORTANT: Edit $APP_DIR/.env.production with your actual configuration"
else
    print_info ".env.production already exists"
fi

#############################################################
# 5. Install Dependencies
#############################################################
print_header "Step 5: Installing Node.js Dependencies"

cd "$APP_DIR"
if [ ! -d "node_modules" ]; then
    npm install
    print_success "Dependencies installed"
else
    print_info "Dependencies already installed"
fi

#############################################################
# 6. Build Frontend
#############################################################
print_header "Step 6: Building Frontend"

if [ -f "vite.config.ts" ]; then
    npm run build
    print_success "Frontend built successfully"
else
    print_error "vite.config.ts not found"
fi

#############################################################
# 7. Setup Database Directory
#############################################################
print_header "Step 7: Setting Up Database"

mkdir -p "$DB_DIR"
mkdir -p "$BACKUP_DIR"
chown nobody:nogroup "$DB_DIR" "$BACKUP_DIR"
chmod 755 "$DB_DIR" "$BACKUP_DIR"

print_success "Database directory created: $DB_DIR"

#############################################################
# 8. Create Backup Script
#############################################################
print_header "Step 8: Setting Up Automated Backups"

cat > /usr/local/bin/backup-yeastar-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/yeastar-sms-connect"
DB_FILE="/var/lib/yeastar-sms-connect/sms.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sms_db_$TIMESTAMP.sqlite3"

if [ -f "$DB_FILE" ]; then
    cp "$DB_FILE" "$BACKUP_FILE"
    find "$BACKUP_DIR" -name "sms_db_*.sqlite3" -mtime +30 -delete
    echo "Database backed up to $BACKUP_FILE"
fi
EOF

chmod +x /usr/local/bin/backup-yeastar-db.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-yeastar-db.sh") | crontab -

print_success "Backup script installed"

#############################################################
# 9. Setup SSL Certificate
#############################################################
print_header "Step 9: Setting Up SSL Certificate"

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    print_info "Generating SSL certificate for $DOMAIN..."
    certbot certonly --standalone \
        -d "$DOMAIN" \
        -d "www.$DOMAIN" \
        --agree-tos \
        -m "admin@alxtexh.top" \
        --non-interactive || print_error "SSL certificate generation failed"
    
    print_success "SSL certificate generated"
else
    print_info "SSL certificate already exists"
fi

# Setup auto-renewal
systemctl enable certbot.timer 2>/dev/null || true
systemctl start certbot.timer 2>/dev/null || true

print_success "SSL auto-renewal configured"

#############################################################
# 10. Create Systemd Services
#############################################################
print_header "Step 10: Creating Systemd Services"

# API Service
cat > /etc/systemd/system/yeastar-api.service << 'EOF'
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

Restart=on-failure
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=yeastar-api

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Frontend Service
cat > /etc/systemd/system/yeastar-vite.service << 'EOF'
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

Restart=on-failure
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=yeastar-vite

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
print_success "Systemd services created"

#############################################################
# 11. Configure Nginx Reverse Proxy
#############################################################
print_header "Step 11: Configuring Nginx Reverse Proxy"

cat > /etc/nginx/sites-available/$DOMAIN << 'EOF'
# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name calls.alxtexh.top www.calls.alxtexh.top;
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name calls.alxtexh.top www.calls.alxtexh.top;

    ssl_certificate /etc/letsencrypt/live/calls.alxtexh.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/calls.alxtexh.top/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    access_log /var/log/nginx/calls.alxtexh.top_access.log;
    error_log /var/log/nginx/calls.alxtexh.top_error.log;

    root /opt/yeastar-sms-connect/dist;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;

    location / {
        try_files $uri $uri/ /index.html;
        proxy_pass http://localhost:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

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

    location /health {
        proxy_pass http://localhost:2003;
        access_log off;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/ 2>/dev/null || true

# Test and reload
nginx -t && systemctl reload nginx
systemctl enable nginx

print_success "Nginx configured and reloaded"

#############################################################
# 12. Setup Firewall
#############################################################
print_header "Step 12: Configuring Firewall"

if command -v ufw &> /dev/null; then
    ufw enable || true
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    print_success "UFW firewall configured"
else
    print_info "UFW not available, skipping firewall setup"
fi

#############################################################
# 13. Start Services
#############################################################
print_header "Step 13: Starting Services"

systemctl start yeastar-api
systemctl enable yeastar-api
sleep 2
systemctl start yeastar-vite
systemctl enable yeastar-vite

print_success "Services started"

# Check status
sleep 2
if systemctl is-active --quiet yeastar-api; then
    print_success "yeastar-api is running"
else
    print_error "yeastar-api failed to start - check logs with: sudo journalctl -u yeastar-api"
fi

if systemctl is-active --quiet yeastar-vite; then
    print_success "yeastar-vite is running"
else
    print_error "yeastar-vite failed to start - check logs with: sudo journalctl -u yeastar-vite"
fi

#############################################################
# 14. Summary
#############################################################
print_header "Deployment Complete!"

echo ""
echo -e "${GREEN}✓ All services installed and configured${NC}"
echo ""
echo "Next Steps:"
echo "1. Edit configuration: nano $APP_DIR/.env.production"
echo "2. Update Gateway IP, Port, and Credentials"
echo "3. Update PBX IP, Port, and Credentials"
echo "4. Visit https://$DOMAIN in your browser"
echo ""
echo "Useful Commands:"
echo "  Check status: sudo systemctl status yeastar-api yeastar-vite"
echo "  View logs: sudo journalctl -u yeastar-api -f"
echo "  Restart services: sudo systemctl restart yeastar-api yeastar-vite"
echo "  Manual backup: /usr/local/bin/backup-yeastar-db.sh"
echo ""
echo -e "${YELLOW}IMPORTANT: Edit .env.production with your actual Gateway and PBX settings!${NC}"
echo ""
