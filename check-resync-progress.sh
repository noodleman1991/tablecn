#!/bin/bash
# Quick command to check resync progress
# Usage: bash check-resync-progress.sh

# Check if resync is running
if pgrep -f "resume-resync.mjs" > /dev/null; then
    echo "✅ Resync is running"
    echo ""
    echo "Latest progress:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    # This will show you the running process output
    # For now, just check the database
    echo ""
    echo "Checking database for total attendees created..."
    node -e "
    import pg from 'pg';
    import { createRequire } from 'module';
    const require = createRequire(import.meta.url);
    const dotenv = require('dotenv');
    dotenv.config();
    const { Client } = pg;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const result = await client.query('SELECT COUNT(*) as count FROM tablecn_attendees');
    console.log(\`Total attendees in database: \${result.rows[0].count}\`);
    await client.end();
    " 2>/dev/null || echo "Unable to query database"
else
    echo "❌ Resync is not running"
    echo ""
    echo "To start resync from event 184:"
    echo "  node resume-resync.mjs 184"
fi
