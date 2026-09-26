import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CurrentJourneyScreen, REFRESH_INTERVAL_MS } from './CurrentJourneyScreen';
import { getActiveJourney, finishJourney } from '../db/journeysRepo';
import { getRecentFixes, pruneFixesForJourney } from '../db/locationLogRepo';
import { stopTracking } from '../location/locationService';
import notifee from '@notifee/react-native';

jest.setTimeout(45000);

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/journeysRepo');
jest.mock('../db/locationLogRepo');
jest.mock('../location/locationService');
// jest.mock('../location/locationService') is an automock: Jest still requires
// the real module first to learn its shape, which pulls in
// locationService -> backgroundTask -> alarmManager -> '@notifee/react-native'.
// That native module throws immediately when not linked (see alarmManager.test.ts
// and NewJourneyScreen.test.tsx for the same requirement), so it needs its own
// explicit mock even though none of its functions are ever called here.
jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('caller-man-alarm'),
  displayNotification: jest.fn().mockResolvedValue('notif-id'),
  cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { ALARM: 'alarm' },
}));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (cb: () => void) => cb() }));
jest.mock('@rnmapbox/maps', () => ({
  MapView: 'MapboxMapView', Camera: 'MapboxCamera', PointAnnotation: 'MapboxPointAnnotation',
  ShapeSource: 'MapboxShapeSource', FillLayer: 'MapboxFillLayer', LineLayer: 'MapboxLineLayer',
}));

const journey = {
  id: 5, name: 'Train Station', destinationLat: 0, destinationLng: 0, radiusM: 1000,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getActiveJourney as jest.Mock).mockResolvedValue(journey);
  (getRecentFixes as jest.Mock).mockResolvedValue([]);
});

test('cancelling the journey marks it cancelled, stops tracking, and navigates home', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.text === 'Cancel journey')?.onPress?.();
  });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Cancel Journey'));

  await waitFor(() => expect(finishJourney).toHaveBeenCalledWith(expect.anything(), 5, 'cancelled'), {
    timeout: 20000,
  });
  expect(pruneFixesForJourney).toHaveBeenCalledWith(expect.anything(), 5);
  expect(stopTracking).toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('Journeys');
});

test('cancels in order: stopTracking, then finishJourney, then pruneFixesForJourney', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.text === 'Cancel journey')?.onPress?.();
  });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Cancel Journey'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'), { timeout: 20000 });

  const stopOrder = (stopTracking as jest.Mock).mock.invocationCallOrder[0];
  const finishOrder = (finishJourney as jest.Mock).mock.invocationCallOrder[0];
  const pruneOrder = (pruneFixesForJourney as jest.Mock).mock.invocationCallOrder[0];
  expect(stopOrder).toBeLessThan(finishOrder);
  expect(finishOrder).toBeLessThan(pruneOrder);
});

test('cancelling silences every alert id for the journey (incl. pending snoozes) before finishing it', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.text === 'Cancel journey')?.onPress?.();
  });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Cancel Journey'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'), { timeout: 20000 });

  expect(notifee.cancelAllNotifications).toHaveBeenCalledTimes(1);
  const ids = (notifee.cancelAllNotifications as jest.Mock).mock.calls[0][0] as string[];
  expect([...ids].sort()).toEqual(['arrival-5', 'gps-loss-5', 'low-battery-5']);
  const cancelAlertsOrder = (notifee.cancelAllNotifications as jest.Mock).mock.invocationCallOrder[0];
  const finishOrder = (finishJourney as jest.Mock).mock.invocationCallOrder[0];
  expect(cancelAlertsOrder).toBeLessThan(finishOrder);
});

test('shows a cancel error and re-enables Cancel Journey when finishJourney fails partway through', async () => {
  (finishJourney as jest.Mock).mockRejectedValue(new Error('db unavailable'));
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.text === 'Cancel journey')?.onPress?.();
  });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Cancel Journey'));

  await findByText('Could not cancel the journey. Please try again.', {}, { timeout: 20000 });
  expect(navigation.replace).not.toHaveBeenCalledWith('Journeys');
  expect(pruneFixesForJourney).not.toHaveBeenCalled();

  // Button is re-enabled: pressing again re-triggers stopTracking a second time.
  fireEvent.press(getByText('Cancel Journey'));
  await waitFor(() => expect(stopTracking).toHaveBeenCalledTimes(2), { timeout: 20000 });
});

