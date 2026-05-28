import { pool } from './db';

/**
 * Run safe migrations — adds columns that exist in the schema but may be missing in the DB.
 * Uses ADD COLUMN IF NOT EXISTS so it's idempotent.
 */
export async function runMigrations() {
  const migrations = [
    // site_reports table columns added over time
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS labor_count INTEGER DEFAULT 0`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS labor_details TEXT`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS sqft_covered TEXT`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS labor_data JSONB`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS materials_used TEXT`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS location_lat TEXT`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS location_lng TEXT`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS email_recipients TEXT`,
    `ALTER TABLE site_reports ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
    // Time Entries
    `ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS key_step TEXT`,
    // Daily Plans
    `CREATE TABLE IF NOT EXISTS daily_plans (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id VARCHAR NOT NULL,
      date TEXT NOT NULL,
      submitted_at TIMESTAMP DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS plan_tasks (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      plan_id VARCHAR NOT NULL,
      task_id VARCHAR NOT NULL,
      project_name TEXT,
      task_name TEXT NOT NULL,
      is_deviation BOOLEAN DEFAULT false,
      deviation_reason TEXT,
      status TEXT DEFAULT 'approved',
      source TEXT DEFAULT 'Manual',
      is_locked BOOLEAN DEFAULT false,
      schedule_data JSONB
    )`,
    `ALTER TABLE plan_tasks ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'Manual'`,
    `ALTER TABLE plan_tasks ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false`,
    `ALTER TABLE plan_tasks ADD COLUMN IF NOT EXISTS schedule_data JSONB`,
    `CREATE TABLE IF NOT EXISTS daily_submissions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id VARCHAR NOT NULL,
      date TEXT NOT NULL,
      total_hours TEXT NOT NULL,
      submitted_at TIMESTAMP DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS alerts (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id VARCHAR NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      date TEXT,
      is_read BOOLEAN DEFAULT false NOT NULL,
      created_at TIMESTAMP DEFAULT now() NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS daily_plan_settings (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      date TEXT NOT NULL UNIQUE,
      is_closed BOOLEAN DEFAULT false NOT NULL,
      closed_at TIMESTAMP
    )`,
    `CREATE EXTENSION IF NOT EXISTS vector`,
    `CREATE TABLE IF NOT EXISTS document_embeddings (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content     TEXT NOT NULL,
      embedding   vector(1536),
      metadata    JSONB,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS document_embeddings_embedding_idx ON document_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`,
    `CREATE TABLE IF NOT EXISTS rag_sync_state (
      data_type   VARCHAR PRIMARY KEY,
      last_sync_at TIMESTAMP DEFAULT '1970-01-01 00:00:00'::timestamp NOT NULL
    )`,
    `CREATE OR REPLACE FUNCTION upsert_embedding(
      p_content TEXT,
      p_embedding vector(1536),
      p_metadata JSONB
    ) RETURNS VOID AS $$
    BEGIN
      DELETE FROM document_embeddings 
      WHERE (metadata->>'record_id') = p_metadata->>'record_id' 
        AND (metadata->>'source_db') = p_metadata->>'source_db' 
        AND (metadata->>'data_type') = p_metadata->>'data_type';

      INSERT INTO document_embeddings (content, embedding, metadata)
      VALUES (p_content, p_embedding, p_metadata);
    END;
    $$ LANGUAGE plpgsql;`
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
      console.log(`[MIGRATE] ✅ ${sql.substring(0, 60)}...`);
    } catch (err: any) {
      console.error(`[MIGRATE] ❌ Failed: ${sql.substring(0, 60)}...`, err.message);
    }
  }
  console.log('[MIGRATE] Database migration complete.');
}
