import { describe, it, expect } from 'vitest';
import { colors, radii, space, statusToneColors } from './index';

describe('design tokens', () => {
  it('exposes the prototype palette as CSS var references', () => {
    expect(colors.navy).toBe('var(--navy)');
    expect(colors.gold).toBe('var(--gold)');
    expect(colors.emerald).toBe('var(--emerald)');
    expect(colors.brick).toBe('var(--brick)');
  });

  it('maps every status tone to a foreground/background pair', () => {
    for (const tone of ['good', 'watch', 'bad', 'loss', 'neutral'] as const) {
      expect(statusToneColors[tone]).toHaveProperty('fg');
      expect(statusToneColors[tone]).toHaveProperty('bg');
    }
  });

  it('exposes the observed radius and spacing scales', () => {
    expect(radii.pill).toBe('var(--radius-pill)');
    expect(space[7]).toBe('var(--space-7)');
  });
});
