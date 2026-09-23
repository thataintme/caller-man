import { resolveInitialRoute } from './resolveInitialRoute';
import { Journey } from '../types/journey';

const activeJourney = { status: 'active' } as Journey;

test('routes to CurrentJourney when a journey is active', () => {
  expect(resolveInitialRoute(activeJourney)).toBe('CurrentJourney');
});

test('routes to Journeys when none is active', () => {
  expect(resolveInitialRoute(null)).toBe('Journeys');
});
