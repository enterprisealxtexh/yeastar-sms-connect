module.exports = {
  apps: [
    {
      name: 'yeastar-full',
      script: 'npm',
      args: 'run dev:full',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'ssh-tunnel',
      script: './public/local-agent/start-ssh-tunnel.sh',
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
