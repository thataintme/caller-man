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

test('entering a valid custom number calls onChange', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  fireEvent.changeText(getByDisplayValue('10'), '75');
  expect(onChange).toHaveBeenCalledWith(75);
});

test('non-numeric custom input does not call onChange', () => {
  const onChange = jest.fn();
  const { getByRole, getByDisplayValue } = render(
    <SliderWithCustomInput label="Alarm Radius" unit="km" value={10} min={5} max={200} onChange={onChange} />
  );
  fireEvent(getByRole('switch'), 'valueChange', true);
  fireEvent.changeText(getByDisplayValue('10'), 'abc');
  expect(onChange).not.toHaveBeenCalled();
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
  fireEvent.changeText(getByDisplayValue('10'), '12,5');
  expect(onChange).toHaveBeenCalledWith(12.5);
});
