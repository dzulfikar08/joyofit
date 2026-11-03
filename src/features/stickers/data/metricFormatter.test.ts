import { describe, expect, it } from 'bun:test';
import { formatMetric } from './metricFormatter';

describe('formatMetric', () => {
  it('formats time with duration formatter', () => {
    const res = formatMetric({ movingSec: 3665 }, 'time', 'id');
    expect(res).not.toBeNull();
    expect(res?.value).toBe('1:01:05');
  });

  it('formats distance for running (km) and swimming (m)', () => {
    const runRes = formatMetric({ distanceM: 5200, category: 'run' }, 'distance', 'id');
    expect(runRes?.value).toBe('5,20');
    expect(runRes?.unit).toBe('km');

    const swimRes = formatMetric({ distanceM: 1500, category: 'swim' }, 'distance', 'id');
    expect(swimRes?.value).toBe('1.500');
    expect(swimRes?.unit).toBe('m');
  });

  it('formats pace for running and swimming', () => {
    const runPace = formatMetric({ paceSecKm: 330, category: 'run' }, 'pace', 'id');
    expect(runPace?.value).toBe('5:30');
    expect(runPace?.unit).toBe('/km');

    const swimPace = formatMetric({ pace100Sec: 105, category: 'swim' }, 'pace', 'id');
    expect(swimPace?.value).toBe('1:45');
    expect(swimPace?.unit).toBe('/100 m');
  });

  it('formats speed and max speed', () => {
    const speed = formatMetric({ speedKmh: 24.5 }, 'speed', 'id');
    expect(speed?.value).toBe('24,5');
    expect(speed?.unit).toBe('km/j');

    const maxSpeed = formatMetric({ maxSpeedKmh: 42.1 }, 'maxSpeed', 'id');
    expect(maxSpeed?.value).toBe('42,1');
    expect(maxSpeed?.unit).toBe('km/j');
  });

  it('formats heart rate metrics', () => {
    const hr = formatMetric({ hrAvg: 152 }, 'hr', 'id');
    expect(hr?.value).toBe('152');
    expect(hr?.unit).toBe('bpm');

    const hrMax = formatMetric({ hrMax: 185 }, 'hrMax', 'id');
    expect(hrMax?.value).toBe('185');

    const minHr = formatMetric({ minHr: 98 }, 'minHr', 'id');
    expect(minHr?.value).toBe('98');
  });

  it('formats elevation, cadence, power, steps, calories', () => {
    expect(formatMetric({ elevGainM: 350 }, 'elevation', 'id')?.value).toBe('350');
    expect(formatMetric({ elevLossM: 120 }, 'elevLoss', 'id')?.value).toBe('120');
    expect(formatMetric({ cadence: 85, category: 'ride' }, 'cadence', 'id')?.unit).toBe('rpm');
    expect(formatMetric({ cadence: 172, category: 'run' }, 'cadence', 'id')?.unit).toBe('spm');
    expect(formatMetric({ power: 250 }, 'power', 'id')?.value).toBe('250');
    expect(formatMetric({ steps: 8432 }, 'steps', 'id')?.value).toBe('8.432');
    expect(formatMetric({ kcal: 450 }, 'kcal', 'id')?.value).toBe('450');
  });

  it('formats swim-specific and strength metrics', () => {
    expect(formatMetric({ swimStyle: 'Gaya Bebas' }, 'swimStyle', 'id')?.value).toBe('Gaya Bebas');
    expect(formatMetric({ laps: 20 }, 'laps', 'id')?.value).toBe('20');
    expect(formatMetric({ swolf: 38 }, 'swolf', 'id')?.value).toBe('38');
    expect(formatMetric({ volumeKg: 3500 }, 'volume', 'id')?.value).toBe('3.500');
    expect(formatMetric({ sets: 12 }, 'sets', 'id')?.value).toBe('12');
    expect(formatMetric({ reps: 96 }, 'reps', 'id')?.value).toBe('96');
  });

  it('returns null for missing, non-positive or undefined values', () => {
    expect(formatMetric({}, 'time')).toBeNull();
    expect(formatMetric({ distanceM: 0 }, 'distance')).toBeNull();
    expect(formatMetric({ hrAvg: -10 }, 'hr')).toBeNull();
    expect(formatMetric({ speedKmh: null }, 'speed')).toBeNull();
    expect(formatMetric({}, 'unknownMetric')).toBeNull();
  });
});
