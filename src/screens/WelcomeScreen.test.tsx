import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { AppState, Linking, Switch } from 'react-native';
import * as Location from 'expo-location';
import notifee from '@notifee/react-native';
import { WelcomeScreen } from './WelcomeScreen';

jest.mock('expo-location');
jest.mock('@notifee/react-native', () => ({
  requestPermission: jest.fn(),
  openNotificationSettings: jest.fn().mockResolvedValue(undefined),
}));

const navigation = { replace: jest.fn() } as any;

let appStateHandler: (state: string) => void = () => {};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler as unknown as (state: string) => void;
    return { remove: jest.fn() } as any;
  });
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  jest.spyOn(Linking, 'sendIntent').mockResolvedValue(undefined);
});

test('does not navigate when GPS permission is denied', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled(), {
    timeout: 5000,
  });
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('navigates to Journeys once GPS and background permission are granted', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'), { timeout: 5000 });
});

test('shows an Open Settings button and does not navigate when background location stays denied', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(getByText('Open Settings')).toBeTruthy(), { timeout: 5000 });
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('shows a warning banner when an optional permission is denied', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 0 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(getByText('Notifications permission was denied')).toBeTruthy(), {
    timeout: 5000,
  });
});

test('renders full-screen alarm and DND bypass as Check in Settings rows without a switch', () => {
  const { getByText, getAllByText, UNSAFE_getAllByType } = render(
    <WelcomeScreen navigation={navigation} route={{} as any} />
  );

  expect(getByText('Full-screen Alarm')).toBeTruthy();
  expect(getAllByText('Check in Settings')).toHaveLength(2);
  expect(UNSAFE_getAllByType(Switch)).toHaveLength(4);
});

test('re-checks location permissions on app resume and navigates once both are granted', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(getByText('Open Settings')).toBeTruthy(), { timeout: 5000 });

  await act(async () => {
    appStateHandler('active');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'), { timeout: 5000 });
});

test('does not double-navigate when the request path and the AppState re-check both resolve granted', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);

  // Fire the button-press request path and an AppState resume re-check together
  // so both async chains resolve "granted" around the same tick — this is the
  // race that used to be able to call navigation.replace twice.
  await act(async () => {
    fireEvent.press(getByText('Grant All Permissions to Continue'));
    appStateHandler('active');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'), { timeout: 5000 });
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});

test('I2: the DND row promises only what Android allows — sounding through DND once allowed, with silent/vibrate as a caveat', () => {
  const { getByText, queryByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  expect(getByText(/sound through Do Not Disturb once you allow it/i)).toBeTruthy();
  expect(getByText(/silent or vibrate mode may still mute it/i)).toBeTruthy();
  expect(queryByText(/even if your phone is on silent/i)).toBeNull();
});
