/**
 * Standalone Database Backup Script
 * Creates a JSON backup of all tables before making changes
 * Run with: node scripts/backup-database-standalone.mjs
 */

import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database connection - using the connection string directly
const DATABASE_URL = "postgresql://neondb_owner:npg_sN5tMdouFOa6@ep-tiny-mode-a941wkv7-pooler.gwc.azure.neon.tech/neondb?sslmode=require";

const sql = postgres(DATABASE_URL);

async function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(__dirname, "..", "backups");
  const backupFile = path.join(backupDir, `backup_${timestamp}.json`);

  console.log("🔄 Starting database backup...");
  console.log(`📁 Backup will be saved to: ${backupFile}`);

  try {
    // Backup all tables using raw SQL
    console.log("\n📊 Backing up events...");
    const eventsData = await sql`SELECT * FROM tablecn_events`;
    console.log(`   Found ${eventsData.length} events`);

    console.log("📊 Backing up attendees...");
    const attendeesData = await sql`SELECT * FROM tablecn_attendees`;
    console.log(`   Found ${attendeesData.length} attendees`);

    console.log("📊 Backing up members...");
    const membersData = await sql`SELECT * FROM tablecn_members`;
    console.log(`   Found ${membersData.length} members`);

    console.log("📊 Backing up email logs...");
    const emailLogsData = await sql`SELECT * FROM tablecn_email_logs`;
    console.log(`   Found ${emailLogsData.length} email logs`);

    console.log("📊 Backing up WooCommerce cache...");
    const cacheData = await sql`SELECT * FROM tablecn_woocommerce_cache`;
    console.log(`   Found ${cacheData.length} cache entries`);

    console.log("📊 Backing up Loops sync log...");
    const loopsSyncData = await sql`SELECT * FROM tablecn_loops_sync_log`;
    console.log(`   Found ${loopsSyncData.length} sync log entries`);

    // Create backup object
    const backup = {
      metadata: {
        timestamp: new Date().toISOString(),
        version: "1.0",
        tables: {
          events: eventsData.length,
          attendees: attendeesData.length,
          members: membersData.length,
          emailLogs: emailLogsData.length,
          woocommerceCache: cacheData.length,
          loopsSyncLog: loopsSyncData.length,
        },
      },
      data: {
        events: eventsData,
        attendees: attendeesData,
        members: membersData,
        emailLogs: emailLogsData,
        woocommerceCache: cacheData,
        loopsSyncLog: loopsSyncData,
      },
    };

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Write backup to file
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

    const totalRecords = eventsData.length +
      attendeesData.length +
      membersData.length +
      emailLogsData.length +
      cacheData.length +
      loopsSyncData.length;

    console.log("\n✅ Backup completed successfully!");
    console.log(`📁 Backup saved to: ${backupFile}`);
    console.log(`📊 Total records backed up: ${totalRecords}`);

    // Also create a summary file
    const summaryFile = path.join(backupDir, `backup_${timestamp}_summary.txt`);
    const summary = `
Database Backup Summary
=======================
Timestamp: ${new Date().toISOString()}
Backup File: ${backupFile}

Tables Backed Up:
- events: ${eventsData.length} records
- attendees: ${attendeesData.length} records
- members: ${membersData.length} records
- emailLogs: ${emailLogsData.length} records
- woocommerceCache: ${cacheData.length} records
- loopsSyncLog: ${loopsSyncData.length} records

Total Records: ${totalRecords}
`;
    fs.writeFileSync(summaryFile, summary);
    console.log(`📄 Summary saved to: ${summaryFile}`);

    return backupFile;
  } catch (error) {
    console.error("❌ Backup failed:", error);
    throw error;
  }
}

// Run backup
backupDatabase()
  .then((file) => {
    console.log(`\n🎉 Backup complete: ${file}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Backup failed:", error);
    process.exit(1);
  });
