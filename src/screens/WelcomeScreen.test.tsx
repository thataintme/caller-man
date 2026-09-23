import { render, fireEvent, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import notifee from '@notifee/react-native';
import { WelcomeScreen } from './WelcomeScreen';

jest.mock('expo-location');
jest.mock('expo-notifications');
jest.mock('@notifee/react-native', () => ({ requestPermission: jest.fn() }));

const navigation = { replace: jest.fn() } as any;

beforeEach(() => jest.clearAllMocks());

test('does not navigate when GPS permission is denied', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled());
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('navigates to Journeys once GPS and background permission are granted', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (notifee.requestPermission as jest.Mock).mockResolvedValue({ authorizationStatus: 1 });

  const { getByText } = render(<WelcomeScreen navigation={navigation} route={{} as any} />);
  fireEvent.press(getByText('Grant All Permissions to Continue'));

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('Journeys'));
});
