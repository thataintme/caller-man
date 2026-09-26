import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AlarmScreen } from './AlarmScreen';
import { getJourneyById, finishJourney } from '../db/journeysRepo';
import { pruneFixesForJourney } from '../db/locationLogRepo';
import { stopTracking } from '../location/locationService';
import notifee from '@notifee/react-native';
import { scheduleSnoozedAlert } from '../alarm/alarmManager';
import { createFakeStackNavigation } from '../navigation/fakeStackNavigation.testutil';

jest.setTimeout(45000);

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/journeysRepo');
jest.mock('../db/locationLogRepo');
jest.mock('../location/locationService');
// Factory (not automock): alarmActions.ts (imported for real by this screen)
// now calls removeAreaCacheForJourney (Task 30), and offlineMapCache.ts
// imports '@rnmapbox/maps', which throws when required unmocked — same
// reason locationService above needs a factory instead of a bare automock.
jest.mock('../location/offlineMapCache', () => ({
  removeAreaCacheForJourney: jest.fn().mockResolvedValue(undefined),
}));
// Replaced (not automocked) so this test doesn't need to also stand up a full
// '@notifee/react-native' shape for alarmManager's own dependencies
// (createChannel/displayNotification/etc) — only the two functions this
// screen actually calls matter here. alarmNotificationId is a real,
// deterministic id builder (not a jest.fn()) so assertions below can compute
// the expected id the same way the screen does.
jest.mock('../alarm/alarmManager', () => ({
  scheduleSnoozedAlert: jest.fn().mockResolvedValue(undefined),
  cancelAllAlertsForJourney: jest.fn().mockResolvedValue(undefined),
  alarmNotificationId: (kind: string, journeyId: number) =>
    kind === 'arrival' ? `arrival-${journeyId}` : kind === 'gpsLoss' ? `gps-loss-${journeyId}` : `low-battery-${journeyId}`,
}));
jest.mock('@notifee/react-native', () => ({
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  cancelDisplayedNotification: jest.fn().mockResolvedValue(undefined),
}));

// A real stack (StackRouter-backed fake) with this Alarm pushed over the
// journey's tracking screen, as the foreground DELIVERED path produces.
function alarmOnTopOfTracking(kind: string) {
  return createFakeStackNavigation([
    { name: 'Journeys' },
    { name: 'CurrentJourney', params: { journeyId: 7 } },
    { name: 'Alarm', params: { journeyId: 7, kind } },
  ]);
}
const JOURNEYS_ONLY = [{ name: 'Journeys' }];
const BACK_ON_TRACKING = [{ name: 'Journeys' }, { name: 'CurrentJourney', params: { journeyId: 7 } }];

const journey = {
  id: 7,
  name: 'Station',
  destinationLat: 0,
  destinationLng: 0,
  radiusM: 200,
  maxPollFreqPerMin: 20,
  minPollFreqPerMin: 5,
  alarmTune: 'Radar Ping',
  batteryCutoffPct: 15,
  snoozeMinutes: 3,
  gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000,
  lastFixAt: null,
  status: 'active' as const,
  createdAt: 0,
  completedAt: null,
  arrivedAt: 123456,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getJourneyById as jest.Mock).mockResolvedValue(journey);
});

test('dismissing an arrival alarm cancels the notification, completes the journey, prunes fixes, stops tracking, and goes to Journeys', async () => {
  const navigation = alarmOnTopOfTracking('arrival');
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />
  );
  await findByText('Dismiss', {}, { timeout: 20000 });
  fireEvent.press(getByText('Dismiss'));

  await waitFor(() => expect(navigation.routes()).toEqual(JOURNEYS_ONLY), { timeout: 20000 });

  expect(notifee.cancelNotification).toHaveBeenCalledWith('arrival-7');
  expect(finishJourney).toHaveBeenCalledWith(expect.anything(), 7, 'completed');
  expect(pruneFixesForJourney).toHaveBeenCalledWith(expect.anything(), 7);
  expect(stopTracking).toHaveBeenCalled();

  const cancelOrder = (notifee.cancelNotification as jest.Mock).mock.invocationCallOrder[0];
  const finishOrder = (finishJourney as jest.Mock).mock.invocationCallOrder[0];
  const pruneOrder = (pruneFixesForJourney as jest.Mock).mock.invocationCallOrder[0];
  const stopOrder = (stopTracking as jest.Mock).mock.invocationCallOrder[0];
  expect(cancelOrder).toBeLessThan(finishOrder);
  expect(finishOrder).toBeLessThan(pruneOrder);
  expect(pruneOrder).toBeLessThan(stopOrder);
});

