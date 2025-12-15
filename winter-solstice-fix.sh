#!/bin/bash

echo "🔍 Finding Winter Solstice event ID..."
echo ""

# Get the event ID from the app by checking the page
EVENT_ID=$(curl -s 'http://localhost:3000' | grep -oE 'eventId=[^"&]*' | head -1 | cut -d'=' -f2)

if [ -z "$EVENT_ID" ]; then
  echo "❌ Could not find event ID. Please provide it manually."
  echo ""
  echo "To find the event ID:"
  echo "  1. Navigate to http://localhost:3000"
  echo "  2. Select 'Winter Solstice' from the dropdown"
  echo "  3. Copy the eventId from the URL: ?eventId=XXXXX"
  echo ""
  read -p "Enter Winter Solstice event ID: " EVENT_ID
fi

if [ -z "$EVENT_ID" ]; then
  echo "❌ No event ID provided. Exiting."
  exit 1
fi

echo "✅ Using event ID: $EVENT_ID"
echo ""

# Run cleanup
echo "🧹 Cleaning up duplicates for Winter Solstice..."
CLEANUP_RESULT=$(curl -s -X POST http://localhost:3000/api/cleanup-duplicates \
  -H "Content-Type: application/json" \
  -d "{\"eventId\":\"$EVENT_ID\"}")

echo "$CLEANUP_RESULT" | python3 -m json.tool 2>/dev/null || echo "$CLEANUP_RESULT"
echo ""

# Check if cleanup was successful
if echo "$CLEANUP_RESULT" | grep -q '"success":true'; then
  echo "✅ Cleanup successful!"
  echo ""
  echo "📝 Next steps:"
  echo "  1. Open http://localhost:3000/?eventId=$EVENT_ID"
  echo "  2. Page load will trigger automatic re-sync"
  echo "  3. Open browser console (F12) to watch the sync logs"
  echo "  4. Look for:"
  echo "     [DEBUG] Extracted ticket: uid=..., ticketId=17577, email=..."
  echo "     [sync-attendees] Sync complete: 36 created, 0 updated"
  echo "  5. Verify exactly 36 attendees appear in the table"
  echo ""
  echo "🎯 Expected:"
  echo "  - 36 attendees total"
  echo "  - Multi-ticket orders show DIFFERENT names/emails"
  echo "  - Ticket IDs like '17577', '17578' (not '4640-1')"
  echo ""
else
  echo "❌ Cleanup failed. Check the error above."
  exit 1
fi
