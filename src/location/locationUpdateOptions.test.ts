import { locationUpdateOptions, trackingNotificationBody } from './locationUpdateOptions';

jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3 } }));

describe('trackingNotificationBody (spec §5.6: destination + remaining distance, metric)', () => {
  test('shows the remaining distance in km with one decimal and the destination name', () => {
    expect(trackingNotificationBody('Station', 12_345)).toBe('12.3 km remaining to Station');
  });

  test('rounds sub-km distances to one decimal km', () => {
    expect(trackingNotificationBody('Home', 450)).toBe('0.5 km remaining to Home');
  });
});

test('locationUpdateOptions builds the shared foreground-service location options', () => {
  expect(locationUpdateOptions('Station', 12_000, 10_000)).toEqual({
    accuracy: 3,
    timeInterval: 12_000,
    foregroundService: {
      notificationTitle: 'Caller Man — tracking active',
      notificationBody: '10.0 km remaining to Station',
    },
    pausesUpdatesAutomatically: false,
  });
});
