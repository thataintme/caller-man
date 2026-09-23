import { render, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AboutScreen } from './AboutScreen';

test('renders the app name and version', () => {
  const { getByText } = render(<AboutScreen />);
  expect(getByText('Caller Man')).toBeTruthy();
  expect(getByText('v1.0.0')).toBeTruthy();
});

test('tapping the donate link opens the donation URL', () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const { getByText } = render(<AboutScreen />);
  fireEvent.press(getByText('Consider donating'));
  expect(openURL).toHaveBeenCalledWith(expect.stringContaining('http'));
  openURL.mockRestore();
});
