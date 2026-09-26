import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
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
import { startTracking, stopTracking } from '../location/locationService';
import { searchDestination, GeocodeResult } from '../location/geocode';
import { RADIUS_MIN_M, RADIUS_MAX_M, POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN } from '../constants/limits';
import { MAPBOX_ACCESS_TOKEN, isMapboxTokenConfigured } from '../constants/mapbox';

type Props = NativeStackScreenProps<RootStackParamList, 'NewJourney'>;

// Destination placeholder until search (Tasks 28-29) lets the user pick one
// directly; kept distinct from any real "current location" so the initial
// radius cap isn't degenerately zero. The user's actual position is fetched
// live below (getCurrentPositionAsync) — no placeholder for that.
const PLACEHOLDER_DEST_LAT = 51.7774;
const PLACEHOLDER_DEST_LNG = -0.1278;

// §5.3/§8.5: below the configured default cutoff, the max selectable cutoff
// for this journey is capped at (current battery - 5%); otherwise there's no
// extra cap beyond 100%. An unknown battery level (the native "unknown"
// sentinel, or a failed read) is treated the same as "not below the
// default" — no cap, use the configured default as-is.
function batteryCutoffCap(currentBatteryPct: number, defaultCutoffPct: number): number {
  if (currentBatteryPct < 0 || currentBatteryPct >= defaultCutoffPct) return 100;
  return maxAllowedBatteryCutoffPct(currentBatteryPct, defaultCutoffPct);
}

