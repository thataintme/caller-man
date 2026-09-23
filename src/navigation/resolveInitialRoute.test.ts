import { resolveInitialRoute } from './resolveInitialRoute';
import { Journey } from '../types/journey';

const activeJourneyNotArrived: Journey = {
  id: 1,
  name: 'Test Journey',
  destinationLat: 37.7749,
  destinationLng: -122.4194,
  radiusM: 100,
  maxPollFreqPerMin: 60,
  minPollFreqPerMin: 1,
  alarmTune: 'default',
  batteryCutoffPct: 20,
  snoozeMinutes: 5,
  gpsLossGraceMinutes: 10,
  initialDistanceM: 5000,
  lastFixAt: null,
  status: 'active',
  createdAt: Date.now(),
  completedAt: null,
  arrivedAt: null,
};

const activeJourneyArrived: Journey = {
  ...activeJourneyNotArrived,
  id: 2,
  arrivedAt: Date.now(),
};

test('routes to Journeys when none is active', () => {
  expect(resolveInitialRoute(null)).toEqual({ name: 'Journeys' });
});

test('routes to CurrentJourney when a journey is active and not yet arrived', () => {
  expect(resolveInitialRoute(activeJourneyNotArrived)).toEqual({
    name: 'CurrentJourney',
    params: { journeyId: 1 },
  });
});

test('routes to Alarm when a journey is active and has arrived', () => {
  expect(resolveInitialRoute(activeJourneyArrived)).toEqual({
    name: 'Alarm',
    params: { journeyId: 2, kind: 'arrival' },
  });
});
