import { Event } from '@notifee/react-native';
import { createFakeStackNavigation } from './fakeStackNavigation.testutil';
import { showAlarm, leaveAlarm, resetToJourneys, createAlarmNavigator } from './alarmNavigation';
import { createBackgroundAlarmEventHandler, createForegroundAlarmEventHandler } from '../alarm/alarmEvents';

jest.mock('@notifee/react-native', () => ({
  EventType: { UNKNOWN: -1, DISMISSED: 0, PRESS: 1, ACTION_PRESS: 2, DELIVERED: 3 },
}));
jest.mock('../alarm/alarmActions', () => ({
  snoozeAlarm: jest.fn(),
  dismissAlarm: jest.fn(),
  nextRouteAfterAlarm: jest.requireActual('../alarm/alarmActions').nextRouteAfterAlarm,
}));
jest.mock('../db/expoSqliteClient', () => ({}));
jest.mock('../db/journeysRepo', () => ({}));
jest.mock('../db/locationLogRepo', () => ({}));
jest.mock('../location/locationService', () => ({}));

const J = { name: 'Journeys' };
const CJ = (journeyId: number) => ({ name: 'CurrentJourney', params: { journeyId } });
const ALARM = (journeyId: number, kind: string) => ({ name: 'Alarm', params: { journeyId, kind } });

const PRESS = 1;
const ACTION_PRESS = 2;
const DELIVERED = 3;
function event(type: number, id: string, pressActionId?: string): Event {
  return { type, detail: { notification: { id }, pressAction: pressActionId ? { id: pressActionId } : undefined } } as Event;
}
const actions = () => ({
  snoozeAlarm: jest.fn().mockResolvedValue(undefined),
  dismissAlarm: jest.fn().mockResolvedValue(undefined),
});

describe('showAlarm', () => {
  test('pushes the Alarm on top of a non-Alarm route', () => {
    const nav = createFakeStackNavigation([J, CJ(3)]);
    showAlarm(nav, { journeyId: 3, kind: 'gpsLoss' });
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'gpsLoss')]);
  });

  test('is a no-op when that exact Alarm is already on top', () => {
    const nav = createFakeStackNavigation([J, CJ(3), ALARM(3, 'arrival')]);
    showAlarm(nav, { journeyId: 3, kind: 'arrival' });
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'arrival')]);
    expect(nav.dispatch).not.toHaveBeenCalled();
  });

  test('replaces an Alarm of a different kind instead of stacking a second one', () => {
    const nav = createFakeStackNavigation([J, CJ(3), ALARM(3, 'gpsLoss')]);
    showAlarm(nav, { journeyId: 3, kind: 'arrival' });
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'arrival')]);
  });

  test('replaces an Alarm for a different journey', () => {
    const nav = createFakeStackNavigation([J, ALARM(1, 'arrival')]);
    showAlarm(nav, { journeyId: 2, kind: 'arrival' });
    expect(nav.routes()).toEqual([J, ALARM(2, 'arrival')]);
  });
});

describe('leaveAlarm', () => {
  test.each(['dismiss', 'snooze'])('arrival (%s) resets the stack to [Journeys]', () => {
    const nav = createFakeStackNavigation([J, CJ(3), ALARM(3, 'arrival')]);
    leaveAlarm(nav, 'arrival', 3);
    expect(nav.routes()).toEqual([J]);
  });

  test('gpsLoss pops back to the same journey\'s CurrentJourney directly below (same screen instance)', () => {
    const nav = createFakeStackNavigation([J, CJ(3), ALARM(3, 'gpsLoss')]);
    const cjKey = nav.keys()[1];
    leaveAlarm(nav, 'gpsLoss', 3);
    expect(nav.routes()).toEqual([J, CJ(3)]);
    expect(nav.keys()[1]).toBe(cjKey);
  });

  test('lowBattery with no CurrentJourney below replaces the Alarm with CurrentJourney', () => {
    const nav = createFakeStackNavigation([J, ALARM(3, 'lowBattery')]);
    leaveAlarm(nav, 'lowBattery', 3);
    expect(nav.routes()).toEqual([J, CJ(3)]);
  });

  test('gpsLoss with a different journey\'s CurrentJourney below replaces rather than pops', () => {
    const nav = createFakeStackNavigation([J, CJ(9), ALARM(3, 'gpsLoss')]);
    leaveAlarm(nav, 'gpsLoss', 3);
    expect(nav.routes()).toEqual([J, CJ(9), CJ(3)]);
  });
});

