import React from 'react';
import { View, Text, Linking, Pressable, StyleSheet } from 'react-native';

const DONATION_URL = 'https://example.com/donate';

export function AboutScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Caller Man</Text>
      <Text style={styles.version}>v1.0.0</Text>
      <Text style={styles.body}>
        This is an app built as part of a designing journey. I hope you like it.
      </Text>
      <Pressable onPress={() => Linking.openURL(DONATION_URL)}>
        <Text style={styles.link}>Consider donating</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f1a', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  version: { color: '#9ca3af', marginBottom: 16 },
  body: { color: '#e5e7eb', marginBottom: 16, lineHeight: 20 },
  link: { color: '#34d399', fontWeight: '600' },
});
