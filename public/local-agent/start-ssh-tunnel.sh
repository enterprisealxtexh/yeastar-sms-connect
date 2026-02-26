#!/bin/bash

###############################################################################
# SSH Reverse Tunnel for Yeastar SMS Connect
# 
# This script creates a secure tunnel from your local machine (where API runs)
# to the VPS (where frontend is hosted)
#
# Usage: ./start-ssh-tunnel.sh <VPS_IP> <SSH_KEY_PATH>
# Example: ./start-ssh-tunnel.sh 45.76.123.45 ~/.ssh/vps_tunnel
###############################################################################

set -e  # Exit on error

# Configuration
VPS_IP="${1:-86.48.5.84}"  # VPS IP: 86.48.5.84
SSH_KEY="${2:-$HOME/.ssh/vps_tunnel}"
VPS_USER="root"
LOCAL_API_PORT=2003
REMOTE_BIND_PORT=2003
LOG_FILE="/tmp/yeastar-tunnel.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

###############################################################################
# Helper Functions
###############################################################################

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if ssh key exists
    if [ ! -f "$SSH_KEY" ]; then
        log_error "SSH key not found: $SSH_KEY"
        log_error "Generate it first:"
        log_error "  ssh-keygen -t rsa -b 4096 -f $SSH_KEY -N \"\""
        exit 1
    fi
    
    # Check if ssh-keyscan available
    if ! command -v ssh &> /dev/null; then
        log_error "SSH not installed"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

test_vps_connection() {
    log "Testing connection to VPS ($VPS_IP:2025)..."
    
    if ssh -p 2025 -i "$SSH_KEY" \
        -o ConnectTimeout=5 \
        -o StrictHostKeyChecking=accept-new \
        -o UserKnownHostsFile=~/.ssh/known_hosts \
        "$VPS_USER@$VPS_IP" exit &>> "$LOG_FILE"; then
        log_success "VPS connection successful"
        return 0
    else
        log_error "Cannot connect to VPS. Check:"
        log_error "  1. VPS IP is correct: $VPS_IP"
        log_error "  2. SSH key is in VPS ~/.ssh/authorized_keys"
        log_error "  3. SSH port is 2025 (not 22)"
        return 1
    fi
}

check_local_api() {
    log "Checking if API server is running on localhost:$LOCAL_API_PORT..."
    
    if timeout 3 bash -c "echo >/dev/tcp/127.0.0.1/$LOCAL_API_PORT" 2>/dev/null; then
        log_success "API server is running"
        return 0
    else
        log_warning "API server not responding on port $LOCAL_API_PORT"
        log_warning "Make sure to start it with: npm run sms:start"
        return 1
    fi
}

create_tunnel() {
    log "Creating SSH reverse tunnel..."
    log "  Local:  127.0.0.1:$LOCAL_API_PORT"
    log "  Remote: 127.0.0.1:$REMOTE_BIND_PORT on VPS ($VPS_IP)"
    
    ssh -p 2025 -i "$SSH_KEY" \
        -N \
        -R 127.0.0.1:${REMOTE_BIND_PORT}:127.0.0.1:${LOCAL_API_PORT} \
        "$VPS_USER@$VPS_IP" \
        -o StrictHostKeyChecking=accept-new \
        -o UserKnownHostsFile=~/.ssh/known_hosts \
        -o ConnectTimeout=10 \
        -o ServerAliveInterval=60 \
        -o ServerAliveCountMax=3 \
        -o ExitOnForwardFailure=yes
}

reconnect_with_backoff() {
    local wait_time=10
    while true; do
        create_tunnel
        EXIT_CODE=$?
        
        if [ $EXIT_CODE -eq 0 ]; then
            log "Tunnel closed normally"
        else
            log_error "Tunnel error (exit code: $EXIT_CODE)"
        fi
        
        log_warning "Reconnecting in ${wait_time}s... (Ctrl+C to stop)"
        sleep "$wait_time"
        
        # Increase wait time up to 5 minutes
        if [ $wait_time -lt 300 ]; then
            wait_time=$((wait_time + 10))
        fi
    done
}

###############################################################################
# Main Script
###############################################################################

main() {
    log "=========================================="
    log "Yeastar SMS Connect - SSH Tunnel"
    log "=========================================="
    log "Local API Port:  $LOCAL_API_PORT"
    log "VPS IP:          $VPS_IP"
    log "VPS User:        $VPS_USER"
    log "SSH Key:         $SSH_KEY"
    log "Log File:        $LOG_FILE"
    log "=========================================="
    
    # Run checks
    check_prerequisites || exit 1
    test_vps_connection || exit 1
    check_local_api || log_warning "Continuing anyway..."
    
    log ""
    log_success "All checks passed! Starting tunnel..."
    log ""
    
    # Start tunnel with auto-reconnect
    reconnect_with_backoff
}

# Run main function
main "$@"