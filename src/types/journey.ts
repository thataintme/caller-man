export type JourneyStatus = 'active' | 'completed' | 'cancelled';

export interface Journey {
  id: number;
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
  lastFixAt: number | null;
  status: JourneyStatus;
  createdAt: number;
  completedAt: number | null;
  arrivedAt: number | null;
}

export interface DefaultSettings {
  radiusM: number;
  maxPollFreqPerMin: number;
  minPollFreqPerMin: number;
  alarmTune: string;
  batteryCutoffPct: number;
  snoozeMinutes: number;
  gpsLossGraceMinutes: number;
}

export interface LocationFix {
  id: number;
  journeyId: number;
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null;
  recordedAt: number;
}
