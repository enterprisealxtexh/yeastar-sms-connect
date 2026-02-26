#!/bin/bash

REPO_DIR="/opt/yeastar-sms-connect"
LOG_FILE="/opt/yeastar-deploy/deploy.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
SSH_KEY="/root/.ssh/github_deploy_key"

log_msg() {
    echo "[$TIMESTAMP] $1" >> $LOG_FILE
    echo "$1"
}

log_msg "========== DEPLOYMENT STARTED =========="

cd $REPO_DIR || { log_msg "ERROR: Cannot cd to $REPO_DIR"; exit 1; }

# Backup current build
log_msg "Backing up current build..."
if [ -d "dist_backup" ]; then
    rm -rf dist_backup
fi
if [ -d "dist" ]; then
    mv dist dist_backup
fi

# Configure SSH for git operations
export GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# Pull latest code
log_msg "Pulling latest code from GitHub using SSH key..."
git fetch origin
if [ $? -ne 0 ]; then
    log_msg "ERROR: Git fetch failed"
    [ -d "dist_backup" ] && mv dist_backup dist
    exit 1
fi

git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)
if [ $? -ne 0 ]; then
    log_msg "ERROR: Git reset failed"
    [ -d "dist_backup" ] && mv dist_backup dist
    exit 1
fi

# Install dependencies
log_msg "Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    log_msg "ERROR: npm install failed"
    [ -d "dist_backup" ] && mv dist_backup dist
    exit 1
fi

# Build
log_msg "Building project..."
npm run build
if [ $? -ne 0 ]; then
    log_msg "ERROR: Build failed"
    [ -d "dist_backup" ] && mv dist_backup dist
    exit 1
fi

# Reload Nginx
log_msg "Reloading Nginx..."
sudo systemctl reload nginx
if [ $? -ne 0 ]; then
    log_msg "ERROR: Nginx reload failed"
    exit 1
fi

log_msg "========== DEPLOYMENT COMPLETED SUCCESSFULLY =========="
log_msg "Changes live at: https://calls.nosteq.co.ke"
log_msg ""
