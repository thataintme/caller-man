import { createNavigationContainerRef, StackActions } from '@react-navigation/native';
import { RootStackParamList } from './types';
import { AlarmNavigator } from '../alarm/alarmEvents';

/**
 * App-wide ref to the root NavigationContainer, so code outside the screen
 * tree (notifee's foreground event handler) can read and change the route.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** The alarm event handler's view of navigationRef. */
export const alarmNavigator: AlarmNavigator = {
  isReady: () => navigationRef.isReady(),
  getCurrentRoute: () => navigationRef.getCurrentRoute(),
  showAlarm: (params) => navigationRef.dispatch(StackActions.push('Alarm', params)),
  replaceCurrent: (route) =>
    navigationRef.dispatch(
      route.name === 'Journeys' ? StackActions.replace('Journeys') : StackActions.replace(route.name, route.params)
    ),
};
