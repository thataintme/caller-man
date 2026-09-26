import { CommonActions, NavigationAction, StackActions } from '@react-navigation/native';
import type { AlarmKind } from '../alarm/alarmManager';
import type { AlarmNavigator } from '../alarm/alarmEvents';
import { nextRouteAfterAlarm } from '../alarm/alarmActions';

/**
 * Stack-aware navigation for the Alarm screen, shared by AlarmScreen (via its
 * `navigation` prop) and the notifee event handlers (via navigationRef).
 * Everything goes through getState/dispatch on the root stack so the same
 * rules apply wherever an alarm is opened or left, and the stack never ends
 * up with two Alarm or two CurrentJourney screens.
 */
export interface StackNavigationLike {
  getState(): { index: number; routes: ReadonlyArray<{ name: string; params?: object }> };
  dispatch(action: NavigationAction): void;
}

type AlarmTarget = { journeyId: number; kind: AlarmKind };

function topRoute(nav: StackNavigationLike) {
  const state = nav.getState();
  return state.routes[state.index];
}

function isAlarmFor(route: { name: string; params?: object } | undefined, target: AlarmTarget): boolean {
  if (!route || route.name !== 'Alarm') return false;
  const params = route.params as Partial<AlarmTarget> | undefined;
  return params?.journeyId === target.journeyId && params?.kind === target.kind;
}

/**
 * Shows the Alarm for `target`: nothing if it's already on top; replaces an
 * Alarm for a different kind/journey (one alarm screen at a time — the
 * other alarm's notification is still there); otherwise pushes on top.
 */
export function showAlarm(nav: StackNavigationLike, target: AlarmTarget): void {
  const top = topRoute(nav);
  if (isAlarmFor(top, target)) return;
  const params = { journeyId: target.journeyId, kind: target.kind };
  nav.dispatch(top?.name === 'Alarm' ? StackActions.replace('Alarm', params) : StackActions.push('Alarm', params));
}

/** Resets the whole stack to just Journeys. */
export function resetToJourneys(nav: StackNavigationLike): void {
  nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Journeys' }] }));
}

/**
 * Leaves the Alarm on top of the stack after it was snoozed/dismissed:
 * arrival ends the journey, so the stack resets to [Journeys]; GPS-loss/low-
 * battery pop back to the same journey's CurrentJourney if it's directly
 * below, otherwise the Alarm is replaced with CurrentJourney.
 */
export function leaveAlarm(nav: StackNavigationLike, kind: AlarmKind, journeyId: number): void {
  const next = nextRouteAfterAlarm(kind, journeyId);
  if (next.name === 'Journeys') {
    resetToJourneys(nav);
    return;
  }
  const state = nav.getState();
  const below = state.routes[state.index - 1];
  const belowJourneyId = (below?.params as { journeyId?: number } | undefined)?.journeyId;
  if (below?.name === 'CurrentJourney' && belowJourneyId === journeyId) {
    nav.dispatch(StackActions.pop());
  } else {
    nav.dispatch(StackActions.replace('CurrentJourney', next.params));
  }
}

/** The event handlers' AlarmNavigator on top of a root stack navigation. */
export function createAlarmNavigator(nav: StackNavigationLike & { isReady(): boolean }): AlarmNavigator {
  return {
    isReady: () => nav.isReady(),
    getCurrentRoute: () => topRoute(nav),
    showAlarm: (target) => showAlarm(nav, target),
    leaveAlarm: (target) => leaveAlarm(nav, target.kind, target.journeyId),
  };
}
