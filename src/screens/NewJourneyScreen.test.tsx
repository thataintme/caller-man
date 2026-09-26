import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { NewJourneyScreen } from './NewJourneyScreen';
import { getDefaultSettings } from '../db/settingsRepo';
import { createJourney, ActiveJourneyExistsError, getActiveJourney, finishJourney } from '../db/journeysRepo';
import { startTracking, stopTracking } from '../location/locationService';
import { haversineDistanceM } from '../geo/haversine';
import { searchDestination } from '../location/geocode';
import { cacheAreaForJourney } from '../location/offlineMapCache';
import { isMapboxTokenConfigured } from '../constants/mapbox';
import { SliderWithCustomInput } from '../components/SliderWithCustomInput';

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
jest.mock('../location/geocode');
jest.mock('../location/offlineMapCache');
jest.mock('../constants/mapbox', () => ({
  MAPBOX_ACCESS_TOKEN: 'test-token',
  isMapboxTokenConfigured: jest.fn(),
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

// The destination most tests type in (M2: there is no preselected
// destination any more): ~30km away from the default mocked current-location
// fix below, which caps the radius at ~12km — comfortably above the 10km
// default radius, so it's unclamped in most tests.
const PLACEHOLDER_DEST_LAT = 51.7774;
const PLACEHOLDER_DEST_LNG = -0.1278;
const MOCK_USER_COORDS = { latitude: 51.5074, longitude: -0.1278 };

// Chooses a destination by typing coordinates (one of the three ways to pick
// one, with search and tapping the map) — Start stays disabled until then.
function chooseDestination(
  getByTestId: (id: string) => any,
  lat: number = PLACEHOLDER_DEST_LAT,
  lng: number = PLACEHOLDER_DEST_LNG
) {
  const latInput = getByTestId('destLatInput');
  fireEvent.changeText(latInput, String(lat));
  fireEvent(latInput, 'endEditing');
  const lngInput = getByTestId('destLngInput');
  fireEvent.changeText(lngInput, String(lng));
  fireEvent(lngInput, 'endEditing');
}

beforeEach(() => {
  jest.clearAllMocks();
  (getDefaultSettings as jest.Mock).mockResolvedValue({ ...defaults });
  (getActiveJourney as jest.Mock).mockResolvedValue(null);
  (finishJourney as jest.Mock).mockResolvedValue(undefined);
  (stopTracking as jest.Mock).mockResolvedValue(undefined);
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: MOCK_USER_COORDS });
  (Battery.getBatteryLevelAsync as jest.Mock).mockResolvedValue(1);
  (isMapboxTokenConfigured as jest.Mock).mockReturnValue(true);
});

test('shows an alert and does not navigate when a journey is already active', async () => {
  (createJourney as jest.Mock).mockRejectedValue(new ActiveJourneyExistsError());
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText, getByTestId } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  chooseDestination(getByTestId);
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(createJourney).toHaveBeenCalled(), { timeout: 20000 });
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(startTracking).not.toHaveBeenCalled();
});

test('starting a journey creates it, starts tracking, and navigates to CurrentJourney', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 42, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText, getByTestId } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  chooseDestination(getByTestId);
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('CurrentJourney', { journeyId: 42 }), { timeout: 20000 });
  expect(startTracking).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
});

test('caches the journey area for offline use after tracking starts, with the real user position', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 42, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText, getByTestId } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  chooseDestination(getByTestId);
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalled(), { timeout: 20000 });
  expect(cacheAreaForJourney).toHaveBeenCalledWith(
    expect.objectContaining({ id: 42 }),
    MOCK_USER_COORDS.latitude,
    MOCK_USER_COORDS.longitude
  );
});

// R30.2: caching is fire-and-forget — a slow/failed cache download must
// never delay or block navigating to CurrentJourney, and never surface as an
// error on this screen (the real cacheAreaForJourney already swallows its
// own errors; this guards the call site too, since it doesn't await it).
test('navigates to CurrentJourney even when caching the area fails', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 42, status: 'active' });
  (cacheAreaForJourney as jest.Mock).mockRejectedValue(new Error('offline'));
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText, queryByText, getByTestId } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  chooseDestination(getByTestId);
  fireEvent.press(getByText('Start Journey'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('CurrentJourney', { journeyId: 42 }), {
    timeout: 20000,
  });
  expect(queryByText(/could not/i)).toBeNull();
});

