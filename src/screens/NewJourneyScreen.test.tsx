import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NewJourneyScreen } from './NewJourneyScreen';
import { getDefaultSettings } from '../db/settingsRepo';
import { createJourney, ActiveJourneyExistsError, getActiveJourney, finishJourney } from '../db/journeysRepo';
import { startTracking } from '../location/locationService';

jest.setTimeout(45000);

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/settingsRepo');
jest.mock('../db/journeysRepo');
jest.mock('../location/locationService');
jest.mock('expo-battery', () => ({ getBatteryLevelAsync: jest.fn().mockResolvedValue(1) }));
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
jest.mock('@rnmapbox/maps', () => ({
  MapView: 'MapboxMapView',
  Camera: 'MapboxCamera',
  PointAnnotation: 'MapboxPointAnnotation',
}));

const defaults = {
  radiusM: 10000, maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getDefaultSettings as jest.Mock).mockResolvedValue({ ...defaults });
  (getActiveJourney as jest.Mock).mockResolvedValue(null);
  (finishJourney as jest.Mock).mockResolvedValue(undefined);
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

test('disables starting and shows a message when a journey is already active on load', async () => {
  (getActiveJourney as jest.Mock).mockResolvedValue({ id: 7, status: 'active' });
  const navigation = { replace: jest.fn() } as any;
  const { getByText, findByText } = render(<NewJourneyScreen navigation={navigation} route={{} as any} />);

  await findByText(/only one journey can be active/i, {}, { timeout: 20000 });
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
  expect(navigation.replace).not.toHaveBeenCalled();
  await findByText(/could not start tracking/i, {}, { timeout: 20000 });
});

test('shows an error message when loading setup data fails', async () => {
  (getDefaultSettings as jest.Mock).mockRejectedValue(new Error('db unavailable'));
  const { findByText } = render(<NewJourneyScreen navigation={{ replace: jest.fn() } as any} route={{} as any} />);
  await findByText(/could not load journey setup/i, {}, { timeout: 20000 });
});
