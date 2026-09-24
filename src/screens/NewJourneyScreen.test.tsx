import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { NewJourneyScreen } from './NewJourneyScreen';
import { getDefaultSettings } from '../db/settingsRepo';
import { createJourney, ActiveJourneyExistsError, getActiveJourney, finishJourney } from '../db/journeysRepo';
import { startTracking, stopTracking } from '../location/locationService';
import { haversineDistanceM } from '../geo/haversine';

jest.setTimeout(45000);

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/settingsRepo');
jest.mock('../db/journeysRepo');
jest.mock('../location/locationService');
jest.mock('expo-location');
jest.mock('expo-battery', () => ({ getBatteryLevelAsync: jest.fn().mockResolvedValue(1) }));
jest.mock('@rnmapbox/maps', () => ({
  MapView: 'MapboxMapView',
  Camera: 'MapboxCamera',
  PointAnnotation: 'MapboxPointAnnotation',
}));
// jest.mock('../location/locationService') is an automock: Jest still requires
// the real module first to learn its shape, which pulls in
// locationService -> backgroundTask -> alarmManager -> '@notifee/react-native'.
// That native module throws immediately when not linked (see alarmManager.test.ts
// and WelcomeScreen.test.tsx for the same requirement), so it needs its own
// explicit mock even though none of its functions are ever called here.
jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('caller-man-alarm'),
  displayNotification: jest.fn().mockResolvedValue('notif-id'),
  AndroidImportance: { HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { ALARM: 'alarm' },
}));

const defaults = {
  radiusM: 10000, maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
};

// Mirrors the screen's destination placeholder (PLACEHOLDER_DEST_LAT/LNG),
// kept distinct so the radius cap isn't degenerately zero: ~30km away from
// the default mocked current-location fix below, which caps the radius at
// ~12km — comfortably above the 10km default radius, so it's unclamped in
// most tests.
const PLACEHOLDER_DEST_LAT = 51.7774;
const PLACEHOLDER_DEST_LNG = -0.1278;
const MOCK_USER_COORDS = { latitude: 51.5074, longitude: -0.1278 };

beforeEach(() => {
  jest.clearAllMocks();
  (getDefaultSettings as jest.Mock).mockResolvedValue({ ...defaults });
  (getActiveJourney as jest.Mock).mockResolvedValue(null);
  (finishJourney as jest.Mock).mockResolvedValue(undefined);
  (stopTracking as jest.Mock).mockResolvedValue(undefined);
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: MOCK_USER_COORDS });
  (Battery.getBatteryLevelAsync as jest.Mock).mockResolvedValue(1);
});

test('shows an alert and does not navigate when a journey is already active', async () => {
  (createJourney as jest.Mock).mockRejectedValue(new ActiveJourneyExistsError());
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(createJourney).toHaveBeenCalled(), { timeout: 20000 });
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(startTracking).not.toHaveBeenCalled();
});

test('starting a journey creates it, starts tracking, and navigates to CurrentJourney', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 42, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('CurrentJourney', { journeyId: 42 }), { timeout: 20000 });
  expect(startTracking).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
});

test('creates the journey with a meters-based radius, the real computed distance, and defaults-derived fields', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 5, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(createJourney).toHaveBeenCalled(), { timeout: 20000 });

  const expectedDistanceM = haversineDistanceM(
    { lat: MOCK_USER_COORDS.latitude, lng: MOCK_USER_COORDS.longitude },
    { lat: PLACEHOLDER_DEST_LAT, lng: PLACEHOLDER_DEST_LNG }
  );

  expect(createJourney).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      radiusM: 10000, // defaults.radiusM in meters, unclamped (cap ~12km > 10km)
      initialDistanceM: expectedDistanceM,
      snoozeMinutes: defaults.snoozeMinutes,
      gpsLossGraceMinutes: defaults.gpsLossGraceMinutes,
      batteryCutoffPct: defaults.batteryCutoffPct, // battery at 100% -> no cap, default unchanged
      destinationLat: PLACEHOLDER_DEST_LAT,
      destinationLng: PLACEHOLDER_DEST_LNG,
    })
  );
});

