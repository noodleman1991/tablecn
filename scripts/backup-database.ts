/**
 * Database Backup Script
 * Creates a JSON backup of all tables before making changes
 */

import { db } from "../src/db";
import { events, attendees, members, emailLogs, woocommerceCache, loopsSyncLog } from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";

async function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(process.cwd(), "backups");
  const backupFile = path.join(backupDir, `backup_${timestamp}.json`);

  console.log("🔄 Starting database backup...");
  console.log(`📁 Backup will be saved to: ${backupFile}`);

  try {
    // Backup all tables
    console.log("\n📊 Backing up events...");
    const eventsData = await db.select().from(events);
    console.log(`   Found ${eventsData.length} events`);

    console.log("📊 Backing up attendees...");
    const attendeesData = await db.select().from(attendees);
    console.log(`   Found ${attendeesData.length} attendees`);

    console.log("📊 Backing up members...");
    const membersData = await db.select().from(members);
    console.log(`   Found ${membersData.length} members`);

    console.log("📊 Backing up email logs...");
    const emailLogsData = await db.select().from(emailLogs);
    console.log(`   Found ${emailLogsData.length} email logs`);

    console.log("📊 Backing up WooCommerce cache...");
    const cacheData = await db.select().from(woocommerceCache);
    console.log(`   Found ${cacheData.length} cache entries`);

    console.log("📊 Backing up Loops sync log...");
    const loopsSyncData = await db.select().from(loopsSyncLog);
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

    console.log("\n✅ Backup completed successfully!");
    console.log(`📁 Backup saved to: ${backupFile}`);
    console.log(`📊 Total records backed up: ${
      eventsData.length +
      attendeesData.length +
      membersData.length +
      emailLogsData.length +
      cacheData.length +
      loopsSyncData.length
    }`);

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

Total Records: ${
      eventsData.length +
      attendeesData.length +
      membersData.length +
      emailLogsData.length +
      cacheData.length +
      loopsSyncData.length
    }
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
