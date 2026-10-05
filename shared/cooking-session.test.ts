import { describe, it, expect } from 'vitest';
import { formatClock, parseSavedStep, parseSavedTimers, parseVoiceCommand, SAVED_STEP_MAX_AGE_MS } from './cooking-session';

const NOW = 1_800_000_000_000;

describe('parseSavedStep', () => {
  it('offers a saved step inside the recipe', () => {
    expect(parseSavedStep(JSON.stringify({ stepIndex: 3, savedAt: NOW - 1000 }), 8, NOW)).toBe(3);
  });
  it('ignores step 1, out-of-range, stale and malformed data', () => {
    expect(parseSavedStep(JSON.stringify({ stepIndex: 0, savedAt: NOW }), 8, NOW)).toBeNull();
    expect(parseSavedStep(JSON.stringify({ stepIndex: 8, savedAt: NOW }), 8, NOW)).toBeNull();
    expect(parseSavedStep(JSON.stringify({ stepIndex: 2, savedAt: NOW - SAVED_STEP_MAX_AGE_MS - 1 }), 8, NOW)).toBeNull();
    expect(parseSavedStep('not json', 8, NOW)).toBeNull();
    expect(parseSavedStep(null, 8, NOW)).toBeNull();
  });
});

describe('parseSavedTimers', () => {
  it('restores running timers and marks finished ones done', () => {
    const raw = JSON.stringify([
      { id: 'a', label: 'Step 2', stepIndex: 1, endsAt: NOW + 60_000, totalSeconds: 300, done: false },
      { id: 'b', label: 'Step 3', stepIndex: 2, endsAt: NOW - 1000, totalSeconds: 60, done: false },
      { id: 'c', label: 'Old', stepIndex: 0, endsAt: NOW - 2 * 60 * 60 * 1000, totalSeconds: 60, done: true },
      { id: 4, label: 'bad' },
    ]);
    const timers = parseSavedTimers(raw, NOW);
    expect(timers.map((t) => [t.id, t.done])).toEqual([['a', false], ['b', true]]);
  });
  it('tolerates junk', () => {
    expect(parseSavedTimers('{', NOW)).toEqual([]);
    expect(parseSavedTimers('{}', NOW)).toEqual([]);
  });
});

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(272)).toBe('4:32');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('parseVoiceCommand', () => {
  it('understands simple commands', () => {
    expect(parseVoiceCommand('Next')).toBe('next');
    expect(parseVoiceCommand('go back')).toBe('back');
    expect(parseVoiceCommand('repeat that')).toBe('repeat');
    expect(parseVoiceCommand('start the timer')).toBe('timer');
    expect(parseVoiceCommand('hello there')).toBeNull();
  });
});
