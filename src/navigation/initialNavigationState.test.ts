import { initialNavigationState } from './initialNavigationState';

test('Journeys is the only route', () => {
  expect(initialNavigationState({ name: 'Journeys' })).toEqual({ index: 0, routes: [{ name: 'Journeys' }] });
});

test('Welcome is the only route (no Journeys underneath to go back to)', () => {
  expect(initialNavigationState({ name: 'Welcome' })).toEqual({ index: 0, routes: [{ name: 'Welcome' }] });
});

test('CurrentJourney sits on top of Journeys, with its params', () => {
  expect(initialNavigationState({ name: 'CurrentJourney', params: { journeyId: 4 } })).toEqual({
    index: 1,
    routes: [{ name: 'Journeys' }, { name: 'CurrentJourney', params: { journeyId: 4 } }],
  });
});

test('Alarm sits on top of Journeys, with its params', () => {
  expect(initialNavigationState({ name: 'Alarm', params: { journeyId: 4, kind: 'lowBattery' } })).toEqual({
    index: 1,
    routes: [{ name: 'Journeys' }, { name: 'Alarm', params: { journeyId: 4, kind: 'lowBattery' } }],
  });
});
