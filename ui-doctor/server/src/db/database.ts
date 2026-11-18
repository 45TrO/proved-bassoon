import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('url','image')),
    target TEXT NOT NULL,
    target_key TEXT NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS projects_target_key ON projects(target_key);

  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    target TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    result TEXT,
    overall INTEGER,
    ui INTEGER,
    ux INTEGER,
    issue_count INTEGER NOT NULL DEFAULT 0,
    thumbnail TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS analyses_project ON analyses(project_id, created_at);
  CREATE INDEX IF NOT EXISTS analyses_created ON analyses(created_at);

  CREATE TABLE IF NOT EXISTS issue_states (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','implemented','dismissed')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (analysis_id, issue_id)
  );

  CREATE TABLE IF NOT EXISTS redesigns (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    data TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS redesigns_analysis ON redesigns(analysis_id, created_at);`,
];

export type Db = DatabaseSync;

export function openDatabase(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'ui-doctor.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      version++;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
