import { Journey } from '../types/journey';

export type InitialRoute =
  | { name: 'Journeys' }
  | { name: 'CurrentJourney'; params: { journeyId: number } }
  | { name: 'Alarm'; params: { journeyId: number; kind: 'arrival' } };

export function resolveInitialRoute(activeJourney: Journey | null): InitialRoute {
  if (!activeJourney) {
    return { name: 'Journeys' };
  }

  if (activeJourney.arrivedAt !== null) {
    return { name: 'Alarm', params: { journeyId: activeJourney.id, kind: 'arrival' } };
  }

  return { name: 'CurrentJourney', params: { journeyId: activeJourney.id } };
}
