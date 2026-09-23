import { Journey } from '../types/journey';

export function resolveInitialRoute(activeJourney: Journey | null): 'Journeys' | 'CurrentJourney' {
  return activeJourney ? 'CurrentJourney' : 'Journeys';
}
