import { describe, expect, test } from 'bun:test';

import { sportCategory, type SportCategory } from './sportCategory';

describe('sportCategory', () => {
  // The watch's English sport names (workouts.json `sport.*`), the manual and phone names, and FIT imports with their maker.
  const cases: [string, SportCategory][] = [
    ['Running', 'run'],
    ['Indoor Running', 'run'],
    ['Trail run', 'run'],
    ['Treadmill run', 'run'],
    ['Obstacle race', 'run'],
    ['Run (Garmin)', 'run'],
    ['Walking', 'walk'],
    ['Indoor Walking', 'walk'],
    ['Hiking', 'walk'],
    ['Mountain Hike', 'walk'],
    ['Orienteering', 'walk'],
    ['Biking', 'ride'],
    ['Indoor Cycling', 'ride'],
    ['Spinning', 'ride'],
    ['BMX', 'ride'],
    ['Indoor ride', 'ride'],
    ['Pool Swimming', 'swim'],
    ['Swimming (Open water)', 'swim'],
    ['Strength Training', 'gym'],
    ['Crossfit', 'gym'],
    ['Functional training', 'gym'],
    ['Core Training', 'gym'],
    ['Physical training', 'gym'],
    ['Horizontal bar', 'gym'],
    ['High-intensity Interval Training', 'cardio'],
    ['Jumping Rope', 'cardio'],
    ['Aerobics', 'cardio'],
    ['Elliptical Trainer', 'cardio'],
    ['Rowing Machine', 'cardio'],
    ['Stepper', 'cardio'],
    ['Stairs', 'cardio'],
    ['Boxing', 'cardio'],
    ['Body combat', 'cardio'],
    ['Taekwondo', 'cardio'],
    ['Street Dance', 'cardio'],
    ['Plaza dancing', 'cardio'],
    ['Hula hoop', 'cardio'],
    ['Yoga', 'flow'],
    ['Pilates', 'flow'],
    ['Tai chi', 'flow'],
    ['Badminton', 'court'],
    ['Ping Pong', 'court'],
    ['Tennis', 'court'],
    ['Padel', 'court'],
    ['Soccer', 'court'],
    ['Beach Soccer', 'court'],
    ['Basketball', 'court'],
    ['Volleyball', 'court'],
    ['Sepak Takraw', 'court'],
    ['Ice hockey', 'court'],
    ['Frisbee', 'court'],
    ['Golf', 'other'],
    ['Rowing', 'other'],
    ['Standup Paddleboarding', 'other'],
    ['Ice Skating', 'other'],
    ['Rock climbing', 'other'],
    ['Esports', 'other'],
  ];

  test.each(cases)('%s is %s', (name, category) => {
    expect(sportCategory(name)).toBe(category);
  });

  test('a machine or a class is not the outdoor sport its name contains', () => {
    // "Air walker" is a cardio machine, not a walk; "Rowing Machine" is cardio, the boat is not.
    expect(sportCategory('Air walker')).toBe('cardio');
    expect(sportCategory('Rowing Machine')).not.toBe(sportCategory('Rowing'));
    // Horse riding is no bike ride.
    expect(sportCategory('Horse riding')).toBe('other');
  });

  test('diving stays out of the swim family even though its sport kind reads as a swim', () => {
    expect(sportCategory('Free Diving', undefined, 'swim')).toBe('other');
    expect(sportCategory('SCUBA Diving', 'SWIMMING', 'swim')).toBe('other');
  });

  test('a name it does not know falls back to the activity kind, then the sport kind', () => {
    expect(sportCategory('Workout (type 9)', 'STRENGTH_TRAINING')).toBe('gym');
    expect(sportCategory('Workout (type 9)', 'JUMP_ROPING')).toBe('cardio');
    expect(sportCategory('Workout (type 9)', 'YOGA')).toBe('flow');
    expect(sportCategory('Lari', undefined, 'run')).toBe('run');
    expect(sportCategory('Bersepeda', undefined, 'ride')).toBe('ride');
    expect(sportCategory('Workout', 'EXERCISE', 'other')).toBe('other');
    expect(sportCategory('Workout')).toBe('other');
  });
});