test('creates the journey with a meters-based radius, the real computed distance, and defaults-derived fields', async () => {
  (createJourney as jest.Mock).mockResolvedValue({ id: 5, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText, getByTestId } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  chooseDestination(getByTestId);
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
  chooseDestination(getByTestId);

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
  const { getByText, findByText, getByTestId } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  chooseDestination(getByTestId);
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
  await findByText('Start Journey', {}, { timeout: 20000 });
  chooseDestination(getByTestId);

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

  chooseDestination(getByTestId);
  const latInput = getByTestId('destLatInput');
  await waitFor(() => expect(getByTestId('destLatInput').props.value).toBe(String(PLACEHOLDER_DEST_LAT)));

  fireEvent.changeText(latInput, '200');
  fireEvent(latInput, 'endEditing');

  await waitFor(() => expect(getByTestId('destLatInput').props.value).toBe(String(PLACEHOLDER_DEST_LAT)), {
    timeout: 20000,
  });
});

test('searching for a destination moves the pin to the first result and lists it', async () => {
  (searchDestination as jest.Mock).mockResolvedValue([
    { lat: 51.47, lng: -0.4543, placeName: 'Heathrow Terminal 5' },
  ]);
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getAllByText, getByPlaceholderText, findByDisplayValue, findByText } = render(
    <NewJourneyScreen navigation={navigation} route={{} as any} />
  );
  await findByText('Start Journey', {}, { timeout: 20000 });

  fireEvent.changeText(getByPlaceholderText('e.g. Heathrow Terminal 5'), 'Heathrow');
  fireEvent.press(getByText('Go'));

  await waitFor(() => expect(searchDestination).toHaveBeenCalledWith('Heathrow', expect.any(String)));
  expect(await findByDisplayValue('51.47')).toBeTruthy();
  await waitFor(() => expect(getAllByText('Heathrow Terminal 5').length).toBeGreaterThanOrEqual(1));
});

test('disables Go and shows a busy state while a search is in flight', async () => {
  let resolveSearch: (value: any) => void = () => {};
  (searchDestination as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      resolveSearch = resolve;
    })
  );
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByPlaceholderText, getByTestId, findByText } = render(
    <NewJourneyScreen navigation={navigation} route={{} as any} />
  );
  await findByText('Start Journey', {}, { timeout: 20000 });

  fireEvent.changeText(getByPlaceholderText('e.g. Heathrow Terminal 5'), 'Heathrow');
  fireEvent.press(getByText('Go'));

  await waitFor(() => expect(getByTestId('searchGoButton').props.accessibilityState?.disabled).toBe(true));

  resolveSearch([{ lat: 51.47, lng: -0.4543, placeName: 'Heathrow Terminal 5' }]);

  await waitFor(() => expect(getByTestId('searchGoButton').props.accessibilityState?.disabled).toBe(false));
});

test('shows a message and leaves the destination unchanged when the search fails', async () => {
  (searchDestination as jest.Mock).mockRejectedValue(new Error('network down'));
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByPlaceholderText, getByTestId, findByText } = render(
    <NewJourneyScreen navigation={navigation} route={{} as any} />
  );
  await findByText('Start Journey', {}, { timeout: 20000 });

  const latBefore = getByTestId('destLatInput').props.value;
  const lngBefore = getByTestId('destLngInput').props.value;

  fireEvent.changeText(getByPlaceholderText('e.g. Heathrow Terminal 5'), 'Nowhere');
  fireEvent.press(getByText('Go'));

  await findByText("Couldn't search right now. Check your connection and try again.", {}, { timeout: 20000 });
  expect(getByTestId('destLatInput').props.value).toBe(latBefore);
  expect(getByTestId('destLngInput').props.value).toBe(lngBefore);
});

test('shows "No places found." when the search returns zero results', async () => {
  (searchDestination as jest.Mock).mockResolvedValue([]);
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByPlaceholderText, findByText } = render(
    <NewJourneyScreen navigation={navigation} route={{} as any} />
  );
  await findByText('Start Journey', {}, { timeout: 20000 });

  fireEvent.changeText(getByPlaceholderText('e.g. Heathrow Terminal 5'), 'Nowhere');
  fireEvent.press(getByText('Go'));

  await findByText('No places found.', {}, { timeout: 20000 });
});

