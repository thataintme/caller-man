export type RootStackParamList = {
  Welcome: undefined;
  Journeys: undefined;
  NewJourney: undefined;
  DefaultSettings: undefined;
  About: undefined;
  CurrentJourney: { journeyId: number };
  Alarm: { journeyId: number; kind: 'arrival' | 'gpsLoss' | 'lowBattery' };
};
