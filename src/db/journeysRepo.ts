import { Db } from './types';
import { Journey, JourneyStatus } from '../types/journey';

interface JourneyRow {
  id: number;
  name: string;
  destination_lat: number;
  destination_lng: number;
  radius_m: number;
  max_poll_freq: number;
  min_poll_freq: number;
  alarm_tune: string;
  battery_cutoff_pct: number;
  snooze_minutes: number;
  gps_loss_grace_minutes: number;
  initial_distance_m: number;
  last_fix_at: number | null;
  status: JourneyStatus;
  created_at: number;
  completed_at: number | null;
}

function rowToJourney(row: JourneyRow): Journey {
  return {
    id: row.id,
    name: row.name,
    destinationLat: row.destination_lat,
    destinationLng: row.destination_lng,
    radiusM: row.radius_m,
    maxPollFreqPerMin: row.max_poll_freq,
    minPollFreqPerMin: row.min_poll_freq,
    alarmTune: row.alarm_tune,
    batteryCutoffPct: row.battery_cutoff_pct,
    snoozeMinutes: row.snooze_minutes,
    gpsLossGraceMinutes: row.gps_loss_grace_minutes,
    initialDistanceM: row.initial_distance_m,
    lastFixAt: row.last_fix_at,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export class ActiveJourneyExistsError extends Error {
  constructor() {
    super('An active journey already exists; end it before starting a new one.');
    this.name = 'ActiveJourneyExistsError';
  }
}

export async function getActiveJourney(db: Db): Promise<Journey | null> {
  const row = await db.getFirstAsync<JourneyRow>(`SELECT * FROM journeys WHERE status = 'active' LIMIT 1`);
  return row ? rowToJourney(row) : null;
}

export async function getJourneyById(db: Db, id: number): Promise<Journey | null> {
  const row = await db.getFirstAsync<JourneyRow>(`SELECT * FROM journeys WHERE id = ?`, [id]);
  return row ? rowToJourney(row) : null;
}

export async function listJourneys(db: Db): Promise<Journey[]> {
  const rows = await db.getAllAsync<JourneyRow>(`SELECT * FROM journeys ORDER BY created_at DESC, id DESC`);
  return rows.map(rowToJourney);
}

export interface CreateJourneyInput {
  name: string;
  destinationLat: number;
  destinationLng: number;
  radiusM: number;
  maxPollFreqPerMin: number;
  minPollFreqPerMin: number;
  alarmTune: string;
  batteryCutoffPct: number;
  snoozeMinutes: number;
  gpsLossGraceMinutes: number;
  initialDistanceM: number;
}

export async function createJourney(db: Db, input: CreateJourneyInput): Promise<Journey> {
  const existing = await getActiveJourney(db);
  if (existing) {
    throw new ActiveJourneyExistsError();
  }

  const now = Date.now();
  const result = await db.runAsync(
    `INSERT INTO journeys
      (name, destination_lat, destination_lng, radius_m, max_poll_freq, min_poll_freq,
       alarm_tune, battery_cutoff_pct, snooze_minutes, gps_loss_grace_minutes,
       initial_distance_m, last_fix_at, status, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, NULL)`,
    [
      input.name,
      input.destinationLat,
      input.destinationLng,
      input.radiusM,
      input.maxPollFreqPerMin,
      input.minPollFreqPerMin,
      input.alarmTune,
      input.batteryCutoffPct,
      input.snoozeMinutes,
      input.gpsLossGraceMinutes,
      input.initialDistanceM,
      now,
    ]
  );

  const created = await getJourneyById(db, result.lastInsertRowId);
  if (!created) {
    throw new Error('Failed to read back created journey');
  }
  return created;
}

export async function finishJourney(db: Db, id: number, status: 'completed' | 'cancelled'): Promise<void> {
  await db.runAsync(`UPDATE journeys SET status = ?, completed_at = ? WHERE id = ?`, [status, Date.now(), id]);
}

export async function updateLastFixAt(db: Db, id: number, timestampMs: number): Promise<void> {
  await db.runAsync(`UPDATE journeys SET last_fix_at = ? WHERE id = ?`, [timestampMs, id]);
}
