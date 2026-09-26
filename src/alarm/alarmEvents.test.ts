import { Event } from '@notifee/react-native';
import {
  AlarmActionHandlers,
  AlarmNavigator,
  createBackgroundAlarmEventHandler,
  createForegroundAlarmEventHandler,
} from './alarmEvents';

// Only the EventType enum is used by alarmEvents; values match notifee's.
jest.mock('@notifee/react-native', () => ({
  EventType: { UNKNOWN: -1, DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
}));
// The real actions pull in the db/location stack; every test injects its own.
jest.mock('./alarmActions', () => ({
  snoozeAlarm: jest.fn(),
  dismissAlarm: jest.fn(),
  nextRouteAfterAlarm: jest.requireActual('./alarmActions').nextRouteAfterAlarm,
}));
jest.mock('../db/expoSqliteClient', () => ({}));
jest.mock('../db/journeysRepo', () => ({}));
jest.mock('../db/locationLogRepo', () => ({}));
jest.mock('../location/locationService', () => ({}));

const PRESS = 1;
const ACTION_PRESS = 2;
const DELIVERED = 3;
const DISMISSED = 0;

function event(type: number, notificationId: string | undefined, pressActionId?: string): Event {
  return {
    type,
    detail: {
      notification: notificationId === undefined ? undefined : { id: notificationId },
      pressAction: pressActionId ? { id: pressActionId } : undefined,
    },
  } as Event;
}

function makeActions(): jest.Mocked<AlarmActionHandlers> {
  return {
    snoozeAlarm: jest.fn().mockResolvedValue(undefined),
    dismissAlarm: jest.fn().mockResolvedValue(undefined),
  };
}

function makeNavigator(
  currentRoute?: { name: string; params?: object },
  ready = true
): jest.Mocked<AlarmNavigator> {
  return {
    isReady: jest.fn(() => ready),
    getCurrentRoute: jest.fn(() => currentRoute),
    showAlarm: jest.fn(),
    replaceCurrent: jest.fn(),
  };
}

let warnSpy: jest.SpyInstance;
beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('background handler', () => {
  test('snooze action press snoozes the parsed alarm', async () => {
    const actions = makeActions();
    await createBackgroundAlarmEventHandler(actions)(event(ACTION_PRESS, 'gps-loss-4', 'snooze'));
    expect(actions.snoozeAlarm).toHaveBeenCalledWith(4, 'gpsLoss');
    expect(actions.dismissAlarm).not.toHaveBeenCalled();
  });

  test('dismiss action press dismisses the parsed alarm', async () => {
    const actions = makeActions();
    await createBackgroundAlarmEventHandler(actions)(event(ACTION_PRESS, 'arrival-12', 'dismiss'));
    expect(actions.dismissAlarm).toHaveBeenCalledWith(12, 'arrival');
    expect(actions.snoozeAlarm).not.toHaveBeenCalled();
  });

  test.each([
    ['a non-alarm notification id', event(ACTION_PRESS, 'expo-location-service', 'dismiss')],
    ['a missing notification', event(ACTION_PRESS, undefined, 'dismiss')],
    ['an unknown action id', event(ACTION_PRESS, 'arrival-1', 'other')],
    ['a plain press', event(PRESS, 'arrival-1', 'default')],
    ['a delivery', event(DELIVERED, 'arrival-1')],
    ['a swipe-away', event(DISMISSED, 'arrival-1')],
  ])('ignores %s', async (_label, e) => {
    const actions = makeActions();
    await createBackgroundAlarmEventHandler(actions)(e);
    expect(actions.snoozeAlarm).not.toHaveBeenCalled();
    expect(actions.dismissAlarm).not.toHaveBeenCalled();
  });

  test('never throws when the action fails; logs a warning instead', async () => {
    const actions = makeActions();
    actions.dismissAlarm.mockRejectedValue(new Error('db down'));
    await expect(
      createBackgroundAlarmEventHandler(actions)(event(ACTION_PRESS, 'arrival-1', 'dismiss'))
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('foreground handler', () => {
  test('action press on the alarm currently shown runs the action, then replaces the Alarm route', async () => {
    const actions = makeActions();
    const nav = makeNavigator({ name: 'Alarm', params: { journeyId: 3, kind: 'arrival' } });
    await createForegroundAlarmEventHandler({ actions, navigator: nav })(event(ACTION_PRESS, 'arrival-3', 'dismiss'));

    expect(actions.dismissAlarm).toHaveBeenCalledWith(3, 'arrival');
    expect(nav.replaceCurrent).toHaveBeenCalledWith({ name: 'Journeys' });
    expect((actions.dismissAlarm as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (nav.replaceCurrent as jest.Mock).mock.invocationCallOrder[0]
    );
    expect(nav.showAlarm).not.toHaveBeenCalled();
  });

  test('snooze from the notification while on that GPS-loss alarm returns to Current Journey', async () => {
    const actions = makeActions();
    const nav = makeNavigator({ name: 'Alarm', params: { journeyId: 3, kind: 'gpsLoss' } });
    await createForegroundAlarmEventHandler({ actions, navigator: nav })(event(ACTION_PRESS, 'gps-loss-3', 'snooze'));

    expect(actions.snoozeAlarm).toHaveBeenCalledWith(3, 'gpsLoss');
    expect(nav.replaceCurrent).toHaveBeenCalledWith({ name: 'CurrentJourney', params: { journeyId: 3 } });
  });

  test.each([
    ['a different screen', { name: 'CurrentJourney', params: { journeyId: 3 } }],
    ['an Alarm for a different kind', { name: 'Alarm', params: { journeyId: 3, kind: 'lowBattery' } }],
    ['an Alarm for a different journey', { name: 'Alarm', params: { journeyId: 9, kind: 'arrival' } }],
  ])('action press while on %s runs the action without navigating', async (_label, route) => {
    const actions = makeActions();
    const nav = makeNavigator(route);
    await createForegroundAlarmEventHandler({ actions, navigator: nav })(event(ACTION_PRESS, 'arrival-3', 'dismiss'));

    expect(actions.dismissAlarm).toHaveBeenCalledWith(3, 'arrival');
    expect(nav.replaceCurrent).not.toHaveBeenCalled();
    expect(nav.showAlarm).not.toHaveBeenCalled();
  });

  test('a failed action leaves the Alarm screen in place and does not throw', async () => {
    const actions = makeActions();
    actions.snoozeAlarm.mockRejectedValue(new Error('boom'));
    const nav = makeNavigator({ name: 'Alarm', params: { journeyId: 3, kind: 'arrival' } });
    await expect(
      createForegroundAlarmEventHandler({ actions, navigator: nav })(event(ACTION_PRESS, 'arrival-3', 'snooze'))
    ).resolves.toBeUndefined();
    expect(nav.replaceCurrent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('action press when the navigator is not ready still runs the action', async () => {
    const actions = makeActions();
    const nav = makeNavigator(undefined, false);
    await createForegroundAlarmEventHandler({ actions, navigator: nav })(event(ACTION_PRESS, 'low-battery-3', 'dismiss'));
    expect(actions.dismissAlarm).toHaveBeenCalledWith(3, 'lowBattery');
    expect(nav.replaceCurrent).not.toHaveBeenCalled();
  });

  test.each([
    ['PRESS', PRESS],
    ['DELIVERED', DELIVERED],
  ])('%s of an alarm id opens the Alarm screen', async (_label, type) => {
    const actions = makeActions();
    const nav = makeNavigator({ name: 'CurrentJourney', params: { journeyId: 3 } });
    await createForegroundAlarmEventHandler({ actions, navigator: nav })(event(type, 'low-battery-3', 'default'));

    expect(nav.showAlarm).toHaveBeenCalledWith({ journeyId: 3, kind: 'lowBattery' });
    expect(actions.snoozeAlarm).not.toHaveBeenCalled();
    expect(actions.dismissAlarm).not.toHaveBeenCalled();
  });

  test('DELIVERED while already on an Alarm for a different kind opens the new alarm', async () => {
    const nav = makeNavigator({ name: 'Alarm', params: { journeyId: 3, kind: 'gpsLoss' } });
    await createForegroundAlarmEventHandler({ actions: makeActions(), navigator: nav })(event(DELIVERED, 'arrival-3'));
    expect(nav.showAlarm).toHaveBeenCalledWith({ journeyId: 3, kind: 'arrival' });
  });

  test('PRESS/DELIVERED of the alarm already shown does not navigate again', async () => {
    const nav = makeNavigator({ name: 'Alarm', params: { journeyId: 3, kind: 'arrival' } });
    const handler = createForegroundAlarmEventHandler({ actions: makeActions(), navigator: nav });
    await handler(event(DELIVERED, 'arrival-3'));
    await handler(event(PRESS, 'arrival-3', 'default'));
    expect(nav.showAlarm).not.toHaveBeenCalled();
  });

  test('PRESS/DELIVERED of a non-alarm notification is ignored', async () => {
    const nav = makeNavigator({ name: 'Journeys' });
    const handler = createForegroundAlarmEventHandler({ actions: makeActions(), navigator: nav });
    await handler(event(DELIVERED, 'expo-location-service'));
    await handler(event(PRESS, undefined, 'default'));
    expect(nav.showAlarm).not.toHaveBeenCalled();
  });

  test('DELIVERED before the navigator is ready does not navigate', async () => {
    const nav = makeNavigator(undefined, false);
    await createForegroundAlarmEventHandler({ actions: makeActions(), navigator: nav })(event(DELIVERED, 'arrival-3'));
    expect(nav.showAlarm).not.toHaveBeenCalled();
  });

  test('a navigation error is caught, not thrown', async () => {
    const nav = makeNavigator({ name: 'Journeys' });
    nav.showAlarm.mockImplementation(() => {
      throw new Error('nav exploded');
    });
    await expect(
      createForegroundAlarmEventHandler({ actions: makeActions(), navigator: nav })(event(DELIVERED, 'arrival-3'))
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
