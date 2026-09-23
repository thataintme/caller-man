import { Db } from './types';
import { LocationFix } from '../types/journey';

interface LogRow {
  id: number;
  journey_id: number;
  lat: number;
  lng: number;
  speed_mps: number | null;
  accuracy_m: number | null;
  recorded_at: number;
}

function rowToFix(row: LogRow): LocationFix {
  return {
    id: row.id,
    journeyId: row.journey_id,
    lat: row.lat,
    lng: row.lng,
    speedMps: row.speed_mps,
    accuracyM: row.accuracy_m,
    recordedAt: row.recorded_at,
  };
}

export async function insertFix(
  db: Db,
  journeyId: number,
  lat: number,
  lng: number,
  speedMps: number | null,
  accuracyM: number | null,
  recordedAt: number
): Promise<void> {
  await db.runAsync(
    `INSERT INTO location_log (journey_id, lat, lng, speed_mps, accuracy_m, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [journeyId, lat, lng, speedMps, accuracyM, recordedAt]
  );
}

export async function getRecentFixes(db: Db, journeyId: number, sinceMs: number): Promise<LocationFix[]> {
  const rows = await db.getAllAsync<LogRow>(
    `SELECT * FROM location_log WHERE journey_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC`,
    [journeyId, sinceMs]
  );
  return rows.map(rowToFix);
}

export async function pruneFixesForJourney(db: Db, journeyId: number): Promise<void> {
  await db.runAsync(`DELETE FROM location_log WHERE journey_id = ?`, [journeyId]);
}