test('tapping a second result selects it', async () => {
  (searchDestination as jest.Mock).mockResolvedValue([
    { lat: 51.47, lng: -0.4543, placeName: 'Heathrow Terminal 5' },
    { lat: 51.5007, lng: -0.1246, placeName: 'London Bridge' },
  ]);
  const navigation = { replace: jest.fn() } as any;
  const { getByText, getByPlaceholderText, findByDisplayValue, findByText } = render(
    <NewJourneyScreen navigation={navigation} route={{} as any} />
  );
  await findByText('Start Journey', {}, { timeout: 20000 });

  fireEvent.changeText(getByPlaceholderText('e.g. Heathrow Terminal 5'), 'London');
  fireEvent.press(getByText('Go'));

  await findByDisplayValue('51.47'); // first result auto-selected

  fireEvent.press(await findByText('London Bridge'));

  expect(await findByDisplayValue('51.5007')).toBeTruthy();
});

test('disables Go and shows a hint when the Mapbox token is not configured', async () => {
  (isMapboxTokenConfigured as jest.Mock).mockReturnValue(false);
  const navigation = { replace: jest.fn() } as any;
  const { getByTestId, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });

  await findByText('Destination search needs a Mapbox token.', {}, { timeout: 20000 });
  expect(getByTestId('searchGoButton').props.accessibilityState?.disabled).toBe(true);
});

describe('M2: no preselected destination', () => {
  test('Start is disabled with a hint until a destination is chosen, and pressing it does nothing', async () => {
    const navigation = { replace: jest.fn() } as any;
    const { getByText, getByTestId, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);
    await findByText('Start Journey', {}, { timeout: 20000 });

    expect(getByText('Choose a destination: search, tap the map, or enter coordinates.')).toBeTruthy();
    expect(getByTestId('startJourneyButton').props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId('destLatInput').props.value).toBe('');
    expect(getByTestId('destLngInput').props.value).toBe('');
    fireEvent.press(getByText('Start Journey'));
    expect(createJourney).not.toHaveBeenCalled();
  });

  test('the map starts centred on the user with no destination pin', async () => {
    const { findByText, UNSAFE_getByType, UNSAFE_queryByType } = render(
      <NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />
    );
    await findByText('Start Journey', {}, { timeout: 20000 });
    expect(UNSAFE_getByType('MapboxCamera' as any).props.centerCoordinate).toEqual([
      MOCK_USER_COORDS.longitude,
      MOCK_USER_COORDS.latitude,
    ]);
    expect(UNSAFE_queryByType('MapboxPointAnnotation' as any)).toBeNull();
  });

  test('typing both coordinates chooses the destination: Start enables, the hint goes, the pin and camera move there', async () => {
    const { getByTestId, findByText, queryByText, UNSAFE_getByType } = render(
      <NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />
    );
    await findByText('Start Journey', {}, { timeout: 20000 });
    chooseDestination(getByTestId);

    await waitFor(() => expect(getByTestId('startJourneyButton').props.accessibilityState?.disabled).toBe(false));
    expect(queryByText('Choose a destination: search, tap the map, or enter coordinates.')).toBeNull();
    expect(UNSAFE_getByType('MapboxPointAnnotation' as any).props.coordinate).toEqual([
      PLACEHOLDER_DEST_LNG,
      PLACEHOLDER_DEST_LAT,
    ]);
    expect(UNSAFE_getByType('MapboxCamera' as any).props.centerCoordinate).toEqual([
      PLACEHOLDER_DEST_LNG,
      PLACEHOLDER_DEST_LAT,
    ]);
  });

  test('tapping the map chooses the destination', async () => {
    const { getByTestId, findByText, UNSAFE_getByType } = render(
      <NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />
    );
    await findByText('Start Journey', {}, { timeout: 20000 });
    fireEvent(UNSAFE_getByType('MapboxMapView' as any), 'press', {
      geometry: { coordinates: [PLACEHOLDER_DEST_LNG, PLACEHOLDER_DEST_LAT] },
    });
    await waitFor(() => expect(getByTestId('startJourneyButton').props.accessibilityState?.disabled).toBe(false));
  });
});

