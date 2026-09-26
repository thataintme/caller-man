import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, InitialState, NavigationContainer } from '@react-navigation/native';
import notifee from '@notifee/react-native';
import Mapbox from '@rnmapbox/maps';
import { RootNavigator } from './src/navigation/RootNavigator';
import { resolveStartupRoute } from './src/navigation/resolveStartupRoute';
import { initialNavigationState } from './src/navigation/initialNavigationState';
import { navigationRef, alarmNavigator } from './src/navigation/navigationRef';
import { createForegroundAlarmEventHandler } from './src/alarm/alarmEvents';
import { MAPBOX_ACCESS_TOKEN } from './src/constants/mapbox';

Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);

type Startup = { status: 'loading' } | { status: 'error' } | { status: 'ready'; initialState: InitialState };

export default function App() {
  const [startup, setStartup] = useState<Startup>({ status: 'loading' });
  const mountedRef = useRef(true);

  const start = useCallback(async () => {
    setStartup({ status: 'loading' });
    try {
      const route = await resolveStartupRoute();
      if (mountedRef.current) {
        setStartup({ status: 'ready', initialState: initialNavigationState(route) });
      }
    } catch (error) {
      console.warn('App startup failed', error);
      if (mountedRef.current) {
        setStartup({ status: 'error' });
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    start();
    return () => {
      mountedRef.current = false;
    };
  }, [start]);

  // Foreground notifee events (Snooze/Dismiss pressed on the notification,
  // or an alarm delivered/pressed while the app is open). Background/headless
  // events are handled by the listener registered in index.ts.
  useEffect(() => notifee.onForegroundEvent(createForegroundAlarmEventHandler({ navigator: alarmNavigator })), []);

  if (startup.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Caller Man couldn't start. Please try again.</Text>
        <Pressable style={styles.button} onPress={start} accessibilityRole="button">
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (startup.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#10b981" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} initialState={startup.initialState} theme={DarkTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, backgroundColor: '#0b0f1a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#f87171', textAlign: 'center', marginBottom: 16 },
  button: { backgroundColor: '#10b981', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 10 },
  buttonText: { color: '#04140d', fontWeight: '700', fontSize: 16 },
});