function parseCoordinate(text: string): number | null {
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const LOCATION_TIMEOUT_MS = 20_000;

// Races a promise against a timeout so a stuck GPS fix doesn't leave the
// screen loading forever; on timeout it rejects (falling into the same
// load-error + Retry path as any other load failure). The timer is cleared
// on either outcome so it doesn't linger past test/component lifetime.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for the current location')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function NewJourneyScreen({ navigation }: Props) {
  const [defaults, setDefaults] = useState<DefaultSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeJourneyBlocked, setActiveJourneyBlocked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [name, setName] = useState('New Journey');
  const [destLat, setDestLat] = useState(PLACEHOLDER_DEST_LAT);
  const [destLng, setDestLng] = useState(PLACEHOLDER_DEST_LNG);
  // Local text state for the coordinate fields: committed to destLat/destLng
  // (and therefore to the radius-cap recalculation) only on blur/submit, so
  // in-progress typing of negatives and decimals isn't clobbered or
  // prematurely rejected keystroke-by-keystroke.
  const [destLatText, setDestLatText] = useState(String(PLACEHOLDER_DEST_LAT));
  const [destLngText, setDestLngText] = useState(String(PLACEHOLDER_DEST_LNG));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedPlaceName, setSelectedPlaceName] = useState<string | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [radiusM, setRadiusM] = useState(0);
  const [maxFreq, setMaxFreq] = useState(0);
  const [minFreq, setMinFreq] = useState(0);
  const [alarmTune, setAlarmTune] = useState('');
  const [batteryCutoff, setBatteryCutoff] = useState(0);
  const [currentBatteryPct, setCurrentBatteryPct] = useState(-1);

  useEffect(() => {
    setDestLatText(String(destLat));
  }, [destLat]);
  useEffect(() => {
    setDestLngText(String(destLng));
  }, [destLng]);

  async function loadSetupData() {
    setLoadError(null);
    try {
      const db = await getDb();
      const [position, d, active] = await Promise.all([
        withTimeout(Location.getCurrentPositionAsync(), LOCATION_TIMEOUT_MS),
        getDefaultSettings(db),
        getActiveJourney(db),
      ]);

      const uLat = position.coords.latitude;
      const uLng = position.coords.longitude;

      setActiveJourneyBlocked(!!active);
      setMaxFreq(d.maxPollFreqPerMin);
      setMinFreq(d.minPollFreqPerMin);
      setAlarmTune(d.alarmTune);

      const initialDistanceM = haversineDistanceM({ lat: uLat, lng: uLng }, { lat: destLat, lng: destLng });
      setRadiusM(clampRadiusToCap(d.radiusM, initialDistanceM));

      // A battery read failure falls back to the configured default instead
      // of failing the whole load.
      let pct = -1;
      try {
        const level = await Battery.getBatteryLevelAsync();
        if (level >= 0) pct = Math.round(level * 100);
      } catch {
        pct = -1;
      }
      setCurrentBatteryPct(pct);
      setBatteryCutoff(Math.min(d.batteryCutoffPct, batteryCutoffCap(pct, d.batteryCutoffPct)));

      setUserLat(uLat);
      setUserLng(uLng);
      // Set last: until this is non-null the whole form (Start included)
      // stays hidden, so there's no render where a derived field — the
      // battery cutoff included — is visible at a stale/zero value.
      setDefaults(d);
    } catch {
      setLoadError('Could not load journey setup. Please try again.');
    }
  }

  useEffect(() => {
    loadSetupData();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Keeps the whole form — and Start in particular — hidden until both the
  // default settings and the real current-location fix are known.
  if (!defaults || userLat === null || userLng === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Getting your location…</Text>
      </View>
    );
  }
  // Local non-null aliases: TS narrowing of `userLat`/`userLng` from the
  // check above doesn't reliably persist into the hoisted function
  // declarations below, so bind them explicitly as `number` once here.
  const knownUserLat = userLat;
  const knownUserLng = userLng;

  const distanceM = haversineDistanceM({ lat: knownUserLat, lng: knownUserLng }, { lat: destLat, lng: destLng });
  const radiusCapM = maxAllowedRadiusM(distanceM);
  const destinationTooClose = radiusCapM <= 0;
  const currentBatteryCutoffCap = batteryCutoffCap(currentBatteryPct, defaults.batteryCutoffPct);

  function handleDestinationChange(lat: number, lng: number) {
    setDestLat(lat);
    setDestLng(lng);
    const newDistance = haversineDistanceM({ lat: knownUserLat, lng: knownUserLng }, { lat, lng });
    setRadiusM((current) => clampRadiusToCap(current, newDistance));
  }

  function selectSearchResult(result: GeocodeResult) {
    handleDestinationChange(result.lat, result.lng);
    setSelectedPlaceName(result.placeName);
  }

  async function handleSearch() {
    const query = searchQuery.trim();
    if (!query || !isMapboxTokenConfigured() || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await searchDestination(query, MAPBOX_ACCESS_TOKEN);
      setSearchResults(results.slice(0, 5));
      if (results.length === 0) {
        setSearchError('No places found.');
      } else {
        selectSearchResult(results[0]);
      }
    } catch {
      setSearchResults([]);
      setSearchError("Couldn't search right now. Check your connection and try again.");
    } finally {
      setSearching(false);
    }
  }

  function commitDestLat() {
    const parsed = parseCoordinate(destLatText);
    if (parsed !== null && parsed >= -90 && parsed <= 90) {
      handleDestinationChange(parsed, destLng);
    } else {
      // Rejected (out of range or unparseable): revert to the current,
      // still-valid destination rather than leaving the bad text on screen.
      setDestLatText(String(destLat));
    }
  }

  function commitDestLng() {
    const parsed = parseCoordinate(destLngText);
    if (parsed !== null && parsed >= -180 && parsed <= 180) {
      handleDestinationChange(destLat, parsed);
    } else {
      setDestLngText(String(destLng));
    }
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

  function handleBatteryCutoffChange(v: number) {
    setBatteryCutoff(Math.min(Math.max(v, 0), currentBatteryCutoffCap));
  }

  async function handleStart() {
    if (!defaults || creating || activeJourneyBlocked || destinationTooClose) return;
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
      // created but the background tracker never started, so stop any
      // partially-started tracking and cancel the journey.
      try {
        await stopTracking();
      } catch {
        // best effort
      }
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

  const tokenConfigured = isMapboxTokenConfigured();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {activeJourneyBlocked && (
        <Text style={styles.errorText}>
          Only one journey can be active at a time. Finish or cancel your current journey first.
        </Text>
      )}
      {destinationTooClose && <Text style={styles.errorText}>Destination is too close</Text>}
      {createError !== null && <Text style={styles.errorText}>{createError}</Text>}

      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Journey Name" placeholderTextColor="#6b7280" />

      <View style={styles.searchRow}>
        <TextInput
          style={[styles.input, styles.searchInput]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          placeholder="e.g. Heathrow Terminal 5"
          placeholderTextColor="#6b7280"
        />
        <Pressable
          style={styles.goButton}
          onPress={handleSearch}
          disabled={!tokenConfigured || searching}
          testID="searchGoButton"
        >
          <Text style={styles.goButtonText}>{searching ? '…' : 'Go'}</Text>
        </Pressable>
      </View>
      {!tokenConfigured && (
        <Text style={styles.searchHint}>Destination search needs a Mapbox token.</Text>
      )}
      {searchError !== null && <Text style={styles.errorText}>{searchError}</Text>}
      {selectedPlaceName !== null && <Text style={styles.selectedPlace}>{selectedPlaceName}</Text>}
      {searchResults.length > 0 && (
        <View style={styles.resultsList}>
          {searchResults.map((result, index) => (
            <Pressable
              key={`${result.lat}-${result.lng}-${index}`}
              style={styles.resultItem}
              onPress={() => selectSearchResult(result)}
            >
              <Text style={styles.resultText}>{result.placeName}</Text>
            </Pressable>
          ))}
        </View>
      )}

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
        <TextInput
          style={[styles.input, styles.coordInput]}
          keyboardType="numeric"
          value={destLatText}
          onChangeText={setDestLatText}
          onEndEditing={commitDestLat}
          onSubmitEditing={commitDestLat}
          testID="destLatInput"
        />
        <TextInput
          style={[styles.input, styles.coordInput]}
          keyboardType="numeric"
          value={destLngText}
          onChangeText={setDestLngText}
          onEndEditing={commitDestLng}
          onSubmitEditing={commitDestLng}
          testID="destLngInput"
        />
      </View>

      <SliderWithCustomInput testID="radiusSlider" label="Alarm Radius" unit="km" value={radiusM / 1000}
        min={RADIUS_MIN_M / 1000} max={Math.min(RADIUS_MAX_M / 1000, radiusCapM / 1000)}
        onChange={handleRadiusChange} />
      <SliderWithCustomInput testID="maxFreqSlider" label="Max GPS Poll Frequency" unit="/m" value={maxFreq}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => handleFreqChange('max', v)} />
      <SliderWithCustomInput testID="minFreqSlider" label="Min GPS Poll Frequency" unit="/m" value={minFreq}
        min={POLL_FREQ_MIN_PER_MIN} max={POLL_FREQ_MAX_PER_MIN} onChange={(v) => handleFreqChange('min', v)} />
      <SliderWithCustomInput testID="batteryCutoffSlider" label="Low Battery Cutoff" unit="%" value={batteryCutoff}
        min={0} max={currentBatteryCutoffCap} onChange={handleBatteryCutoffChange} />

      <View style={styles.field}>
        <Text style={styles.label}>Alarm Tune</Text>
        <TextInput style={styles.input} value={alarmTune} onChangeText={setAlarmTune}
          placeholder="Alarm Tune" placeholderTextColor="#6b7280" />
      </View>

      <Pressable
        style={styles.button}
        onPress={handleStart}
        disabled={creating || activeJourneyBlocked || destinationTooClose}
        testID="startJourneyButton"
      >
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
  loadingText: { color: '#9ca3af', textAlign: 'center' },
  field: { marginVertical: 12 },
  label: { color: '#e5e7eb', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#374151', borderRadius: 6, padding: 8, color: '#fff', marginBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, marginBottom: 0 },
  goButton: { backgroundColor: '#10b981', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 6 },
  goButtonText: { color: '#04140d', fontWeight: '700' },
  searchHint: { color: '#9ca3af', marginBottom: 12 },
  selectedPlace: { color: '#9ca3af', marginBottom: 8 },
  resultsList: { marginBottom: 12 },
  resultItem: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#374151' },
  resultText: { color: '#e5e7eb' },
  map: { height: 220, borderRadius: 10, marginBottom: 12 },
  pin: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#ef4444', borderWidth: 2, borderColor: '#fff' },
  coordRow: { flexDirection: 'row', gap: 10 },
  coordInput: { flex: 1 },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 16 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
