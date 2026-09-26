import type { InitialState } from '@react-navigation/native';
import type { StartupRoute } from './resolveStartupRoute';

/**
 * The NavigationContainer initialState for a startup route. Used instead of
 * initialRouteName so the route's params reach the screen, and so Back from
 * Current Journey / Alarm lands on Journeys instead of exiting the app.
 * Welcome stands alone: it replaces itself with Journeys once permissions
 * are granted.
 */
export function initialNavigationState(route: StartupRoute): InitialState {
  if (route.name === 'Journeys' || route.name === 'Welcome') {
    return { index: 0, routes: [{ name: route.name }] };
  }
  return { index: 1, routes: [{ name: 'Journeys' }, { name: route.name, params: route.params }] };
}
