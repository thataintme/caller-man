import { MAPBOX_ACCESS_TOKEN, isMapboxTokenConfigured } from './mapbox';

test('the placeholder token is not considered configured', () => {
  expect(MAPBOX_ACCESS_TOKEN.startsWith('REPLACE_')).toBe(true);
  expect(isMapboxTokenConfigured()).toBe(false);
});
