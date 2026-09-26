import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { JourneysScreen } from '../screens/JourneysScreen';
import { NewJourneyScreen } from '../screens/NewJourneyScreen';
import { DefaultSettingsScreen } from '../screens/DefaultSettingsScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { CurrentJourneyScreen } from '../screens/CurrentJourneyScreen';
import { AlarmScreen } from '../screens/AlarmScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Spec §5.2 menu: the only way into Default Settings and About. */
function JourneysHeaderMenu({ navigation }: { navigation: NativeStackNavigationProp<RootStackParamList, 'Journeys'> }) {
  return (
    <View style={styles.headerMenu}>
      <Pressable onPress={() => navigation.navigate('DefaultSettings')} hitSlop={8} accessibilityRole="button">
        <Text style={styles.headerMenuText}>Settings</Text>
      </Pressable>
      <Pressable onPress={() => navigation.navigate('About')} hitSlop={8} accessibilityRole="button">
        <Text style={styles.headerMenuText}>About</Text>
      </Pressable>
    </View>
  );
}

/**
 * The app's single stack. The starting route (and its params) comes from
 * NavigationContainer's initialState (see initialNavigationState), not from
 * initialRouteName here.
 */
export function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Journeys"
        component={JourneysScreen}
        options={({ navigation }) => ({
          title: 'Journeys',
          headerRight: () => <JourneysHeaderMenu navigation={navigation} />,
        })}
      />
      <Stack.Screen
        name="NewJourney"
        component={NewJourneyScreen}
        options={{ title: 'New Journey', presentation: 'modal' }}
      />
      <Stack.Screen name="DefaultSettings" component={DefaultSettingsScreen} options={{ title: 'Default Settings' }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
      <Stack.Screen name="CurrentJourney" component={CurrentJourneyScreen} options={{ title: 'Current Journey' }} />
      <Stack.Screen
        name="Alarm"
        component={AlarmScreen}
        options={{ headerShown: false, presentation: 'fullScreenModal' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerMenu: { flexDirection: 'row', gap: 16 },
  headerMenuText: { color: '#10b981', fontWeight: '600', fontSize: 15 },
});
