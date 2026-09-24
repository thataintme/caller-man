import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { getDb } from '../db/expoSqliteClient';
import { listJourneys } from '../db/journeysRepo';
import { Journey } from '../types/journey';
import { JourneyCard } from '../components/JourneyCard';

type Props = NativeStackScreenProps<RootStackParamList, 'Journeys'>;

export function JourneysScreen({ navigation }: Props) {
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadJourneys = useCallback(async () => {
    try {
      const db = await getDb();
      const result = await listJourneys(db);
      setJourneys(result);
      setLoadError(null);
    } catch {
      setLoadError('Could not load journeys. Please try again.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadJourneys();
    }, [loadJourneys])
  );

  function handleCardPress(journey: Journey) {
    if (journey.status !== 'active') return;
    if (journey.arrivedAt) {
      navigation.navigate('Alarm', { journeyId: journey.id, kind: 'arrival' });
      return;
    }
    navigation.navigate('CurrentJourney', { journeyId: journey.id });
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable style={styles.button} onPress={loadJourneys}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (journeys === null) return null;

  return (
    <View style={styles.container}>
      <FlatList
        data={journeys}
        keyExtractor={(j) => String(j.id)}
        renderItem={({ item }) => <JourneyCard journey={item} onPress={handleCardPress} />}
        ListEmptyComponent={<Text style={styles.empty}>No journeys yet</Text>}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('NewJourney')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f1a', padding: 16 },
  centered: {
    flex: 1,
    backgroundColor: '#0b0f1a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: { color: '#f87171', textAlign: 'center', marginBottom: 12 },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 12 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
  empty: { color: '#9ca3af', textAlign: 'center', marginTop: 40 },
  fab: { position: 'absolute', right: 20, bottom: 30, width: 56, height: 56, borderRadius: 28, backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center' },
  fabText: { color: '#04140d', fontSize: 28, fontWeight: '700' },
});