describe('I6: radius slider on a short trip (40% cap below the 5 km slider minimum)', () => {
  // ~5 km north of the mocked user -> cap ~2 km.
  const SHORT_TRIP_LAT = 51.5524;

  test('the slider range stays valid (min <= max), tops out at the cap, and the value stays within it', async () => {
    (createJourney as jest.Mock).mockResolvedValue({ id: 3, status: 'active' });
    const { getByText, getByTestId, findByText, UNSAFE_getAllByType } = render(
      <NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />
    );
    await findByText('Start Journey', {}, { timeout: 20000 });
    chooseDestination(getByTestId, SHORT_TRIP_LAT, MOCK_USER_COORDS.longitude);

    const capKm =
      (0.4 *
        haversineDistanceM(
          { lat: MOCK_USER_COORDS.latitude, lng: MOCK_USER_COORDS.longitude },
          { lat: SHORT_TRIP_LAT, lng: MOCK_USER_COORDS.longitude }
        )) /
      1000;
    expect(capKm).toBeLessThan(5);

    const radiusSlider = () => UNSAFE_getAllByType(SliderWithCustomInput).find((el) => el.props.testID === 'radiusSlider')!;
    await waitFor(() => expect(radiusSlider().props.max).toBeCloseTo(capKm, 6));
    const { min, max, value, step } = radiusSlider().props;
    expect(min).toBe(0.1);
    expect(min).toBeLessThanOrEqual(max);
    expect(value).toBeLessThanOrEqual(max);
    expect(value).toBeGreaterThan(0);
    expect(step).toBe(0.1);

    fireEvent.press(getByText('Start Journey'));
    await waitFor(() => expect(createJourney).toHaveBeenCalled(), { timeout: 20000 });
    const { radiusM } = (createJourney as jest.Mock).mock.calls[0][1];
    expect(radiusM).toBeLessThanOrEqual(capKm * 1000);
  });

  test('a normal trip keeps the 5 km slider minimum and 1 km steps', async () => {
    const { getByTestId, findByText, UNSAFE_getAllByType } = render(
      <NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />
    );
    await findByText('Start Journey', {}, { timeout: 20000 });
    chooseDestination(getByTestId);
    const radiusSlider = () => UNSAFE_getAllByType(SliderWithCustomInput).find((el) => el.props.testID === 'radiusSlider')!;
    await waitFor(() => expect(getByTestId('startJourneyButton').props.accessibilityState?.disabled).toBe(false));
    expect(radiusSlider().props.min).toBe(5);
    expect(radiusSlider().props.step).toBe(1);
  });
});

describe('M1: journey name follows the chosen search result', () => {
  test("defaults to the selected result's place name, until the user edits the name", async () => {
    (searchDestination as jest.Mock).mockResolvedValue([
      { lat: 51.47, lng: -0.4543, placeName: 'Heathrow Terminal 5' },
      { lat: 51.5007, lng: -0.1246, placeName: 'London Bridge' },
    ]);
    const { getByText, getByPlaceholderText, findByText } = render(
      <NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />
    );
    await findByText('Start Journey', {}, { timeout: 20000 });

    fireEvent.changeText(getByPlaceholderText('e.g. Heathrow Terminal 5'), 'London');
    fireEvent.press(getByText('Go'));
    await waitFor(() => expect(getByPlaceholderText('Journey Name').props.value).toBe('Heathrow Terminal 5'));

    fireEvent.press(await findByText('London Bridge'));
    await waitFor(() => expect(getByPlaceholderText('Journey Name').props.value).toBe('London Bridge'));

    fireEvent.changeText(getByPlaceholderText('Journey Name'), 'Work');
    fireEvent.press(getByText('Heathrow Terminal 5'));
    await waitFor(() => expect(getByPlaceholderText('Journey Name').props.value).toBe('Work'));
  });
});

test('M8: the Alarm Tune field says custom tunes are coming soon and the default sound is used', async () => {
  const { findByText } = render(<NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />);
  await findByText('Start Journey', {}, { timeout: 20000 });
  expect(await findByText('Custom tunes coming soon — the default alarm sound is used.')).toBeTruthy();
});
