import { Event, EventType } from '@notifee/react-native';
import { AlarmKind, parseAlarmNotificationId } from './alarmManager';
import { dismissAlarm, snoozeAlarm } from './alarmActions';
import { alarmNavigator } from '../navigation/navigationRef';

/**
 * notifee event handling for alarm notifications (spec §8/§9).
 *
 * - Background (registered at module scope in index.ts, so it also runs in
 *   headless JS when the app is killed): Snooze/Dismiss action presses run
 *   the action, without navigating. A tap on the alarm (PRESS / 'default')
 *   opens the Alarm screen only on a warm start, i.e. when the app's
 *   navigator is alive (isReady); in headless JS it isn't, so it's a no-op
 *   and cold start is handled by resolveStartupRoute.
 * - Foreground (registered by App while mounted): the same actions, plus
 *   keeping the navigator in sync — leave an Alarm screen whose alarm was
 *   just handled from the notification, and open the Alarm screen when an
 *   alarm is delivered/pressed (a full-screen intent doesn't cover the app
 *   when it's already in the foreground).
 *
 * Handlers take their dependencies so they can be unit-tested without a
 * real navigator or the db/location stack.
 */

export interface AlarmActionHandlers {
  snoozeAlarm: (journeyId: number, kind: AlarmKind) => Promise<void>;
  dismissAlarm: (journeyId: number, kind: AlarmKind) => Promise<void>;
}

export interface AlarmNavigator {
  isReady(): boolean;
  getCurrentRoute(): { name: string; params?: object } | undefined;
  /** Show the Alarm screen for this alarm (see navigation/alarmNavigation). */
  showAlarm(target: { journeyId: number; kind: AlarmKind }): void;
  /** Leave the Alarm screen for this alarm after it was handled. */
  leaveAlarm(target: { journeyId: number; kind: AlarmKind }): void;
}

type AlarmTarget = { journeyId: number; kind: AlarmKind };

const defaultActions: AlarmActionHandlers = { snoozeAlarm, dismissAlarm };

function alarmTargetOf(event: Event): AlarmTarget | null {
  return parseAlarmNotificationId(event.detail.notification?.id);
}

/**
 * Runs Snooze/Dismiss for an ACTION_PRESS on one of our alarm notifications.
 * Returns the alarm it acted on, or null if the event wasn't an alarm action
 * or the action failed (failures are logged, never thrown — a throw in a
 * notifee handler is just an unhandled rejection with nothing to show it).
 */
async function runAlarmAction(event: Event, actions: AlarmActionHandlers): Promise<AlarmTarget | null> {
  if (event.type !== EventType.ACTION_PRESS) return null;
  const target = alarmTargetOf(event);
  if (!target) return null;

  const actionId = event.detail.pressAction?.id;
  try {
    if (actionId === 'snooze') {
      await actions.snoozeAlarm(target.journeyId, target.kind);
    } else if (actionId === 'dismiss') {
      await actions.dismissAlarm(target.journeyId, target.kind);
    } else {
      return null;
    }
  } catch (error) {
    console.warn(`Failed to ${actionId} alarm ${event.detail.notification?.id}`, error);
    return null;
  }
  return target;
}

/** A tap on the alarm notification itself (body or full-screen intent). */
function isOpenAlarmEvent(event: Event): boolean {
  return (
    event.type === EventType.PRESS ||
    (event.type === EventType.ACTION_PRESS && event.detail.pressAction?.id === 'default')
  );
}

function openAlarmIfReady(event: Event, navigator: AlarmNavigator): void {
  const target = alarmTargetOf(event);
  if (!target || !navigator.isReady() || isShowingAlarm(navigator, target)) return;
  navigator.showAlarm(target);
}

function isShowingAlarm(navigator: AlarmNavigator, target: AlarmTarget): boolean {
  const route = navigator.getCurrentRoute();
  if (!route || route.name !== 'Alarm') return false;
  const params = route.params as Partial<AlarmTarget> | undefined;
  return params?.journeyId === target.journeyId && params?.kind === target.kind;
}

export function createBackgroundAlarmEventHandler(
  actions: AlarmActionHandlers = defaultActions,
  navigator: AlarmNavigator = alarmNavigator
): (event: Event) => Promise<void> {
  return async (event) => {
    try {
      if (isOpenAlarmEvent(event)) {
        openAlarmIfReady(event, navigator);
        return;
      }
      await runAlarmAction(event, actions);
    } catch (error) {
      console.warn('Background alarm event handling failed', error);
    }
  };
}

export const handleBackgroundAlarmEvent = createBackgroundAlarmEventHandler();

export function createForegroundAlarmEventHandler({
  actions = defaultActions,
  navigator = alarmNavigator,
}: {
  actions?: AlarmActionHandlers;
  navigator?: AlarmNavigator;
} = {}): (event: Event) => Promise<void> {
  return async (event) => {
    try {
      if (isOpenAlarmEvent(event) || event.type === EventType.DELIVERED) {
        openAlarmIfReady(event, navigator);
        return;
      }

      if (event.type === EventType.ACTION_PRESS) {
        const handled = await runAlarmAction(event, actions);
        if (handled && navigator.isReady() && isShowingAlarm(navigator, handled)) {
          navigator.leaveAlarm(handled);
        }
      }
    } catch (error) {
      console.warn('Foreground alarm event handling failed', error);
    }
  };
}
