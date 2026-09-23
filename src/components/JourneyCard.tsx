import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Journey } from '../types/journey';

interface Props {
  journey: Journey;
  onPress: (journey: Journey) => void;
}

export function JourneyCard({ journey, onPress }: Props) {
  return (
    <Pressable style={styles.card} onPress={() => onPress(journey)}>
      <View style={styles.headerRow}>
        <Text style={styles.name}>{journey.name}</Text>
        <Text style={styles.status}>{journey.status}</Text>
      </View>
      <Text style={styles.meta}>
        Radius {(journey.radiusM / 1000).toFixed(1)} km · {new Date(journey.createdAt).toLocaleDateString()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 10, backgroundColor: '#111827', marginBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between' },
  name: { color: '#fff', fontSize: 16, fontWeight: '700' },
  status: { color: '#34d399', fontSize: 12, textTransform: 'uppercase' },
  meta: { color: '#9ca3af', fontSize: 12, marginTop: 4 },
});