test('replaces to the Alarm screen when the active journey has already arrived', async () => {
  (getActiveJourney as jest.Mock).mockResolvedValue({ ...journey, arrivedAt: 123456 });
  const navigation = { replace: jest.fn() } as any;
  render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);

  await waitFor(
    () => expect(navigation.replace).toHaveBeenCalledWith('Alarm', { journeyId: 5, kind: 'arrival' }),
    { timeout: 20000 }
  );
  expect(navigation.replace).not.toHaveBeenCalledWith('Journeys');
});

test('navigates back to Journeys instead of rendering stale data when there is no active journey', async () => {
  (getActiveJourney as jest.Mock).mockResolvedValue(null);
  const navigation = { replace: jest.fn() } as any;
  const { queryByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'), { timeout: 20000 });
  expect(queryByText('Cancel Journey')).toBeNull();
});

test('shows an error and a working retry button when loading the journey fails', async () => {
  // mockRejectedValue (not -Once): the test's useFocusEffect mock re-invokes
  // load() on every re-render (see JourneysScreen.test.tsx for the same
  // convention), so the rejection must persist until we're ready to recover.
  (getActiveJourney as jest.Mock).mockRejectedValue(new Error('db unavailable'));
  const navigation = { replace: jest.fn() } as any;
  const { findByText, getByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);

  await findByText('Could not load the current journey. Please try again.', {}, { timeout: 20000 });

  (getActiveJourney as jest.Mock).mockResolvedValue(journey);
  fireEvent.press(getByText('Retry'));

  await findByText('Cancel Journey', {}, { timeout: 20000 });
});

test('disables the Cancel Journey button while a cancel is in flight', async () => {
  let resolveStopTracking!: () => void;
  (stopTracking as jest.Mock).mockReturnValue(
    new Promise<void>((resolve) => {
      resolveStopTracking = resolve;
    })
  );
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.text === 'Cancel journey')?.onPress?.();
  });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey', {}, { timeout: 20000 });

  fireEvent.press(getByText('Cancel Journey'));
  await waitFor(() => expect(stopTracking).toHaveBeenCalledTimes(1), { timeout: 20000 });

  // Pressing again while the cancel is still in flight must not re-trigger it.
  fireEvent.press(getByText('Cancel Journey'));
  expect(stopTracking).toHaveBeenCalledTimes(1);
  expect(finishJourney).not.toHaveBeenCalled();

  resolveStopTracking();
  await waitFor(() => expect(finishJourney).toHaveBeenCalledWith(expect.anything(), 5, 'cancelled'), {
    timeout: 20000,
  });
});

test('clears the periodic refresh interval on unmount', async () => {
  const setIntervalSpy = jest.spyOn(global, 'setInterval');
  const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
  const navigation = { replace: jest.fn() } as any;
  const { findByText, unmount } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey', {}, { timeout: 20000 });

  // Filter to intervals registered with our own cadence: the RN test
  // environment (e.g. RNTL's own findBy/waitFor polling) may register other
  // unrelated setInterval calls we don't want to assert on.
  const ownIntervalCalls = setIntervalSpy.mock.calls
    .map((args, i) => ({ ms: args[1], id: setIntervalSpy.mock.results[i].value }))
    .filter((call) => call.ms === REFRESH_INTERVAL_MS);
  expect(ownIntervalCalls.length).toBeGreaterThanOrEqual(1);
  const intervalId = ownIntervalCalls[ownIntervalCalls.length - 1].id;

  unmount();
  expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);

  setIntervalSpy.mockRestore();
  clearIntervalSpy.mockRestore();
});

test('does not update state after unmount when a load resolves late', async () => {
  let resolveFixes!: (fixes: unknown[]) => void;
  (getRecentFixes as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveFixes = resolve;
    })
  );
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  const navigation = { replace: jest.fn() } as any;
  const { findByText, unmount } = render(<CurrentJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Cancel Journey', {}, { timeout: 20000 });

  unmount();
  resolveFixes([{ lat: 1, lng: 1, recordedAt: Date.now(), speedMps: null, accuracyM: null, id: 1, journeyId: 5 }]);
  await new Promise((resolve) => setTimeout(resolve, 50));

  const unmountedWarning = consoleError.mock.calls.some((args) =>
    String(args[0]).includes('unmounted')
  );
  expect(unmountedWarning).toBe(false);

  consoleError.mockRestore();
});
