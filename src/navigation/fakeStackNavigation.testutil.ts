import { NavigationAction, StackRouter, StackNavigationState, ParamListBase } from '@react-navigation/native';

/**
 * Test-only fake of the root stack navigation: holds a real stack state and
 * applies dispatched actions with React Navigation's own StackRouter, so
 * adapter tests see the same push/replace/pop/reset semantics as the app.
 * Exposes both the screen-navigation shape (getState/dispatch) and the
 * navigationRef shape (isReady/getRootState/getCurrentRoute).
 */
const ROUTE_NAMES = ['Welcome', 'Journeys', 'NewJourney', 'DefaultSettings', 'About', 'CurrentJourney', 'Alarm'];

export type FakeRoute = { name: string; params?: object };

export function createFakeStackNavigation(initialRoutes: FakeRoute[], { ready = true } = {}) {
  const router = StackRouter({});
  const options = { routeNames: ROUTE_NAMES, routeParamList: {}, routeGetIdList: {} };
  let state = router.getRehydratedState(
    { index: initialRoutes.length - 1, routes: initialRoutes } as any,
    options
  ) as StackNavigationState<ParamListBase>;

  const fake = {
    isReady: jest.fn(() => ready),
    getState: () => state,
    getRootState: () => state,
    getCurrentRoute: () => state.routes[state.index],
    isFocused: () => true,
    dispatch: jest.fn((action: NavigationAction) => {
      let next = router.getStateForAction(state, action as any, options);
      if (next === null) throw new Error(`Fake stack could not handle ${action.type}`);
      if ((next as { stale?: boolean }).stale !== false) {
        next = router.getRehydratedState(next as any, options);
      }
      state = next as StackNavigationState<ParamListBase>;
    }),
    /** The stack as plain {name, params} entries, bottom to top. */
    routes: (): FakeRoute[] =>
      state.routes.map((r) => (r.params === undefined ? { name: r.name } : { name: r.name, params: r.params })),
    /** Unique route keys (to prove a pop kept the original screen instance). */
    keys: () => state.routes.map((r) => r.key),
  };
  return fake;
}
