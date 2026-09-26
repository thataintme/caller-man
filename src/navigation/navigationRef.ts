import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParamList } from './types';
import { createAlarmNavigator } from './alarmNavigation';

/**
 * App-wide ref to the root NavigationContainer, so code outside the screen
 * tree (notifee's event handlers) can read and change the route.
 * isReady() is false in headless JS (no container mounted).
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** The alarm event handlers' view of navigationRef (root stack). */
export const alarmNavigator = createAlarmNavigator({
  isReady: () => navigationRef.isReady(),
  // getRootState() is undefined until the container is ready; the handlers
  // only navigate after isReady(), so the empty fallback is never acted on.
  getState: () => navigationRef.getRootState() ?? { index: -1, routes: [] },
  dispatch: (action) => navigationRef.dispatch(action),
});
