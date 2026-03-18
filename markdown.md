# Production Deployment - calls.nosteq.co.ke

## Install Dependencies

```bash
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx git
sudo npm install -g pm2 serve
```

## Clone & Setup

```bash
cd /opt
sudo git clone https://github.com/enterprisealxtexh/yeastar-sms-connect.git yeastar-sms-connect
cd yeastar-sms-connect
sudo npm install
sudo npm run build
```

## Create Nginx Config

> **Routing behaviour:**
> - `calls.nosteq.co.ke/` → redirects to `https://nosteq.co.ke` (public, no app shown)
> - `calls.nosteq.co.ke/admin/` → loads the Yeastar SMS Connect React app (internal users only)
> - `calls.nosteq.co.ke/support/rating/<token>` and `calls.nosteq.co.ke/rate/<token>` → public customer rating pages (no `/admin`)
> - `calls.nosteq.co.ke/api/` → proxied to Node.js API on port 2003

```bash
sudo cp /opt/yeastar-sms-connect/nginx.conf /etc/nginx/sites-available/calls.nosteq.co.ke
```

Or create it manually:

```bash
sudo tee /etc/nginx/sites-available/calls.nosteq.co.ke > /dev/null <<'NGINX'
# Base HTTP vhost (Certbot will add HTTPS + redirect blocks automatically)
server {
    listen 80;
    listen [::]:80;
    server_name calls.nosteq.co.ke;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    access_log /var/log/nginx/calls.nosteq.co.ke_access.log;
    error_log  /var/log/nginx/calls.nosteq.co.ke_error.log;

    add_header X-Frame-Options           DENY                                  always;
    add_header X-Content-Type-Options    nosniff                               always;
    add_header X-XSS-Protection          "1; mode=block"                       always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin"     always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
    gzip_min_length 1000;

    # Root → redirect to main company website
    location = / {
        return 301 https://nosteq.co.ke;
    }

    # /admin (no slash) → /admin/
    location = /admin {
        return 301 /admin/;
    }

    # /admin/ → React SPA (internal users only)
    location /admin/ {
        alias /opt/yeastar-sms-connect/dist/;
        index index.html;
        try_files $uri $uri/ @admin_spa;

        location ~* \.(js|css|woff2?|ttf|eot|svg|png|jpg|ico|webp)$ {
            alias /opt/yeastar-sms-connect/dist/;
            expires 1y;
            add_header Cache-Control "public, immutable";
            access_log off;
        }
    }

    location @admin_spa {
        root /opt/yeastar-sms-connect/dist;
        rewrite ^ /index.html break;
    }

    # Public ratings pages (no /admin in URL)
    location ~ ^/(support/rating|rate)/ {
        root /opt/yeastar-sms-connect/dist;
        try_files /index.html =404;
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
sudo ln -s /etc/nginx/sites-available/calls.nosteq.co.ke /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl start nginx
sudo systemctl enable nginx
```

## SSL Certificate via Certbot

```bash
sudo certbot --nginx -d calls.nosteq.co.ke
```

Follow prompts. Certbot will inject the HTTPS (443) server block and HTTP->HTTPS redirect automatically. Auto-renewal is enabled by default.

## Start PM2 Services

> **Note:** Nginx serves the React `dist/` folder directly — no `serve`/frontend PM2 process needed.
> Only the `api-server` and `tg400-agent` processes run under PM2.

```bash
cd /opt/yeastar-sms-connect
sudo pm2 start ecosystem.config.cjs
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

Open internal app: https://calls.nosteq.co.ke/admin/
Open public rating page: https://calls.nosteq.co.ke/support/rating/<token>

## Update Deployment

```bash
cd /opt/yeastar-sms-connect
sudo git pull origin main
sudo npm install
sudo npm run build
sudo pm2 reload ecosystem.config.cjs --update-env
sudo systemctl reload nginx
```

## Logs

```bash
pm2 logs
pm2 logs api-server
sudo tail -f /var/log/nginx/calls.nosteq.co.ke_error.log
```