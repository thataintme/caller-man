import { Db } from './types';
import { DefaultSettings } from '../types/journey';

interface SettingsRow {
  radius_m: number;
  max_poll_freq: number;
  min_poll_freq: number;
  alarm_tune: string;
  battery_cutoff_pct: number;
  snooze_minutes: number;
  gps_loss_grace_minutes: number;
}

function rowToSettings(row: SettingsRow): DefaultSettings {
  return {
    radiusM: row.radius_m,
    maxPollFreqPerMin: row.max_poll_freq,
    minPollFreqPerMin: row.min_poll_freq,
    alarmTune: row.alarm_tune,
    batteryCutoffPct: row.battery_cutoff_pct,
    snoozeMinutes: row.snooze_minutes,
    gpsLossGraceMinutes: row.gps_loss_grace_minutes,
  };
}

export async function getDefaultSettings(db: Db): Promise<DefaultSettings> {
  const row = await db.getFirstAsync<SettingsRow>(`SELECT * FROM default_settings WHERE id = 1`);
  if (!row) {
    throw new Error('default_settings row missing — did migrations run?');
  }
  return rowToSettings(row);
}

export async function saveDefaultSettings(db: Db, settings: DefaultSettings): Promise<void> {
  await db.runAsync(
    `UPDATE default_settings SET
      radius_m = ?, max_poll_freq = ?, min_poll_freq = ?, alarm_tune = ?,
      battery_cutoff_pct = ?, snooze_minutes = ?, gps_loss_grace_minutes = ?
     WHERE id = 1`,
    [
      settings.radiusM,
      settings.maxPollFreqPerMin,
      settings.minPollFreqPerMin,
      settings.alarmTune,
      settings.batteryCutoffPct,
      settings.snoozeMinutes,
      settings.gpsLossGraceMinutes,
    ]
  );
}
