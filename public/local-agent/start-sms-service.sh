#!/bin/bash

# TG400 SMS Background Service Starter
# Runs the SMS listener as a detached background process

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/sms-service.log"
PID_FILE="$SCRIPT_DIR/sms-service.pid"

# Function to stop existing service
stop_service() {
    if [ -f "$PID_FILE" ]; then
        local PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "Stopping existing SMS service (PID: $PID)..."
            kill "$PID"
            sleep 2
            # Force kill if still running
            if kill -0 "$PID" 2>/dev/null; then
                kill -9 "$PID"
                echo "Force stopped service"
            fi
        fi
        rm -f "$PID_FILE"
    fi
    
    # Also kill any lingering processes
    pkill -f "api-server.cjs" 2>/dev/null || true
    echo "Cleaned up any existing processes"
}

# Function to check if port is available
check_port_available() {
    if netstat -tuln 2>/dev/null | grep -q ":2003 "; then
        return 1  # Port in use
    fi
    # Fallback for systems without netstat
    if lsof -iTCP:2003 -sTCP:LISTEN 2>/dev/null | grep -q node; then
        return 1  # Port in use
    fi
    return 0  # Port available
}

# Function to wait for service to be ready (with health check)
wait_for_service() {
    local max_attempts=30
    local attempt=0
    local port=2003
    
    echo "⏳ Waiting for SMS service to be ready..."
    
    while [ $attempt -lt $max_attempts ]; do
        # Check if process is still alive
        if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "❌ Service process died (PID file: $(cat "$PID_FILE" 2>/dev/null))"
            echo "📋 Last logs:"
            tail -n 20 "$LOG_FILE"
            return 1
        fi
        
        # Try to reach health endpoint
        if curl -s http://localhost:$port/api/health > /dev/null 2>&1; then
            echo "✅ SMS Service is healthy and ready on port $port"
            return 0
        fi
        
        attempt=$((attempt + 1))
        echo -n "."
        sleep 0.5
    done
    
    echo ""
    echo "❌ Service failed to respond after ${max_attempts} attempts"
    echo "📋 Last logs:"
    tail -n 20 "$LOG_FILE"
    return 1
}

# Function to start service
start_service() {
    echo "Starting TG400 SMS Service..."
    echo "Log file: $LOG_FILE"
    
    # Check if port is already in use
    if ! check_port_available; then
        echo "⚠️  Port 2003 is already in use. Cleaning up..."
        pkill -f "api-server.cjs" 2>/dev/null || true
        sleep 1
    fi
    
    # Start the service in background
    cd "$SCRIPT_DIR/../.."
    nohup node "$SCRIPT_DIR/api-server.cjs" > "$LOG_FILE" 2>&1 &
    
    # Save PID
    local service_pid=$!
    echo $service_pid > "$PID_FILE"
    
    echo "SMS Service process started (PID: $service_pid)"
    
    # Wait for service to be fully ready
    if wait_for_service; then
        echo "✅ SMS Service is ready!"
        return 0
    else
        echo "❌ Failed to start SMS Service"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to check status
check_status() {
    if [ -f "$PID_FILE" ]; then
        local PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "✅ SMS Service is running (PID: $PID)"
            echo "📡 Check connection: curl http://localhost:2003/api/health"
            return 0
        else
            echo "❌ SMS Service PID file exists but process is dead"
            rm -f "$PID_FILE"
            return 1
        fi
    else
        echo "❌ SMS Service is not running"
        return 1
    fi
}

# Function to show logs
show_logs() {
    if [ -f "$LOG_FILE" ]; then
        echo "=== Last 50 lines of SMS Service logs ==="
        tail -n 50 "$LOG_FILE"
        echo ""
        echo "Monitor live: tail -f $LOG_FILE"
    else
        echo "No log file found at $LOG_FILE"
    fi
}

# Parse command
case "${1:-start}" in
    start)
        stop_service
        start_service
        ;;
    stop)
        stop_service
        echo "SMS Service stopped"
        ;;
    restart)
        stop_service
        sleep 1
        start_service
        ;;
    status)
        check_status
        ;;
    logs)
        show_logs
        ;;
    follow)
        if [ -f "$LOG_FILE" ]; then
            tail -f "$LOG_FILE"
        else
            echo "No log file found. Start the service first."
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|follow}"
        echo ""
        echo "Commands:"
        echo "  start   - Start SMS service in background"
        echo "  stop    - Stop SMS service"
        echo "  restart - Restart SMS service" 
        echo "  status  - Check if service is running"
        echo "  logs    - Show recent logs"
        echo "  follow  - Follow logs in real-time"
        exit 1
        ;;
esac