test('dismissing a GPS-loss alarm cancels the notification and returns to Current Journey without finishing the journey', async () => {
  const navigation = alarmOnTopOfTracking('gpsLoss');
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'gpsLoss' } } as any} navigation={navigation as any} />
  );
  await findByText('Dismiss', {}, { timeout: 20000 });
  fireEvent.press(getByText('Dismiss'));

  await waitFor(() => expect(navigation.routes()).toEqual(BACK_ON_TRACKING), {
    timeout: 20000,
  });
  // Only the displayed alert: gps-loss-7 is also the pending GPS-loss deadline (C1).
  expect(notifee.cancelDisplayedNotification).toHaveBeenCalledWith('gps-loss-7');
  expect(notifee.cancelNotification).not.toHaveBeenCalled();
  expect(finishJourney).not.toHaveBeenCalled();
  expect(pruneFixesForJourney).not.toHaveBeenCalled();
  expect(stopTracking).not.toHaveBeenCalled();
});

test('dismissing a low-battery alarm cancels the notification and returns to Current Journey without finishing the journey', async () => {
  const navigation = alarmOnTopOfTracking('lowBattery');
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'lowBattery' } } as any} navigation={navigation as any} />
  );
  await findByText('Dismiss', {}, { timeout: 20000 });
  fireEvent.press(getByText('Dismiss'));

  await waitFor(() => expect(navigation.routes()).toEqual(BACK_ON_TRACKING), {
    timeout: 20000,
  });
  expect(notifee.cancelNotification).toHaveBeenCalledWith('low-battery-7');
  expect(finishJourney).not.toHaveBeenCalled();
});

test('snoozing an arrival alarm cancels the notification, schedules a snoozed re-alert at snoozeMinutes from now, and goes to Journeys', async () => {
  const navigation = alarmOnTopOfTracking('arrival');
  const before = Date.now();
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />
  );
  await findByText(/Snooze/, {}, { timeout: 20000 });
  fireEvent.press(getByText(/Snooze/));

  await waitFor(() => expect(navigation.routes()).toEqual(JOURNEYS_ONLY), { timeout: 20000 });

  expect(notifee.cancelNotification).toHaveBeenCalledWith('arrival-7');
  expect(scheduleSnoozedAlert).toHaveBeenCalledTimes(1);
  const [snoozedJourney, kind, atMs] = (scheduleSnoozedAlert as jest.Mock).mock.calls[0];
  expect(snoozedJourney).toEqual(journey);
  expect(kind).toBe('arrival');
  expect(atMs).toBeGreaterThanOrEqual(before + journey.snoozeMinutes * 60_000);
  expect(atMs).toBeLessThanOrEqual(Date.now() + journey.snoozeMinutes * 60_000);
  expect(finishJourney).not.toHaveBeenCalled();
  expect(stopTracking).not.toHaveBeenCalled();
});

test('snoozing a GPS-loss alarm cancels the notification, schedules a snoozed re-alert, and returns to Current Journey', async () => {
  const navigation = alarmOnTopOfTracking('gpsLoss');
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'gpsLoss' } } as any} navigation={navigation as any} />
  );
  await findByText(/Snooze/, {}, { timeout: 20000 });
  fireEvent.press(getByText(/Snooze/));

  await waitFor(() => expect(navigation.routes()).toEqual(BACK_ON_TRACKING), {
    timeout: 20000,
  });
  expect(notifee.cancelNotification).toHaveBeenCalledWith('gps-loss-7');
  const [, kind] = (scheduleSnoozedAlert as jest.Mock).mock.calls[0];
  expect(kind).toBe('gpsLoss');
});

test('navigates to Journeys without showing the alarm when the journey cannot be found', async () => {
  (getJourneyById as jest.Mock).mockResolvedValue(null);
  const navigation = alarmOnTopOfTracking('arrival');
  const { queryByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />
  );

  await waitFor(() => expect(navigation.routes()).toEqual(JOURNEYS_ONLY), { timeout: 20000 });
  expect(queryByText('Dismiss')).toBeNull();
});

