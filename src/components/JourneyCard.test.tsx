import { render, fireEvent } from '@testing-library/react-native';
import { JourneyCard } from './JourneyCard';
import { Journey } from '../types/journey';

const journey: Journey = {
  id: 1, name: 'Train Station', destinationLat: 0, destinationLng: 0, radiusM: 1000,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping', batteryCutoffPct: 15,
  snoozeMinutes: 3, gpsLossGraceMinutes: 2, initialDistanceM: 5000, lastFixAt: null,
  status: 'active', createdAt: Date.now(), completedAt: null, arrivedAt: null,
};

test('renders the journey name and status', () => {
  const { getByText } = render(<JourneyCard journey={journey} onPress={jest.fn()} />);
  expect(getByText('Train Station')).toBeTruthy();
  expect(getByText('active')).toBeTruthy();
});

test('pressing the card calls onPress with the journey', () => {
  const onPress = jest.fn();
  const { getByText } = render(<JourneyCard journey={journey} onPress={onPress} />);
  fireEvent.press(getByText('Train Station'));
  expect(onPress).toHaveBeenCalledWith(journey);
});

test('displays radius and distance correctly', () => {
  const { getByText } = render(<JourneyCard journey={journey} onPress={jest.fn()} />);
  expect(getByText(/Radius 1\.0 km/)).toBeTruthy();
  expect(getByText(/5\.0 km away/)).toBeTruthy();
});
