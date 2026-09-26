import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Switch, Pressable, StyleSheet, ScrollView, AppState, Linking } from 'react-native';
import * as Location from 'expo-location';
import notifee from '@notifee/react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

/**
 * Permissions with a real, requestable OS boolean we can show as a Switch.
 * `gps` and `background` are hard requirements (spec §5.1) — see `locationBlocked`
 * below for what happens when they're denied. `notifications` is the only optional
 * item here that has a genuine granted/denied signal we can act on.
 */
type SwitchPermissionKey = 'gps' | 'background' | 'toggleGps' | 'notifications';

const SWITCH_ITEMS: { key: SwitchPermissionKey; label: string; rationale: string }[] = [
  {
    key: 'gps',
    label: 'GPS Location Access',
    rationale: 'Required to measure your live distance to the destination.',
  },
  {
    key: 'background',
    label: 'Wake Up in Background',
    rationale: 'Required so Caller Man keeps tracking and can alarm you even while the app is minimized.',
  },
  {
    key: 'toggleGps',
    label: 'Toggle GPS On/Off',
    rationale: 'Lets the app detect if you turn GPS off mid-journey so it can warn you.',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    rationale: 'Used to alert you as you approach your destination.',
  },
];

// Optional (non-blocking) switch items to call out in the warning banner when denied.
const OPTIONAL_SWITCH_KEYS: SwitchPermissionKey[] = ['notifications'];

export function WelcomeScreen({ navigation }: Props) {
  const [granted, setGranted] = useState<Record<SwitchPermissionKey, boolean>>({
    gps: false,
    background: false,
    toggleGps: false,
    notifications: false,
  });
  const [hasRequested, setHasRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const navigatedRef = useRef(false);
  const mountedRef = useRef(true);

  // Android 11+ often can't grant "Allow all the time" from the in-app dialog, so a
  // denial here isn't necessarily final — offer a way to Settings and keep checking.
  const locationBlocked = hasRequested && (!granted.gps || !granted.background);
  const optionalDenied = hasRequested ? OPTIONAL_SWITCH_KEYS.filter((key) => !granted[key]) : [];

  // Single choke point for navigating to Journeys: the request path and the
  // AppState re-check path can both independently resolve "granted" (e.g. two
  // 'active' events, or a resume racing the in-flight request), so the
  // check-and-set here must happen with no `await` between them — only the
  // first caller to reach this synchronous block wins.
  function navigateOnce() {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    navigation.replace('Journeys');
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || navigatedRef.current) return;
      try {
        const fg = await Location.getForegroundPermissionsAsync();
        if (!mountedRef.current) return;
        const bg = await Location.getBackgroundPermissionsAsync();
        if (!mountedRef.current) return;
        if (fg.granted && bg.granted) {
          setGranted((g) => ({ ...g, gps: true, background: true, toggleGps: true }));
          setHasRequested(true);
          navigateOnce();
        }
      } catch {
        // Best-effort re-check; the user can still retry via the button.
      }
    });
    return () => subscription.remove();
  }, [navigation]);

  async function requestAll() {
    if (requesting) return;
    setRequesting(true);
    setErrorMessage(null);
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      const bg = await Location.requestBackgroundPermissionsAsync();
      const settings = await notifee.requestPermission(); // also covers POST_NOTIFICATIONS
      if (!mountedRef.current) return;

      const next: Record<SwitchPermissionKey, boolean> = {
        gps: fg.granted,
        background: bg.granted,
        toggleGps: fg.granted,
        notifications: settings.authorizationStatus >= 1,
      };
      setGranted(next);
      setHasRequested(true);

      if (next.gps && next.background) {
        navigateOnce();
      }
    } catch {
      if (mountedRef.current) {
        setErrorMessage('Something went wrong while requesting permissions. Please try again.');
      }
    } finally {
      if (mountedRef.current) {
        setRequesting(false);
      }
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Caller Man</Text>
      <Text style={styles.subtitle}>GPS proximity alarm for your destinations</Text>

      {errorMessage !== null && <Text style={styles.errorText}>{errorMessage}</Text>}

      {optionalDenied.length > 0 && (
        <View style={styles.banner}>
          {optionalDenied.map((key) => {
            const item = SWITCH_ITEMS.find((i) => i.key === key)!;
            return (
              <Text key={key} style={styles.bannerText}>
                {item.label} permission was denied
              </Text>
            );
          })}
        </View>
      )}

      {SWITCH_ITEMS.map((item) => (
        <View key={item.key} style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rationale}>{item.rationale}</Text>
          </View>
          <Switch value={granted[item.key]} disabled />
        </View>
      ))}

      {locationBlocked && (
        <View style={styles.settingsPrompt}>
          <Text style={styles.rationale}>
            Your Android version may not let you grant "Allow all the time" from this dialog. Open
            Settings and enable GPS location access there instead — we'll continue automatically
            once it's granted.
          </Text>
          <Pressable
            style={styles.settingsButton}
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
          >
            <Text style={styles.settingsButtonText}>Open Settings</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.row}>
        <View style={styles.rowTextWrap}>
          <Text style={styles.rowLabel}>Full-screen Alarm</Text>
          <Text style={styles.rationale}>
            Lets the arrival alarm launch full-screen and wake your device, even while it's locked.
            Android doesn't let apps check or request this automatically — please enable it
            yourself.
          </Text>
        </View>
        <Pressable
          style={styles.settingsButton}
          onPress={() => {
            notifee.openNotificationSettings().catch(() => {});
          }}
        >
          <Text style={styles.settingsButtonText}>Check in Settings</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <View style={styles.rowTextWrap}>
          <Text style={styles.rowLabel}>Sound Through Do Not Disturb</Text>
          <Text style={styles.rationale}>
            Lets the alarm sound through Do Not Disturb once you allow it here — Android doesn't let
            apps check or request this automatically. Silent or vibrate mode may still mute it; we're
            still testing this on real devices.
          </Text>
        </View>
        <Pressable
          style={styles.settingsButton}
          onPress={() => {
            Linking.sendIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS').catch(() => {});
          }}
        >
          <Text style={styles.settingsButtonText}>Check in Settings</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.button, requesting && styles.buttonDisabled]}
        onPress={requestAll}
        disabled={requesting}
      >
        <Text style={styles.buttonText}>
          {requesting ? 'Requesting…' : 'Grant All Permissions to Continue'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#0b0f1a', flexGrow: 1 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', textAlign: 'center', marginTop: 40 },
  subtitle: { color: '#9ca3af', textAlign: 'center', marginBottom: 24 },
  errorText: { color: '#f87171', textAlign: 'center', marginBottom: 12 },
  banner: {
    backgroundColor: '#3f2d0b',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: { color: '#fbbf24', fontSize: 13 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  rowTextWrap: { flex: 1 },
  rowLabel: { color: '#e5e7eb' },
  rationale: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  settingsPrompt: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  settingsButton: {
    backgroundColor: '#374151',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  settingsButtonText: { color: '#e5e7eb', fontWeight: '600', fontSize: 12 },
  button: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, marginTop: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#04140d', textAlign: 'center', fontWeight: '700' },
});
