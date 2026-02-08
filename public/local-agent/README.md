# TG400 SMS Gateway - Local Polling Agent

## One-Line Installation (Ubuntu 20.04 - 25.04)

```bash
curl -fsSL https://id-preview--02b61bbc-2d1a-4cc5-b544-9f855adac829.lovable.app/local-agent/install.sh | sudo bash
```

## What Gets Installed

- **Node.js 20 LTS** - Automatically installed from NodeSource
- **TG400 Agent** - Installed to `/opt/tg400-agent/`
- **Systemd Service** - Auto-start on boot
- **Helper Commands** - Easy management tools

## Quick Start

After installation:

```bash
# 1. Configure your gateway
sudo tg400-config

# 2. Start the agent
sudo systemctl start tg400-agent

# 3. Check it's running
tg400-status
```

## Available Commands

| Command | Description |
|---------|-------------|
| `sudo tg400-config` | Interactive configuration wizard |
| `tg400-status` | Show agent status and recent logs |
| `tg400-logs` | Follow live logs (Ctrl+C to exit) |
| `tg400-restart` | Restart the agent |
| `tg400-test` | Test gateway & cloud connection |
| `tg400-update` | Manually pull updates from GitHub |

## Manual Installation

If automatic installation fails:

```bash
# Download installer
wget https://id-preview--02b61bbc-2d1a-4cc5-b544-9f855adac829.lovable.app/local-agent/install.sh

# Make executable
chmod +x install.sh

# Run installer
sudo ./install.sh
```

## Configuration

Edit `/opt/tg400-agent/config.json`:

```json
{
  "TG400_IP": "192.168.5.3",
  "TG400_USERNAME": "admin",
  "TG400_PASSWORD": "your-password",
  "TG400_PORTS": [1, 2, 3, 4],
  "POLL_INTERVAL": 30000,
  "GITHUB_REPO_URL": "https://github.com/your-user/your-repo.git",
  "REPO_DIR": "/opt/tg400-repo",
  "AUTO_UPDATE_ENABLED": true
}
```

### Git Auto-Update

The agent pulls from your GitHub repo every 5 minutes. When it detects changes to the agent script, it automatically:
1. Creates a backup of the current version
2. Copies the new version from the repo
3. Restarts itself via systemd
4. Logs the update to the cloud dashboard

To manually trigger an update: `tg400-update`

## Troubleshooting

### Cannot connect to gateway

```bash
# Test network connectivity
ping 192.168.5.3

# Test API access
curl -u admin:password http://192.168.5.3/api/v1.0/system/status
```

### Agent not starting

```bash
# Check detailed logs
journalctl -u tg400-agent -n 50

# Test manually
cd /opt/tg400-agent
node agent.js --test
```

### Permission issues

```bash
# Fix permissions
sudo chown -R root:root /opt/tg400-agent
sudo chmod 600 /opt/tg400-agent/config.json
```

## Uninstallation

```bash
sudo systemctl stop tg400-agent
sudo systemctl disable tg400-agent
sudo rm /etc/systemd/system/tg400-agent.service
sudo rm -rf /opt/tg400-agent
sudo rm /usr/local/bin/tg400-*
sudo systemctl daemon-reload
```

## Requirements

- Ubuntu 20.04, 22.04, 24.04, or 25.04
- Root/sudo access
- Network access to TG400 gateway
- Internet access for cloud sync
