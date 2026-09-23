import { Db } from './types';

export async function runMigrations(db: Db): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS journeys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      destination_lat REAL NOT NULL,
      destination_lng REAL NOT NULL,
      radius_m REAL NOT NULL,
      max_poll_freq REAL NOT NULL,
      min_poll_freq REAL NOT NULL,
      alarm_tune TEXT NOT NULL,
      battery_cutoff_pct REAL NOT NULL,
      snooze_minutes REAL NOT NULL,
      gps_loss_grace_minutes REAL NOT NULL,
      initial_distance_m REAL NOT NULL,
      last_fix_at INTEGER,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      arrived_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS default_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      radius_m REAL NOT NULL,
      max_poll_freq REAL NOT NULL,
      min_poll_freq REAL NOT NULL,
      alarm_tune TEXT NOT NULL,
      battery_cutoff_pct REAL NOT NULL,
      snooze_minutes REAL NOT NULL,
      gps_loss_grace_minutes REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS location_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journey_id INTEGER NOT NULL REFERENCES journeys(id),
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      speed_mps REAL,
      accuracy_m REAL,
      recorded_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_location_log_journey ON location_log(journey_id, recorded_at);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_journeys_one_active ON journeys(status) WHERE status = 'active';

    INSERT OR IGNORE INTO default_settings
      (id, radius_m, max_poll_freq, min_poll_freq, alarm_tune, battery_cutoff_pct, snooze_minutes, gps_loss_grace_minutes)
    VALUES (1, 10000, 20, 5, 'Radar Ping', 15, 3, 2);
  `);
}
