import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Battery from 'expo-battery';
import Mapbox from '@rnmapbox/maps';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { getDefaultSettings } from '../db/settingsRepo';
import { createJourney, ActiveJourneyExistsError, getActiveJourney, finishJourney } from '../db/journeysRepo';
import { DefaultSettings } from '../types/journey';
import { SliderWithCustomInput } from '../components/SliderWithCustomInput';
import { haversineDistanceM } from '../geo/haversine';
import { clampRadiusToCap, maxAllowedRadiusM } from '../geo/radiusCap';
import { reconcileMinMaxFreq } from '../geo/pollFreqOrdering';
import { maxAllowedBatteryCutoffPct } from '../geo/batteryCutoff';
import { startTracking } from '../location/locationService';
import { RADIUS_MIN_M, RADIUS_MAX_M, POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN } from '../constants/limits';

type Props = NativeStackScreenProps<RootStackParamList, 'NewJourney'>;

// Placeholder "current location" until a live-GPS fetch is wired up (not in
// this task's scope — see interfaces list); destination defaults to a
// distinct nearby point so the initial radius cap isn't degenerately zero.
const PLACEHOLDER_USER_LAT = 51.5074;
const PLACEHOLDER_USER_LNG = -0.1278;
const PLACEHOLDER_DEST_LAT = 51.7774;
const PLACEHOLDER_DEST_LNG = -0.1278;

