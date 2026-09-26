import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { DefaultSettingsScreen } from './DefaultSettingsScreen';
import { getDefaultSettings, saveDefaultSettings } from '../db/settingsRepo';

jest.setTimeout(45000);

jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/settingsRepo');

const baseSettings = {
  radiusM: 10000, maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getDefaultSettings as jest.Mock).mockResolvedValue({ ...baseSettings });
  (saveDefaultSettings as jest.Mock).mockResolvedValue(undefined);
});

test('saving persists the loaded settings via the repository', async () => {
  const { getByText, findByText } = render(<DefaultSettingsScreen />);
  // NOTE: this sandboxed test environment is slow enough that the default
  // @testing-library/react-native async timeout (1000ms) is insufficient for
  // the initial getDb()+getDefaultSettings() load to resolve and re-render
  // (measured ~15s locally); the explicit timeouts below are an environment
  // accommodation, not a change to the screen's behavior.
  await findByText('Save', {}, { timeout: 20000 });
  fireEvent.press(getByText('Save'));
  await waitFor(
    () =>
      expect(saveDefaultSettings).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(baseSettings)),
    { timeout: 20000 }
  );
});

test('shows an error message when loading default settings fails', async () => {
  (getDefaultSettings as jest.Mock).mockRejectedValue(new Error('db unavailable'));
  const { findByText } = render(<DefaultSettingsScreen />);
  await findByText('Could not load default settings. Please try again.', {}, { timeout: 20000 });
});

test('M5: a custom battery cutoff above 100% is clamped to 100 before saving', async () => {
  const { getByText, getByTestId, findByText } = render(<DefaultSettingsScreen />);
  await findByText('Save', {}, { timeout: 20000 });

  fireEvent(getByTestId('batteryCutoffSlider-switch'), 'valueChange', true);
  const input = getByTestId('batteryCutoffSlider-input');
  fireEvent.changeText(input, '150');
  fireEvent(input, 'endEditing');

  fireEvent.press(getByText('Save'));
  await waitFor(
    () =>
      expect(saveDefaultSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ batteryCutoffPct: 100 })
      ),
    { timeout: 20000 }
  );
});

test('M8: the Alarm Tune field says custom tunes are coming soon and the default sound is used', async () => {
  const { findByText } = render(<DefaultSettingsScreen />);
  expect(
    await findByText('Custom tunes coming soon — the default alarm sound is used.', {}, { timeout: 20000 })
  ).toBeTruthy();
});
