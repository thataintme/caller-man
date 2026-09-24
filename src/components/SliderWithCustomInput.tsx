import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Switch, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';

interface Props {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  testID?: string;
}

function parseCustomValue(text: string): number {
  return Number(text.replace(',', '.'));
}

export function SliderWithCustomInput({ label, unit, value, min, max, step = 1, onChange, testID }: Props) {
  const [useCustom, setUseCustom] = useState(false);
  const [customText, setCustomText] = useState(String(value));
  // Bumped on every accepted commit so the resync effect below re-runs even
  // when the parent's settled `value` turns out equal to what it was before
  // (e.g. the parent clamps a typed 40 back down to a cap of 5, which was
  // already the value) — a [value]-only dependency would never fire then,
  // leaving the rejected "40" stuck on screen.
  const [commitNonce, setCommitNonce] = useState(0);

  useEffect(() => {
    setCustomText(String(value));
    // Resync whenever the parent-provided value changes, or after any
    // accepted commit (commitNonce) regardless of whether the settled value
    // changed. This intentionally does not depend on customText itself —
    // an in-progress edit (e.g. "12.") isn't touched between commits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, commitNonce]);

  function commitCustomValue() {
    const parsed = parseCustomValue(customText);
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange(parsed);
      setCommitNonce((n) => n + 1);
    } else {
      // Invalid input (e.g. "abc"): nothing was committed, so revert the
      // displayed text to the current value rather than leaving the
      // rejected text on screen.
      setCustomText(String(value));
    }
  }

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.customToggle}>
          <Text style={styles.customLabel}>Custom</Text>
          <Switch value={useCustom} onValueChange={setUseCustom} testID={testID ? `${testID}-switch` : undefined} />
        </View>
      </View>

      {useCustom ? (
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={customText}
          onChangeText={setCustomText}
          onEndEditing={commitCustomValue}
          onSubmitEditing={commitCustomValue}
          testID={testID ? `${testID}-input` : undefined}
        />
      ) : (
        <>
          <Slider minimumValue={min} maximumValue={max} step={step} value={value} onValueChange={onChange} />
          <Text style={styles.value}>{value} {unit}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: '#e5e7eb' },
  customToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customLabel: { fontSize: 12, color: '#9ca3af' },
  input: { borderWidth: 1, borderColor: '#374151', borderRadius: 6, padding: 8, color: '#fff' },
  value: { fontSize: 12, textAlign: 'right', color: '#9ca3af' },
});