export function NewJourneyScreen({ navigation }: Props) {
  const [defaults, setDefaults] = useState<DefaultSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeJourneyBlocked, setActiveJourneyBlocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [name, setName] = useState('New Journey');
  const [destLat, setDestLat] = useState(PLACEHOLDER_DEST_LAT);
  const [destLng, setDestLng] = useState(PLACEHOLDER_DEST_LNG);
  const [userLat] = useState(PLACEHOLDER_USER_LAT);
  const [userLng] = useState(PLACEHOLDER_USER_LNG);
  const [radiusM, setRadiusM] = useState(0);
  const [maxFreq, setMaxFreq] = useState(0);
  const [minFreq, setMinFreq] = useState(0);
  const [alarmTune, setAlarmTune] = useState('');
  const [batteryCutoff, setBatteryCutoff] = useState(0);
  const [currentBatteryPct, setCurrentBatteryPct] = useState(100);

  async function loadSetupData() {
    setLoadError(null);
    try {
      const db = await getDb();
      const [d, active] = await Promise.all([getDefaultSettings(db), getActiveJourney(db)]);

      setDefaults(d);
      setActiveJourneyBlocked(!!active);
      setMaxFreq(d.maxPollFreqPerMin);
      setMinFreq(d.minPollFreqPerMin);
      setAlarmTune(d.alarmTune);

      const initialDistanceM = haversineDistanceM(
        { lat: userLat, lng: userLng },
        { lat: destLat, lng: destLng }
      );
      setRadiusM(clampRadiusToCap(d.radiusM, initialDistanceM));

      const level = await Battery.getBatteryLevelAsync();
      const pct = Math.round(level * 100);
      setCurrentBatteryPct(pct);
      setBatteryCutoff(maxAllowedBatteryCutoffPct(pct, d.batteryCutoffPct));
    } catch {
      setLoadError('Could not load journey setup. Please try again.');
    }
  }

  useEffect(() => {
    loadSetupData();
    // Load once on mount; the placeholder user/destination coordinates below
    // are stable for the lifetime of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const distanceM = haversineDistanceM({ lat: userLat, lng: userLng }, { lat: destLat, lng: destLng });
  const radiusCapM = maxAllowedRadiusM(distanceM);

  function handleDestinationChange(lat: number, lng: number) {
    setDestLat(lat);
    setDestLng(lng);
    const newDistance = haversineDistanceM({ lat: userLat, lng: userLng }, { lat, lng });
    setRadiusM((current) => clampRadiusToCap(current, newDistance));
  }

  function handleRadiusChange(km: number) {
    setRadiusM(clampRadiusToCap(km * 1000, distanceM));
  }

  function handleFreqChange(changed: 'min' | 'max', value: number) {
    const reconciled = reconcileMinMaxFreq(
      changed,
      changed === 'min' ? value : minFreq,
      changed === 'max' ? value : maxFreq
    );
    setMinFreq(reconciled.minFreqPerMin);
    setMaxFreq(reconciled.maxFreqPerMin);
  }

  async function handleStart() {
    if (!defaults || creating || activeJourneyBlocked) return;
    setCreateError(null);
    setCreating(true);

    let journey;
    try {
      const db = await getDb();
      journey = await createJourney(db, {
        name,
        destinationLat: destLat,
        destinationLng: destLng,
        radiusM,
        maxPollFreqPerMin: maxFreq,
        minPollFreqPerMin: minFreq,
        alarmTune,
        batteryCutoffPct: batteryCutoff,
        snoozeMinutes: defaults.snoozeMinutes,
        gpsLossGraceMinutes: defaults.gpsLossGraceMinutes,
        initialDistanceM: distanceM,
      });
    } catch (err) {
      setCreating(false);
      if (err instanceof ActiveJourneyExistsError) {
        setActiveJourneyBlocked(true);
        setCreateError('A journey is already active. Finish or cancel it before starting a new one.');
      } else {
        setCreateError('Could not start the journey. Please try again.');
      }
      return;
    }

    try {
      await startTracking(journey);
    } catch {
      // Don't leave an active-but-untracked journey behind: the row was
      // created but the background tracker never started, so cancel it.
      try {
        const db = await getDb();
        await finishJourney(db, journey.id, 'cancelled');
      } catch {
        // best effort — surface the tracking failure regardless
      }
      setCreating(false);
      setCreateError('Could not start tracking. The journey was cancelled — please try again.');
      return;
    }

    setCreating(false);
    navigation.replace('CurrentJourney', { journeyId: journey.id });
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable style={styles.button} onPress={loadSetupData}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!defaults) return null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {activeJourneyBlocked && (
        <Text style={styles.errorText}>
          Only one journey can be active at a time. Finish or cancel your current journey first.
        </Text>
      )}
      {createError !== null && <Text style={styles.errorText}>{createError}</Text>}

      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Journey Name" placeholderTextColor="#6b7280" />

      <Mapbox.MapView
        style={styles.map}
        onPress={(e: any) => {
          const [lng, lat] = e.geometry.coordinates as [number, number];
          handleDestinationChange(lat, lng);
        }}
      >
        <Mapbox.Camera centerCoordinate={[destLng, destLat]} zoomLevel={10} />
        <Mapbox.PointAnnotation id="destination" coordinate={[destLng, destLat]}>
          <View style={styles.pin} />
        </Mapbox.PointAnnotation>
      </Mapbox.MapView>

      <View style={styles.coordRow}>
        <TextInput style={[styles.input, styles.coordInput]} keyboardType="numeric" value={String(destLat)}
          onChangeText={(t) => handleDestinationChange(Number(t) || 0, destLng)} />
        <TextInput style={[styles.input, styles.coordInput]} keyboardType="numeric" value={String(destLng)}
          onChangeText={(t) => handleDestinationChange(destLat, Number(t) || 0)} />
      </View>

      <SliderWithCustomInput label="Alarm Radius" unit="km" value={radiusM / 1000}
        min={RADIUS_MIN_M / 1000} max={Math.min(RADIUS_MAX_M / 1000, radiusCapM / 1000)}
        onChange={handleRadiusChange} />
      <SliderWithCustomInput label="Max GPS Poll Frequency" unit="/m" value={maxFreq}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => handleFreqChange('max', v)} />
      <SliderWithCustomInput label="Min GPS Poll Frequency" unit="/m" value={minFreq}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => handleFreqChange('min', v)} />
      <SliderWithCustomInput label="Low Battery Cutoff" unit="%" value={batteryCutoff}
        min={0} max={maxAllowedBatteryCutoffPct(currentBatteryPct, defaults.batteryCutoffPct)} onChange={setBatteryCutoff} />

      <View style={styles.field}>
        <Text style={styles.label}>Alarm Tune</Text>
        <TextInput style={styles.input} value={alarmTune} onChangeText={setAlarmTune}
          placeholder="Alarm Tune" placeholderTextColor="#6b7280" />
      </View>

      <Pressable style={styles.button} onPress={handleStart} disabled={creating || activeJourneyBlocked}>
        <Text style={styles.buttonText}>{creating ? 'Starting…' : 'Start Journey'}</Text>
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
  input: { borderWidth: 1, borderColor: '#374151', borderRadius: 6, padding: 8, color: '#fff', marginBottom: 12 },
  map: { height: 220, borderRadius: 10, marginBottom: 12 },
  pin: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#ef4444', borderWidth: 2, borderColor: '#fff' },
  coordRow: { flexDirection: 'row', gap: 10 },
  coordInput: { flex: 1 },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 16 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
