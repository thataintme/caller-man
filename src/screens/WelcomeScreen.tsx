import React, { useState } from 'react';
import { View, Text, Switch, Pressable, StyleSheet, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import notifee from '@notifee/react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const PERMISSION_ITEMS = [
  { key: 'gps', label: 'GPS Location Access' },
  { key: 'background', label: 'Wake Up in Background' },
  { key: 'toggleGps', label: 'Toggle GPS On/Off' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'overlay', label: 'Display Over Other Apps' },
  { key: 'dnd', label: 'Bypass Silent Mode & DND' },
] as const;

type PermissionKey = (typeof PERMISSION_ITEMS)[number]['key'];

export function WelcomeScreen({ navigation }: Props) {
  const [granted, setGranted] = useState<Record<PermissionKey, boolean>>({
    gps: false, background: false, toggleGps: false, notifications: false, overlay: false, dnd: false,
  });

  async function requestAll() {
    const fg = await Location.requestForegroundPermissionsAsync();
    const bg = await Location.requestBackgroundPermissionsAsync();
    const notif = await Notifications.requestPermissionsAsync();
    const settings = await notifee.requestPermission();

    const next: Record<PermissionKey, boolean> = {
      gps: fg.granted,
      background: bg.granted,
      toggleGps: fg.granted,
      notifications: notif.granted,
      overlay: true,
      dnd: settings.authorizationStatus >= 1,
    };
    setGranted(next);

    if (!next.gps || !next.background) {
      return;
    }
    navigation.replace('Journeys');
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Caller Man</Text>
      <Text style={styles.subtitle}>GPS proximity alarm for your destinations</Text>

      {PERMISSION_ITEMS.map((item) => (
        <View key={item.key} style={styles.row}>
          <Text style={styles.rowLabel}>{item.label}</Text>
          <Switch value={granted[item.key]} disabled />
        </View>
      ))}

      <Pressable style={styles.button} onPress={requestAll}>
        <Text style={styles.buttonText}>Grant All Permissions to Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#0b0f1a', flexGrow: 1 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 40 },
  subtitle: { color: '#9ca3af', textAlign: 'center', marginBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  rowLabel: { color: '#e5e7eb' },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 24 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
