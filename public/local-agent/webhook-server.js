const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');

const PORT = 9000;
const SECRET = process.env.GITHUB_WEBHOOK_SECRET || 'your-secret-here';
const LOG_FILE = '/opt/yeastar-deploy/webhook.log';

function log(msg) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${msg}\n`;
    console.log(logMsg);
    fs.appendFileSync(LOG_FILE, logMsg);
}

function verifySignature(req, body) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) {
        log('WARNING: No signature provided');
        return false;
    }

    const hash = crypto
        .createHmac('sha256', SECRET)
        .update(body)
        .digest('hex');

    const expected = `sha256=${hash}`;
    const valid = crypto.timingSafeEqual(signature, expected);
    
    if (!valid) {
        log('ERROR: Invalid signature');
    }
    
    return valid;
}

const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
    }

    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
        // Verify signature
        if (!verifySignature(req, body)) {
            res.writeHead(401);
            res.end('Unauthorized');
            return;
        }

        try {
            const payload = JSON.parse(body);
            const branch = payload.ref?.split('/').pop();

            log(`Webhook triggered for branch: ${branch}`);

            // Only deploy if push to main or production
            if (branch !== 'main' && branch !== 'production') {
                log(`Skipping deploy for branch: ${branch}`);
                res.writeHead(200);
                res.end('Skipped - not main/production branch');
                return;
            }

            log(`Starting deployment for branch: ${branch}`);

            // Run deployment script
            exec('/opt/yeastar-deploy/deploy.sh', (error, stdout, stderr) => {
                if (error) {
                    log(`DEPLOY ERROR: ${error.message}`);
                    log(`STDERR: ${stderr}`);
                } else {
                    log(`DEPLOY SUCCESS`);
                }
            });

            res.writeHead(200);
            res.end('Deployment triggered');

        } catch (e) {
            log(`ERROR: Invalid JSON payload - ${e.message}`);
            res.writeHead(400);
            res.end('Invalid payload');
        }
    });
});

server.listen(PORT, '127.0.0.1', () => {
    log(`Webhook server listening on port ${PORT}`);
});
