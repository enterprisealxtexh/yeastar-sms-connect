module.exports = {
  apps: [
    {
      name: 'api-server',
      script: 'public/local-agent/api-server.cjs',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production',
        API_PORT: 2003,
        API_HOST: '127.0.0.1',
        LOG_LEVEL: 'info',
        SMS_DB_PATH: '/opt/yeastar-sms-connect/data/sms.db',
      },
      error_file: 'logs/api-server.error.log',
      out_file: 'logs/api-server.out.log',
      log_file: 'logs/api-server.log',
      time: true,
      autorestart: true,
      max_memory_restart: '512M',
      watch: false,
    },
    {
      name: 'tg400-agent',
      script: 'public/local-agent/tg400-tcp-api.cjs',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },
      error_file: 'logs/tg400-agent.error.log',
      out_file: 'logs/tg400-agent.out.log',
      log_file: 'logs/tg400-agent.log',
      time: true,
      autorestart: true,
      watch: false,
    },
    // Frontend is served by Nginx from /opt/yeastar-sms-connect/dist
    // API proxied by Nginx /api/ → localhost:2003
  ],
};
