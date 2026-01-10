#!/bin/bash
# Monitor sync progress in real-time
# Usage: ./monitor-sync.sh

echo "🔍 Monitoring sync progress..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

while true; do
  # Count how many events have been processed (look for ✓ Processed)
  PROCESSED=$(ps aux | grep "[n]ode resume-resync" | wc -l)

  if [ "$PROCESSED" -eq 0 ]; then
    echo "❌ Script not running"
    exit 1
  fi

  # Show CPU and memory usage
  ps aux | grep "[n]ode resume-resync" | awk '{printf "CPU: %s%% | Memory: %s%%\n", $3, $4}'

  # Show last few lines of output if running
  echo ""
  echo "Last activity:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Sleep and repeat
  sleep 10
  clear
  echo "🔍 Monitoring sync progress (updates every 10s)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
done
