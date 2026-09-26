import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { getDb } from '../db/expoSqliteClient';
import { getDefaultSettings, saveDefaultSettings } from '../db/settingsRepo';
import { DefaultSettings } from '../types/journey';
import { SliderWithCustomInput } from '../components/SliderWithCustomInput';
import { reconcileMinMaxFreq } from '../geo/pollFreqOrdering';
import {
  RADIUS_MIN_M, RADIUS_MAX_M, POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN,
  SNOOZE_MINUTES_MIN, SNOOZE_MINUTES_MAX, GPS_LOSS_GRACE_MINUTES_MIN, GPS_LOSS_GRACE_MINUTES_MAX,
} from '../constants/limits';
import { ALARM_TUNE_HINT } from '../constants/copy';

// The custom-value input accepts any positive number; a battery percentage
// only makes sense within 0..100.
function clampPct(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

export function DefaultSettingsScreen() {
  const [settings, setSettings] = useState<DefaultSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function loadSettings() {
    setLoadError(null);
    try {
      const db = await getDb();
      setSettings(await getDefaultSettings(db));
    } catch {
      setLoadError('Could not load default settings. Please try again.');
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable style={styles.button} onPress={loadSettings}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!settings) return null;

  function updateFreq(changed: 'min' | 'max', value: number) {
    const reconciled = reconcileMinMaxFreq(
      changed,
      changed === 'min' ? value : settings!.minPollFreqPerMin,
      changed === 'max' ? value : settings!.maxPollFreqPerMin
    );
    setSettings({ ...settings!, minPollFreqPerMin: reconciled.minFreqPerMin, maxPollFreqPerMin: reconciled.maxFreqPerMin });
    setSaved(false);
  }

  async function handleSave() {
    setSaveError(null);
    try {
      const db = await getDb();
      await saveDefaultSettings(db, settings!);
      setSaved(true);
    } catch {
      setSaved(false);
      setSaveError('Could not save default settings. Please try again.');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {saveError !== null && <Text style={styles.errorText}>{saveError}</Text>}
      <SliderWithCustomInput label="Alarm Radius" unit="km" value={settings.radiusM / 1000}
        min={RADIUS_MIN_M / 1000} max={RADIUS_MAX_M / 1000}
        onChange={(v) => { setSettings({ ...settings, radiusM: v * 1000 }); setSaved(false); }} />
      <SliderWithCustomInput label="Max GPS Poll Frequency" unit="/m" value={settings.maxPollFreqPerMin}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => updateFreq('max', v)} />
      <SliderWithCustomInput label="Min GPS Poll Frequency" unit="/m" value={settings.minPollFreqPerMin}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => updateFreq('min', v)} />
      <SliderWithCustomInput label="Low Battery Cutoff" unit="%" value={settings.batteryCutoffPct}
        min={5} max={50} testID="batteryCutoffSlider"
        onChange={(v) => { setSettings({ ...settings, batteryCutoffPct: clampPct(v) }); setSaved(false); }} />
      <SliderWithCustomInput label="Snooze Duration" unit="min" value={settings.snoozeMinutes}
        min={SNOOZE_MINUTES_MIN} max={SNOOZE_MINUTES_MAX}
        onChange={(v) => { setSettings({ ...settings, snoozeMinutes: v }); setSaved(false); }} />
      <SliderWithCustomInput label="GPS Loss Grace Period" unit="min" value={settings.gpsLossGraceMinutes}
        min={GPS_LOSS_GRACE_MINUTES_MIN} max={GPS_LOSS_GRACE_MINUTES_MAX}
        onChange={(v) => { setSettings({ ...settings, gpsLossGraceMinutes: v }); setSaved(false); }} />
      <View style={styles.field}>
        <Text style={styles.label}>Alarm Tune</Text>
        <TextInput style={styles.input} value={settings.alarmTune}
          onChangeText={(v) => { setSettings({ ...settings, alarmTune: v }); setSaved(false); }} />
        <Text style={styles.hint}>{ALARM_TUNE_HINT}</Text>
      </View>
      <Pressable style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>{saved ? 'Defaults Saved' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#0b0f1a', flexGrow: 1 },
  centered: {
    flex: 1,
    backgroundColor: '#0b0f1a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: { color: '#f87171', textAlign: 'center', marginBottom: 12 },
  field: { marginVertical: 12 },
  label: { color: '#e5e7eb', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#374151', borderRadius: 6, padding: 8, color: '#fff' },
  hint: { color: '#9ca3af', marginTop: 6 },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 12 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
