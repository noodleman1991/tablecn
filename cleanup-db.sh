#!/bin/bash

# Database cleanup script
# Deletes all attendees for "Why Look at Animals" event

echo "🔌 Connecting to database..."

# Get event ID and count
psql "$DATABASE_URL" -t -A -c "SELECT id, name, woocommerce_product_id FROM tablecn_events WHERE LOWER(name) LIKE '%why look at animals%';" | while IFS='|' read -r event_id event_name product_id; do
  echo "📅 Event: $event_name"
  echo "   ID: $event_id"
  echo "   Product ID: $product_id"
  echo ""

  # Count existing attendees
  count=$(psql "$DATABASE_URL" -t -A -c "SELECT COUNT(*) FROM tablecn_attendees WHERE event_id = '$event_id';")
  echo "💾 Current attendees: $count"
  echo ""

  # Delete all attendees
  deleted=$(psql "$DATABASE_URL" -t -A -c "DELETE FROM tablecn_attendees WHERE event_id = '$event_id'; SELECT 1;")
  echo "🗑️  Deleted $count attendees"
  echo ""

  echo "✅ Cleanup complete!"
  echo ""
  echo "📋 Next steps:"
  echo "   1. Go to http://localhost:3001"
  echo "   2. Select the 'Why Look at Animals' event"
  echo "   3. Click the 'Refresh' button to resync from WooCommerce"
  echo "   4. Then run: pnpm tsx -r dotenv/config src/scripts/validate-tickets.ts"
done
