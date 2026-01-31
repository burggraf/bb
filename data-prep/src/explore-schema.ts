/**
 * Explore the DuckDB database schema
 * This script examines the structure of the baseball.duckdb database
 */

import * as duckdb from 'duckdb';

const DB_PATH = '../baseball.duckdb';

function runQuery(db: duckdb.Database, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function exploreSchema() {
  const db = new duckdb.Database(DB_PATH);

  try {
    console.log('=== Baseball Database Schema Explorer ===\n');

    // List all tables
    const tables = await runQuery(db, "SHOW TABLES");
    console.log('📊 Tables:');
    tables.forEach((t: any) => console.log(`  - ${t.name}`));
    console.log('');

    // Examine the event.events table structure
    console.log('🎯 event.events table structure:');
    const eventsSchema = await runQuery(db, "DESCRIBE event.events");
    eventsSchema.forEach((col: any) => {
      console.log(`  ${col.column_name}: ${col.column_type}`);
    });
    console.log('');

    // Get sample data from events
    console.log('📝 Sample event records:');
    const sampleEvents = await runQuery(db, 'SELECT * FROM event.events LIMIT 3');
    console.log(JSON.stringify(sampleEvents, null, 2));
    console.log('');

    // Count total events
    const eventCount = await runQuery(db, 'SELECT COUNT(*) as count FROM event.events');
    console.log(`📈 Total events: ${eventCount[0].count.toLocaleString()}`);
    console.log('');

    // Check for other key tables
    const schemas = await runQuery(db, "SELECT schema_name, table_name FROM information_schema.tables WHERE table_schema NOT IN ('system', 'pg_catalog') ORDER BY schema_name, table_name");
    console.log('📚 All tables by schema:');
    const schemaMap = new Map<string, string[]>();
    schemas.forEach((s: any) => {
      if (!schemaMap.has(s.schema_name)) schemaMap.set(s.schema_name, []);
      schemaMap.get(s.schema_name)!.push(s.table_name);
    });
    for (const [schema, tables] of schemaMap.entries()) {
      console.log(`  ${schema}/`);
      tables.forEach(t => console.log(`    - ${t}`));
    }
    console.log('');

    // Check for player information
    try {
      const peopleSchema = await runQuery(db, "DESCRIBE event.people");
      console.log('👤 event.people table structure:');
      peopleSchema.forEach((col: any) => {
        console.log(`  ${col.column_name}: ${col.column_type}`);
      });
      console.log('');

      const playerCount = await runQuery(db, 'SELECT COUNT(*) as count FROM event.people');
      console.log(`👥 Total players: ${playerCount[0].count.toLocaleString()}`);
    } catch (e) {
      console.log('⚠️  event.people table not found or error:', e);
    }
    console.log('');

    // Check for team information
    try {
      const teamsSchema = await runQuery(db, "DESCRIBE event.teams");
      console.log('🏟️  event.teams table structure:');
      teamsSchema.forEach((col: any) => {
        console.log(`  ${col.column_name}: ${col.column_type}`);
      });
      console.log('');

      const teamCount = await runQuery(db, 'SELECT COUNT(*) as count FROM event.teams');
      console.log(`🏢 Total teams: ${teamCount[0].count.toLocaleString()}`);
    } catch (e) {
      console.log('⚠️  event.teams table not found or error:', e);
    }

    console.log('\n=== Exploration complete ===');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    db.close();
  }
}

exploreSchema();
