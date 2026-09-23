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
}

function parseCustomValue(text: string): number {
  return Number(text.replace(',', '.'));
}

export function SliderWithCustomInput({ label, unit, value, min, max, step = 1, onChange }: Props) {
  const [useCustom, setUseCustom] = useState(false);
  const [customText, setCustomText] = useState(String(value));

  useEffect(() => {
    if (parseCustomValue(customText) !== value) {
      setCustomText(String(value));
    }
    // Only resync when the parent-provided value changes; an in-progress edit
    // (e.g. "12.") must not be clobbered by re-renders triggered by other props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.customToggle}>
          <Text style={styles.customLabel}>Custom</Text>
          <Switch value={useCustom} onValueChange={setUseCustom} />
        </View>
      </View>

      {useCustom ? (
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={customText}
          onChangeText={(text) => {
            setCustomText(text);
            const parsed = parseCustomValue(text);
            if (Number.isFinite(parsed) && parsed > 0) {
              onChange(parsed);
            }
          }}
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
