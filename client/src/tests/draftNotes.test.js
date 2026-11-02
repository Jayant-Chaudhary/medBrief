import { describe, it, expect } from 'vitest';
import { draftToNotesText } from '../utils/draftNotes.js';

describe('draftToNotesText', () => {
  it('formats every section of a synthetic draft', () => {
    const text = draftToNotesText({
      chief_complaint: 'Synthetic complaint',
      vitals_observed: 'Synthetic vitals',
      assessment: 'Synthetic assessment',
      plan_and_recommendations: [{ recommendation: 'Synthetic step one' }, { recommendation: 'Synthetic step two' }],
    });
    expect(text).toContain('CHIEF COMPLAINT:\nSynthetic complaint');
    expect(text).toContain('PLAN & RECOMMENDATIONS:\n- Synthetic step one\n- Synthetic step two');
  });

  it('skips empty sections and handles a missing draft', () => {
    expect(draftToNotesText({ assessment: 'Only this' })).toBe('ASSESSMENT:\nOnly this');
    expect(draftToNotesText(null)).toBe('');
  });
});