test('navigates to Journeys when the journey is no longer active (already completed elsewhere)', async () => {
  (getJourneyById as jest.Mock).mockResolvedValue({ ...journey, status: 'completed' });
  const navigation = alarmOnTopOfTracking('arrival');
  render(<AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />);

  await waitFor(() => expect(navigation.routes()).toEqual(JOURNEYS_ONLY), { timeout: 20000 });
});

test('shows an error and a working retry button when loading the journey fails', async () => {
  (getJourneyById as jest.Mock).mockRejectedValue(new Error('db unavailable'));
  const navigation = alarmOnTopOfTracking('arrival');
  const { findByText, getByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />
  );

  await findByText('Could not load this alarm. Please try again.', {}, { timeout: 20000 });

  (getJourneyById as jest.Mock).mockResolvedValue(journey);
  fireEvent.press(getByText('Retry'));

  await findByText('Dismiss', {}, { timeout: 20000 });
});

test('shows an error and re-enables the buttons when dismiss fails, without navigating away', async () => {
  (notifee.cancelNotification as jest.Mock).mockRejectedValueOnce(new Error('native error'));
  const navigation = alarmOnTopOfTracking('arrival');
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />
  );
  await findByText('Dismiss', {}, { timeout: 20000 });
  fireEvent.press(getByText('Dismiss'));

  await findByText('Could not dismiss the alarm. Please try again.', {}, { timeout: 20000 });
  expect(navigation.dispatch).not.toHaveBeenCalled();
  expect(finishJourney).not.toHaveBeenCalled();

  // Button re-enabled: pressing again retries (cancelNotification called a second time).
  fireEvent.press(getByText('Dismiss'));
  await waitFor(() => expect(notifee.cancelNotification).toHaveBeenCalledTimes(2), { timeout: 20000 });
});

test('disables Snooze and Dismiss while a dismiss is in flight', async () => {
  let resolveCancel!: () => void;
  (notifee.cancelNotification as jest.Mock).mockReturnValue(
    new Promise<void>((resolve) => {
      resolveCancel = resolve;
    })
  );
  const navigation = alarmOnTopOfTracking('arrival');
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />
  );
  await findByText('Dismiss', {}, { timeout: 20000 });
  fireEvent.press(getByText('Dismiss'));
  await waitFor(() => expect(notifee.cancelNotification).toHaveBeenCalledTimes(1), { timeout: 20000 });

  // Pressing either button again while the dismiss is still in flight must
  // not re-trigger it (buttons are disabled via the inFlight state).
  fireEvent.press(getByText('Dismiss'));
  fireEvent.press(getByText(/Snooze/));
  expect(notifee.cancelNotification).toHaveBeenCalledTimes(1);
  expect(scheduleSnoozedAlert).not.toHaveBeenCalled();

  resolveCancel();
  await waitFor(() => expect(navigation.routes()).toEqual(JOURNEYS_ONLY), { timeout: 20000 });
});

test('leaving a GPS-loss alarm with no tracking screen below replaces it with Current Journey (one instance)', async () => {
  const navigation = createFakeStackNavigation([
    { name: 'Journeys' },
    { name: 'Alarm', params: { journeyId: 7, kind: 'gpsLoss' } },
  ]);
  const { getByText, findByText } = render(
    <AlarmScreen route={{ params: { journeyId: 7, kind: 'gpsLoss' } } as any} navigation={navigation as any} />
  );
  await findByText(/Snooze/, {}, { timeout: 20000 });
  fireEvent.press(getByText(/Snooze/));

  await waitFor(() => expect(navigation.routes()).toEqual(BACK_ON_TRACKING), { timeout: 20000 });
});

test('a stale alarm opened from startup ([Journeys, Alarm]) resets to a single Journeys screen', async () => {
  (getJourneyById as jest.Mock).mockResolvedValue(null);
  const navigation = createFakeStackNavigation([
    { name: 'Journeys' },
    { name: 'Alarm', params: { journeyId: 7, kind: 'arrival' } },
  ]);
  render(<AlarmScreen route={{ params: { journeyId: 7, kind: 'arrival' } } as any} navigation={navigation as any} />);

  await waitFor(() => expect(navigation.routes()).toEqual(JOURNEYS_ONLY), { timeout: 20000 });
});
