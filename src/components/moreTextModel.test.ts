import { describe, expect, it } from 'bun:test';

import { splitLead } from './moreTextModel';

const risk =
  'Off by default. When on and the watch asks for the HW_AGNSS kind, JoyoFit sends satellite data that JoyoFit\'s server builds from public broadcast data (IGS/BKG), not from Huawei. A factory reset recovers the watch.';

describe('splitLead', () => {
  it('keeps short text whole', () => {
    expect(splitLead('Installs the way Gadgetbridge does. Keep off unless faces are deleted.')).toBeNull();
  });

  it('splits long text after the first sentence', () => {
    expect(splitLead(risk)).toEqual({ lead: 'Off by default.', rest: risk.slice('Off by default.'.length).trim() });
  });

  it('does not cut inside numbers or file names', () => {
    const text = `Hs.NothingV1.0_Fit: The upload finished (watch status 1) but the watch does not list the new face. ${'x'.repeat(120)}`;
    expect(splitLead(text)?.lead).toBe('Hs.NothingV1.0_Fit: The upload finished (watch status 1) but the watch does not list the new face.');
  });

  it('shows text whole when the first sentence is nearly all of it', () => {
    expect(splitLead(`${'a'.repeat(170)}. Short tail.`)).toBeNull();
  });

  it('shows text whole when it has no sentence break', () => {
    expect(splitLead('a'.repeat(300))).toBeNull();
  });
});