test('resetToJourneys leaves only Journeys', () => {
  const nav = createFakeStackNavigation([J, ALARM(3, 'arrival'), ALARM(4, 'arrival')]);
  resetToJourneys(nav);
  expect(nav.routes()).toEqual([J]);
});

describe('alarm event sequences against the real navigator adapter', () => {
  test('arrival DELIVERED while tracking, then Dismiss from the notification -> [Journeys]', async () => {
    const nav = createFakeStackNavigation([J, CJ(3)]);
    const handler = createForegroundAlarmEventHandler({ actions: actions(), navigator: createAlarmNavigator(nav) });

    await handler(event(DELIVERED, 'arrival-3'));
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'arrival')]);

    await handler(event(ACTION_PRESS, 'arrival-3', 'dismiss'));
    expect(nav.routes()).toEqual([J]);
  });

  test('arrival DELIVERED twice (e.g. retried trigger) still shows one Alarm', async () => {
    const nav = createFakeStackNavigation([J, CJ(3)]);
    const handler = createForegroundAlarmEventHandler({ actions: actions(), navigator: createAlarmNavigator(nav) });
    await handler(event(DELIVERED, 'arrival-3'));
    await handler(event(PRESS, 'arrival-3', 'default'));
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'arrival')]);
  });

  test('gpsLoss DELIVERED while tracking, then Snooze -> [Journeys, CurrentJourney] with one CurrentJourney', async () => {
    const nav = createFakeStackNavigation([J, CJ(3)]);
    const handler = createForegroundAlarmEventHandler({ actions: actions(), navigator: createAlarmNavigator(nav) });

    await handler(event(DELIVERED, 'gps-loss-3'));
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'gpsLoss')]);

    await handler(event(ACTION_PRESS, 'gps-loss-3', 'snooze'));
    expect(nav.routes()).toEqual([J, CJ(3)]);
  });

  test('gpsLoss Alarm showing, then arrival DELIVERED, then Dismiss -> [Journeys]', async () => {
    const nav = createFakeStackNavigation([J, CJ(3)]);
    const handler = createForegroundAlarmEventHandler({ actions: actions(), navigator: createAlarmNavigator(nav) });
    await handler(event(DELIVERED, 'gps-loss-3'));
    await handler(event(DELIVERED, 'arrival-3'));
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'arrival')]);
    await handler(event(ACTION_PRESS, 'arrival-3', 'dismiss'));
    expect(nav.routes()).toEqual([J]);
  });

  test.each([
    ['PRESS', event(PRESS, 'low-battery-3', 'default')],
    ['ACTION_PRESS default', event(ACTION_PRESS, 'low-battery-3', 'default')],
  ])('warm start: background %s with a live navigator opens the Alarm', async (_label, e) => {
    const nav = createFakeStackNavigation([J, CJ(3)]);
    const a = actions();
    await createBackgroundAlarmEventHandler(a, createAlarmNavigator(nav))(e);
    expect(nav.routes()).toEqual([J, CJ(3), ALARM(3, 'lowBattery')]);
    expect(a.snoozeAlarm).not.toHaveBeenCalled();
    expect(a.dismissAlarm).not.toHaveBeenCalled();
  });

  test('headless: background PRESS with no ready navigator does nothing', async () => {
    const nav = createFakeStackNavigation([J], { ready: false });
    await createBackgroundAlarmEventHandler(actions(), createAlarmNavigator(nav))(event(PRESS, 'arrival-3', 'default'));
    expect(nav.dispatch).not.toHaveBeenCalled();
  });

  test('background Dismiss action never navigates, even with a live navigator', async () => {
    const nav = createFakeStackNavigation([J, CJ(3), ALARM(3, 'arrival')]);
    const a = actions();
    await createBackgroundAlarmEventHandler(a, createAlarmNavigator(nav))(event(ACTION_PRESS, 'arrival-3', 'dismiss'));
    expect(a.dismissAlarm).toHaveBeenCalledWith(3, 'arrival');
    expect(nav.dispatch).not.toHaveBeenCalled();
  });
});
