import { registerRootComponent } from 'expo';
import notifee from '@notifee/react-native';

// Both of these must be set up at module scope, before registerRootComponent,
// so they also exist in headless JS when Android starts the app process with
// no UI (app killed, then a location update or a notification action arrives):
// - importing backgroundTask defines the expo-task-manager location task;
// - onBackgroundEvent handles Snooze/Dismiss pressed on an alarm notification.
import './src/location/backgroundTask';
import { handleBackgroundAlarmEvent } from './src/alarm/alarmEvents';
import App from './App';

notifee.onBackgroundEvent(handleBackgroundAlarmEvent);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
