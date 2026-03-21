# Production Deployment - calls.nosteq.co.ke

## Install Dependencies

```bash
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx git
sudo npm install -g pm2
```

## Fresh Setup (Delete and Reinstall)

```bash
sudo pm2 delete all || true
sudo pm2 save || true
cd /opt
sudo rm -rf /opt/yeastar-sms-connect
sudo git clone https://github.com/enterprisealxtexh/yeastar-sms-connect.git yeastar-sms-connect
cd yeastar-sms-connect
sudo npm install
sudo npm run build
```

## Create Nginx Config

> **Routing behaviour:**
> - `calls.nosteq.co.ke/` → loads the Yeastar SMS Connect login page
> - `calls.nosteq.co.ke/support/rating/<token>` and `calls.nosteq.co.ke/rate/<token>` → public customer rating pages
> - `calls.nosteq.co.ke/api/` → proxied to Node.js API on port 2003

```bash
sudo cp /opt/yeastar-sms-connect/nginx.conf /etc/nginx/sites-available/calls.nosteq.co.ke
```

Or create it manually:

```bash
sudo tee /etc/nginx/sites-available/calls.nosteq.co.ke > /dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name calls.nosteq.co.ke;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    access_log /var/log/nginx/calls.nosteq.co.ke_access.log;
    error_log  /var/log/nginx/calls.nosteq.co.ke_error.log;

    add_header X-Frame-Options        DENY                              always;
    add_header X-Content-Type-Options nosniff                           always;
    add_header X-XSS-Protection       "1; mode=block"                   always;
    add_header Referrer-Policy        "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;

    # Static assets
    location ^~ /assets/ {
        alias /opt/yeastar-sms-connect/dist/assets/;
        try_files $uri =404;
        access_log off;
        expires 7d;
        add_header Cache-Control "public, max-age=604800, immutable";
    }

    # React SPA at root
    location / {
        root /opt/yeastar-sms-connect/dist;
        try_files $uri $uri/ /index.html;
    }

    # /api/ → Node.js API server
    location /api/ {
        proxy_pass         http://127.0.0.1:2003;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout    60s;
        proxy_send_timeout    60s;
        proxy_buffering    off;
    }

    # Deny hidden files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
NGINX
```

## Enable Nginx

```bash
sudo ln -sf /etc/nginx/sites-available/calls.nosteq.co.ke /etc/nginx/sites-enabled/calls.nosteq.co.ke
sudo nginx -t
sudo systemctl reload nginx
```

## SSL Certificate via Certbot

```bash
sudo certbot --nginx -d calls.nosteq.co.ke
```

Follow prompts. Certbot will inject the HTTPS (443) server block and HTTP->HTTPS redirect automatically. Auto-renewal is enabled by default.

## Start PM2 Services

> **Note:** Nginx serves the React `dist/` folder directly — no `serve`/frontend PM2 process needed.
> The `api-server`, `tg400-agent`, and `sms-worker` processes run under PM2.

```bash
cd /opt/yeastar-sms-connect
sudo pm2 delete all || true
sudo pm2 start ecosystem.config.cjs --only api-server,tg400-agent,sms-worker --env production
sudo pm2 save
sudo pm2 startup systemd -u root --hp /root
# Run the command it prints to enable auto-start on reboot
```

## Verify

```bash
curl http://127.0.0.1:2003/api/health
pm2 status
sudo systemctl status nginx
```
rm /home/alxtexh/yeastar-sms-connect/logs/yeastar_sms.db
rm /home/alxtexh/yeastar-sms-connect/logs/db.sqlite3
rm /home/alxtexh/yeastar-sms-connect/public/local-agent/database.db
rm /home/alxtexh/yeastar-sms-connect/public/local-agent/sms-gateway.db
# dist/ files will be regenerated on next build
Open internal app: https://calls.nosteq.co.ke/
Open public rating page: https://calls.nosteq.co.ke/support/rating/<token>

## Reinstall Fresh (Any Time)

```bash
sudo pm2 delete all || true
sudo pm2 save || true
cd /opt/yeastar-sms-connect
cd /opt
sudo rm -rf /opt/yeastar-sms-connect
sudo git clone https://github.com/enterprisealxtexh/yeastar-sms-connect.git yeastar-sms-connect
cd /opt/yeastar-sms-connect
sudo npm install
sudo npm run build
sudo pm2 start ecosystem.config.cjs --only api-server,tg400-agent,sms-worker --env production
sudo pm2 save
sudo systemctl reload nginx
```

## Logs

```bash
pm2 logs
pm2 logs api-server
sudo tail -f /var/log/nginx/calls.nosteq.co.ke_error.log
```



# Local setup
```bash
pm2 delete all
pm2 start ecosystem.dev.config.cjs --env development
```
```bash

```