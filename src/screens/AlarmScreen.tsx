import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { getJourneyById } from '../db/journeysRepo';
import { Journey } from '../types/journey';
import { dismissAlarm, snoozeAlarm } from '../alarm/alarmActions';
import { leaveAlarm, resetToJourneys } from '../navigation/alarmNavigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Alarm'>;
type Kind = Props['route']['params']['kind'];

const TITLES: Record<Kind, string> = {
  arrival: "You've arrived",
  gpsLoss: 'Lost GPS signal',
  lowBattery: 'Battery running low',
};

export function AlarmScreen({ route, navigation }: Props) {
  const { journeyId, kind } = route.params;
  const [journey, setJourney] = useState<Journey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const db = await getDb();
      const found = await getJourneyById(db, journeyId);
      if (!mountedRef.current) return;

      // Gone, or already finished elsewhere (e.g. a race with another
      // dismiss) — nothing to show, don't loop back to an alarm that no
      // longer applies.
      if (!found || found.status !== 'active') {
        resetToJourneys(navigation);
        return;
      }

      setJourney(found);
    } catch {
      if (mountedRef.current) {
        setLoadError('Could not load this alarm. Please try again.');
      }
    }
  }, [journeyId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  function goToNextScreen() {
    leaveAlarm(navigation, kind, journeyId);
  }

  async function handleDismiss() {
    if (!journey || inFlight) return;
    setInFlight(true);
    setActionError(null);
    try {
      await dismissAlarm(journeyId, kind);
      goToNextScreen();
    } catch {
      if (mountedRef.current) {
        setActionError('Could not dismiss the alarm. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setInFlight(false);
      }
    }
  }

  async function handleSnooze() {
    if (!journey || inFlight) return;
    setInFlight(true);
    setActionError(null);
    try {
      await snoozeAlarm(journeyId, kind);
      goToNextScreen();
    } catch {
      if (mountedRef.current) {
        setActionError('Could not snooze the alarm. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setInFlight(false);
      }
    }
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable style={styles.dismissButton} onPress={load}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!journey) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{TITLES[kind]}</Text>
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      <Pressable
        style={[styles.snoozeButton, inFlight && styles.buttonDisabled]}
        onPress={handleSnooze}
        disabled={inFlight}
      >
        <Text style={styles.buttonText}>Snooze {journey.snoozeMinutes}m</Text>
      </Pressable>
      <Pressable
        style={[styles.dismissButton, inFlight && styles.buttonDisabled]}
        onPress={handleDismiss}
        disabled={inFlight}
      >
        <Text style={styles.buttonText}>Dismiss</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 40, textAlign: 'center' },
  errorText: { color: '#f87171', textAlign: 'center', marginBottom: 16 },
  snoozeButton: { backgroundColor: '#f59e0b', padding: 16, borderRadius: 12, width: '100%', marginBottom: 12 },
  dismissButton: { backgroundColor: '#10b981', padding: 16, borderRadius: 12, width: '100%' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700', fontSize: 16 },
});
