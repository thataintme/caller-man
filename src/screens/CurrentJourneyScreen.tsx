import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney, finishJourney } from '../db/journeysRepo';
import { getRecentFixes, pruneFixesForJourney } from '../db/locationLogRepo';
import { Journey } from '../types/journey';
import { haversineDistanceM } from '../geo/haversine';
import { averageSpeedMps, estimateEta } from '../geo/estimation';
import { circlePolygon } from '../geo/circlePolygon';
import { stopTracking } from '../location/locationService';
import { removeAreaCacheForJourney } from '../location/offlineMapCache';
import { cancelAllAlertsForJourney } from '../alarm/alarmManager';
import { MAP_STYLE_URL } from '../constants/mapbox';

type Props = NativeStackScreenProps<RootStackParamList, 'CurrentJourney'>;

// Matches estimation.ts's internal ESTIMATION_WINDOW_MS (not exported); fixes
// outside this window are irrelevant to averageSpeedMps anyway.
const ESTIMATION_LOOKBACK_MS = 3 * 60 * 1000;
// Informational-only refresh cadence for the live status panel; never
// affects the background polling frequency (that's driven by locationService).
// Exported so tests can identify our own setInterval registrations without
// being confused by unrelated timers the RN testing environment creates.
export const REFRESH_INTERVAL_MS = 15_000;

