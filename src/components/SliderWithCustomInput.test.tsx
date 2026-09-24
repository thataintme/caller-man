import { render, fireEvent } from '@testing-library/react-native';
import { SliderWithCustomInput } from './SliderWithCustomInput';

test('toggling Custom reveals a text input pre-filled with the current value', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  expect(getByDisplayValue('10')).toBeTruthy();
});

test('entering a valid custom number calls onChange on blur/submit, not per keystroke', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  const input = getByDisplayValue('10');
  fireEvent.changeText(input, '75');
  expect(onChange).not.toHaveBeenCalled();

  fireEvent(input, 'endEditing');
  expect(onChange).toHaveBeenCalledWith(75);
});

test('submitting (not just blurring) also commits the custom value', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  const input = getByDisplayValue('10');
  fireEvent.changeText(input, '90');
  fireEvent(input, 'submitEditing');
  expect(onChange).toHaveBeenCalledWith(90);
});

test('non-numeric custom input does not call onChange, and reverts the displayed text on blur', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue, queryByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  const input = getByDisplayValue('10');
  fireEvent.changeText(input, 'abc');
  fireEvent(input, 'endEditing');
  expect(onChange).not.toHaveBeenCalled();
  expect(queryByDisplayValue('abc')).toBeNull();
  expect(getByDisplayValue('10')).toBeTruthy();
});

test('a value the parent clamps back to the pre-commit value still resyncs the displayed text', () => {
  // Simulates a parent (like NewJourneyScreen's battery-cutoff handler)
  // that clamps an accepted onChange call so the resulting `value` prop is
  // unchanged from before the commit — a naive [value]-only resync effect
  // would never fire in that case, leaving the rejected typed text on screen.
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue, queryByDisplayValue, rerender } = render(
    <SliderWithCustomInput label="Low Battery Cutoff" unit="%" value={5} min={0} max={5} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  const input = getByDisplayValue('5');
  fireEvent.changeText(input, '40');
  fireEvent(input, 'endEditing');
  expect(onChange).toHaveBeenCalledWith(40);

  // Parent clamps 40 back down to the cap of 5 — value prop is unchanged.
  rerender(
    <SliderWithCustomInput label="Low Battery Cutoff" unit="%" value={5} min={0} max={5} onChange={onChange} />
  );

  expect(queryByDisplayValue('40')).toBeNull();
  expect(getByDisplayValue('5')).toBeTruthy();
});

test('resyncs the custom text when the value prop changes externally', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue, rerender } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  expect(getByDisplayValue('10')).toBeTruthy();

  rerender(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={40} min={5} max={200} onChange={onChange} />
  );

  expect(getByDisplayValue('40')).toBeTruthy();
});

test('a comma decimal separator is accepted and calls onChange with a number', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  const input = getByDisplayValue('10');
  fireEvent.changeText(input, '12,5');
  fireEvent(input, 'endEditing');
  expect(onChange).toHaveBeenCalledWith(12.5);
});
