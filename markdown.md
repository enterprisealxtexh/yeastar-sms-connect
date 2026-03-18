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

```bash
sudo tee /etc/nginx/sites-available/calls.nosteq.co.ke > /dev/null <<'NGINX'
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
    gzip_min_length 1000;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:2003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_send_timeout 300;
        proxy_read_timeout 300;
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

Follow prompts. Auto-renewal enabled by default.

## Start PM2 Services

```bash
cd /opt/yeastar-sms-connect
sudo pm2 start ecosystem.config.cjs --env production
sudo pm2 save
sudo pm2 startup systemd -u root --hp /root
```

## Verify

```bash
curl http://127.0.0.1:2003/api/health
pm2 status
sudo systemctl status nginx
```

Open: https://calls.nosteq.co.ke

## Update Deployment

```bash
cd /opt/yeastar-sms-connect
sudo git pull origin main
sudo npm install
sudo npm run build
sudo pm2 reload ecosystem.config.cjs
sudo systemctl reload nginx
```

## Logs

```bash
pm2 logs
pm2 logs api-server
sudo tail -f /var/log/nginx/calls.nosteq.co.ke_error.log
```