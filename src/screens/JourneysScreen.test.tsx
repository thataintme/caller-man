import { render, fireEvent } from '@testing-library/react-native';
import { JourneysScreen } from './JourneysScreen';
import { listJourneys } from '../db/journeysRepo';

jest.setTimeout(45000);

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/journeysRepo');
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => cb(),
}));

const activeJourney = {
  id: 1,
  name: 'Train Station',
  status: 'active',
  radiusM: 1000,
  initialDistanceM: 5000,
  createdAt: Date.now(),
  arrivedAt: null,
};
const arrivedJourney = {
  id: 3,
  name: 'Grocery Store',
  status: 'active',
  radiusM: 800,
  initialDistanceM: 2000,
  createdAt: Date.now() - 500,
  arrivedAt: Date.now(),
};
const completedJourney = {
  id: 2,
  name: 'Airport',
  status: 'completed',
  radiusM: 500,
  initialDistanceM: 12000,
  createdAt: Date.now() - 1000,
  arrivedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (listJourneys as jest.Mock).mockResolvedValue([activeJourney, completedJourney]);
});

test('lists journeys from the repository', async () => {
  const { findByText } = render(<JourneysScreen navigation={{} as any} route={{} as any} />);
  expect(await findByText('Train Station', {}, { timeout: 20000 })).toBeTruthy();
  expect(await findByText('Airport', {}, { timeout: 20000 })).toBeTruthy();
});

test('tapping the active journey navigates to CurrentJourney', async () => {
  const navigation = { navigate: jest.fn() } as any;
  const { findByText, getByText } = render(<JourneysScreen navigation={navigation} route={{} as any} />);
  await findByText('Train Station', {}, { timeout: 20000 });
  fireEvent.press(getByText('Train Station'));
  expect(navigation.navigate).toHaveBeenCalledWith('CurrentJourney', { journeyId: 1 });
});

test('tapping an active, arrived journey navigates to the Alarm screen', async () => {
  (listJourneys as jest.Mock).mockResolvedValue([arrivedJourney, completedJourney]);
  const navigation = { navigate: jest.fn() } as any;
  const { findByText, getByText } = render(<JourneysScreen navigation={navigation} route={{} as any} />);
  await findByText('Grocery Store', {}, { timeout: 20000 });
  fireEvent.press(getByText('Grocery Store'));
  expect(navigation.navigate).toHaveBeenCalledWith('Alarm', { journeyId: 3, kind: 'arrival' });
});

test('tapping a completed journey does not navigate', async () => {
  const navigation = { navigate: jest.fn() } as any;
  const { findByText, getByText } = render(<JourneysScreen navigation={navigation} route={{} as any} />);
  await findByText('Airport', {}, { timeout: 20000 });
  fireEvent.press(getByText('Airport'));
  expect(navigation.navigate).not.toHaveBeenCalled();
});

test('the "+" button navigates to New Journey setup', async () => {
  const navigation = { navigate: jest.fn() } as any;
  const { findByText, getByText } = render(<JourneysScreen navigation={navigation} route={{} as any} />);
  await findByText('Train Station', {}, { timeout: 20000 });
  fireEvent.press(getByText('+'));
  expect(navigation.navigate).toHaveBeenCalledWith('NewJourney');
});

test('shows an error message when loading journeys fails', async () => {
  (listJourneys as jest.Mock).mockRejectedValue(new Error('db unavailable'));
  const { findByText } = render(<JourneysScreen navigation={{} as any} route={{} as any} />);
  await findByText('Could not load journeys. Please try again.', {}, { timeout: 20000 });
});