export function CurrentJourneyScreen({ navigation }: Props) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [remainingM, setRemainingM] = useState<number | null>(null);
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [alarmEtaSeconds, setAlarmEtaSeconds] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const active = await getActiveJourney(db);
      if (!mountedRef.current) return;

      // Only the focused screen may redirect: the periodic refresh keeps
      // running while an Alarm is pushed on top, and replacing from
      // underneath would leave two Alarm screens on the stack. useFocusEffect
      // re-runs load() when this screen is focused again.
      if ((!active || active.arrivedAt) && !navigation.isFocused()) return;

      if (!active) {
        // Finished (completed/cancelled) elsewhere since we last checked —
        // don't render stale tracking data, just go back to the list.
        navigation.replace('Journeys');
        return;
      }
      if (active.arrivedAt) {
        // Tracking already stopped and an alarm is pending; show that
        // instead of a live-tracking view that no longer applies.
        navigation.replace('Alarm', { journeyId: active.id, kind: 'arrival' });
        return;
      }

      setJourney(active);
      setLoadError(null);

      const recent = await getRecentFixes(db, active.id, Date.now() - ESTIMATION_LOOKBACK_MS);
      if (!mountedRef.current || recent.length === 0) return;

      const last = recent[recent.length - 1];
      setCurrentPosition({ lat: last.lat, lng: last.lng });
      const distance = haversineDistanceM(last, { lat: active.destinationLat, lng: active.destinationLng });
      const speed = averageSpeedMps(
        recent.map((f) => ({ lat: f.lat, lng: f.lng, recordedAt: f.recordedAt })),
        Date.now()
      );
      const eta = estimateEta(distance, active.radiusM, speed);

      if (!mountedRef.current) return;
      setRemainingM(distance);
      setSpeedMps(speed);
      setEtaSeconds(eta?.etaSeconds ?? null);
      setAlarmEtaSeconds(eta?.alarmEtaSeconds ?? null);
    } catch {
      if (mountedRef.current) {
        setLoadError('Could not load the current journey. Please try again.');
      }
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Periodic informational refresh while this screen is mounted. Uses a
  // plain effect (not tied to the navigation focus mock) so its cleanup
  // always runs on unmount, per Task 26 controller ruling 5.
  useEffect(() => {
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Geodesic polygon approximating the arrival radius in meters; CircleLayer's
  // circleRadius is in screen pixels, not meters, so it can't represent this.
  const radiusRing = useMemo(
    () =>
      journey
        ? circlePolygon({ lat: journey.destinationLat, lng: journey.destinationLng }, journey.radiusM)
        : [],
    [journey]
  );

  function handleCancel() {
    if (!journey) return;
    Alert.alert('Cancel journey?', 'This will stop tracking.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Cancel journey',
        style: 'destructive',
        onPress: () => {
          void confirmCancel();
        },
      },
    ]);
  }

  async function confirmCancel() {
    if (!journey) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await stopTracking();
      // Silence any displayed or pending snoozed alert for this journey
      // before it's marked finished, so nothing rings after cancellation.
      await cancelAllAlertsForJourney(journey.id);
      const db = await getDb();
      await finishJourney(db, journey.id, 'cancelled');
      await pruneFixesForJourney(db, journey.id);
      // R30.1/R30.2: evict the offline area cache now the journey is over.
      // Awaited (it's quick) but its own failure must never surface as a
      // cancel error or block navigating back to Journeys.
      try {
        await removeAreaCacheForJourney(journey.id);
      } catch {
        // best effort
      }
      navigation.replace('Journeys');
    } catch {
      if (mountedRef.current) {
        setCancelError('Could not cancel the journey. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setCancelling(false);
      }
    }
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable style={styles.button} onPress={load}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!journey) {
    return null;
  }

  // Live position when we have one; otherwise fall back to the destination
  // (e.g. right after starting, before the first fix has been logged).
  const mapCenter = currentPosition ?? { lat: journey.destinationLat, lng: journey.destinationLng };

  return (
    <View style={styles.container}>
      <Mapbox.MapView style={styles.map} styleURL={MAP_STYLE_URL}>
        <Mapbox.Camera centerCoordinate={[mapCenter.lng, mapCenter.lat]} zoomLevel={11} />
        <Mapbox.PointAnnotation id="destination" coordinate={[journey.destinationLng, journey.destinationLat]}>
          <View style={styles.destinationMarker} />
        </Mapbox.PointAnnotation>
        {currentPosition ? (
          <Mapbox.PointAnnotation id="current-location" coordinate={[currentPosition.lng, currentPosition.lat]}>
            <View style={styles.currentLocationMarker} />
          </Mapbox.PointAnnotation>
        ) : null}
        <Mapbox.ShapeSource
          id="radius-source"
          shape={{
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [radiusRing],
            },
            properties: {},
          }}
        >
          <Mapbox.FillLayer id="radius-fill-layer" style={{ fillColor: '#10b981', fillOpacity: 0.15 }} />
          <Mapbox.LineLayer id="radius-line-layer" style={{ lineColor: '#10b981', lineWidth: 2 }} />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>

      <View style={styles.panel}>
        <Text style={styles.destination}>{journey.name}</Text>
        <Text style={styles.info}>Radius: {(journey.radiusM / 1000).toFixed(1)} km</Text>
        <Text style={styles.info}>
          Remaining: {remainingM !== null ? `${(remainingM / 1000).toFixed(1)} km` : 'estimating…'}
        </Text>
        <Text style={styles.info}>Speed: {speedMps !== null ? `${(speedMps * 3.6).toFixed(0)} km/h` : 'estimating…'}</Text>
        <Text style={styles.info}>
          Arrival ETA: {etaSeconds !== null ? `${Math.round(etaSeconds / 60)} min` : 'estimating…'}
        </Text>
        <Text style={styles.info}>
          Alarm ETA: {alarmEtaSeconds !== null ? `${Math.round(alarmEtaSeconds / 60)} min` : 'estimating…'}
        </Text>
        {cancelError ? <Text style={styles.errorText}>{cancelError}</Text> : null}
        <Pressable
          style={[styles.cancelButton, cancelling && styles.cancelButtonDisabled]}
          onPress={handleCancel}
          disabled={cancelling}
        >
          <Text style={styles.cancelText}>Cancel Journey</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f1a' },
  map: { flex: 1 },
  destinationMarker: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ef4444' },
  currentLocationMarker: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#3b82f6',
    borderWidth: 2,
    borderColor: '#fff',
  },
  panel: { padding: 20 },
  destination: { color: '#fff', fontSize: 18, fontWeight: '700' },
  info: { color: '#9ca3af', marginTop: 4 },
  centered: {
    flex: 1,
    backgroundColor: '#0b0f1a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: { color: '#f87171', textAlign: 'center', marginTop: 8 },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 12 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
  cancelButton: { backgroundColor: '#ef4444', padding: 12, borderRadius: 10, marginTop: 16 },
  cancelButtonDisabled: { opacity: 0.5 },
  cancelText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
});