test('a custom battery cutoff value above the cap is clamped to the cap', async () => {
  (Battery.getBatteryLevelAsync as jest.Mock).mockResolvedValue(0.1); // 10% < default 15% -> cap = max(0, 10-5) = 5
  (createJourney as jest.Mock).mockResolvedValue({ id: 1, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByTestId, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });

  fireEvent(getByTestId('batteryCutoffSlider-switch'), 'valueChange', true);
  const input = getByTestId('batteryCutoffSlider-input');
  fireEvent.changeText(input, '40');
  fireEvent(input, 'endEditing');

  fireEvent.press(getByText('Start Journey'));
  await waitFor(
    () =>
      expect(createJourney).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ batteryCutoffPct: 5 })
      ),
    { timeout: 20000 }
  );
});

test('disables Start and shows a message when a journey is already active on load', async () => {
  (getActiveJourney as jest.Mock).mockResolvedValue({ id: 7, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByTestId, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);

  await findByText(/only one journey can be active/i, {}, { timeout: 20000 });
  await waitFor(
    () => expect(getByTestId('startJourneyButton').props.accessibilityState?.disabled).toBe(true),
    { timeout: 20000 }
  );

  fireEvent.press(getByText('Start Journey'));
  expect(createJourney).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('cancels the journey and shows an error when starting tracking fails after creation', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 99, status: 'active' });
  (startTracking as jest.Mock).mockRejectedValue(new Error('location permission revoked'));
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(finishJourney).toHaveBeenCalledWith(expect.anything(), 99, 'cancelled'), { timeout: 20000 });
  expect(stopTracking).toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
  await findByText(/could not start tracking/i, {}, { timeout: 20000 });
});

test('shows an error message when loading setup data fails', async () => {
  (getDefaultSettings as jest.Mock).mockRejectedValue(new Error('db unavailable'));
  const { findByText } = render(<NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />);
  await findByText(/could not load journey setup/i, {}, { timeout: 20000 });
});

test('disables Start and shows a message when the destination is at the current location (zero radius cap)', async () => {
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { latitude: PLACEHOLDER_DEST_LAT, longitude: PLACEHOLDER_DEST_LNG },
  });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByTestId, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);

  await findByText('Destination is too close', {}, { timeout: 20000 });
  await waitFor(
    () => expect(getByTestId('startJourneyButton').props.accessibilityState?.disabled).toBe(true),
    { timeout: 20000 }
  );

  fireEvent.press(getByText('Start Journey'));
  expect(createJourney).not.toHaveBeenCalled();
});

test('shows an error and Retry when fetching the current location fails, and does not render Start', async () => {
  (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('permission denied'));
  const { findByText, queryByText } = render(<NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />);
  await findByText(/could not load journey setup/i, {}, { timeout: 20000 });
  expect(await findByText('Retry', {}, { timeout: 20000 })).toBeTruthy();
  expect(queryByText('Start Journey')).toBeNull();
});

test('shows a loading state while the current-location fix is pending', async () => {
  let resolvePosition: (value: { coords: typeof MOCK_USER_COORDS }) => void = () => {};
  (Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolvePosition = resolve;
    })
  );
  const { findByText } = render(<NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />);

  await findByText('Getting your location…', {}, { timeout: 20000 });

  // Resolve and let the form finish loading so nothing is left pending when
  // the test (and its mocks) tear down.
  resolvePosition({ coords: MOCK_USER_COORDS });
  await findByText('Start Journey', {}, { timeout: 20000 });
});

test('reverts the latitude field to the current destination when a commit is out of range', async () => {
  const navigation = { replace: jest.fn() } as any;
  const { getByTestId, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });

  const latInput = getByTestId('destLatInput');
  expect(latInput.props.value).toBe(String(PLACEHOLDER_DEST_LAT));

  fireEvent.changeText(latInput, '200');
  fireEvent(latInput, 'endEditing');

  await waitFor(() => expect(getByTestId('destLatInput').props.value).toBe(String(PLACEHOLDER_DEST_LAT)), {
    timeout: 20000,
  });
});
