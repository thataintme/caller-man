import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from './taskName';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney, updateLastFixAt } from '../db/journeysRepo';
import { insertFix, getRecentFixes } from '../db/locationLogRepo';
import { decideNextAction } from './decideNextAction';
import { triggerAlarm } from '../alarm/alarmManager';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Location task error', error);
    return;
  }

  try {
    const { locations } = data as { locations: Location.LocationObject[] };
    const latest = locations[locations.length - 1];
    if (!latest) return;

    const db = await getDb();
    const journey = await getActiveJourney(db);
    if (!journey) return;

    const fix = {
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      speedMps: latest.coords.speed ?? null,
      accuracyM: latest.coords.accuracy ?? null,
      recordedAt: latest.timestamp,
    };
    await insertFix(db, journey.id, fix.lat, fix.lng, fix.speedMps, fix.accuracyM, fix.recordedAt);
    await updateLastFixAt(db, journey.id, fix.recordedAt);

    const recent = await getRecentFixes(db, journey.id, fix.recordedAt - 3 * 60 * 1000);
    const action = decideNextAction(journey, fix, recent);

    if (action.type === 'alarm') {
      await triggerAlarm(journey);
      return;
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: action.nextIntervalMs,
      foregroundService: {
        notificationTitle: 'Caller Man — tracking active',
        notificationBody: `Heading to ${journey.name}`,
      },
      pausesUpdatesAutomatically: false,
    });
  } catch (taskError) {
    console.error('Location task failed', taskError);
  }
});
