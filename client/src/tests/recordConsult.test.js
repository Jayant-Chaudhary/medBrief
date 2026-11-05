import { describe, it, expect } from 'vitest';
import { readPage } from '../components/assistant/pageReader';

describe('Doctor Consultation Modal and Controls (T4 - Client)', () => {
  it('reads modal controls marked never as effect: never', () => {
    const makeEl = (name, tag = 'BUTTON', effect = 'never') => {
      const el = {
        tagName: tag,
        type: tag === 'INPUT' ? 'checkbox' : 'button',
        dataset: { assistantEffect: effect },
        disabled: false,
        required: false,
        closest: (selector) => {
          if (selector.includes('data-assistant-effect')) return { dataset: { assistantEffect: effect } };
          return null;
        },
        getAttribute: (key) => (key === 'aria-label' ? name : null),
        setAttribute: () => {},
        hasAttribute: () => false,
        getClientRects: () => [1],
      };
      return el;
    };

    const neverControls = [
      'Proceed to mic check',
      'Run STT test',
      'Informed consent confirmation',
      'Confirm ready',
      'Start recording',
      'Stop consultation',
      'Download',
    ].map((name) => makeEl(name, name.includes('consent') ? 'INPUT' : 'BUTTON', 'never'));

    const doc = {
      title: 'Modal',
      querySelectorAll: () => [],
      body: {
        querySelectorAll: (selector) => {
          if (selector.includes('button') || selector.includes('input')) return neverControls;
          return [];
        },
      },
      defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    };
    neverControls.forEach((el) => {
      el.ownerDocument = doc;
    });

    const snapshot = readPage(doc).page;
    expect(snapshot.elements).toHaveLength(neverControls.length);
    snapshot.elements.forEach((el) => {
      expect(el.effect).toBe('never');
    });
  });

  it('reads free controls in modal as effect: free', () => {
    const makeEl = (name, effect = 'free') => {
      const el = {
        tagName: 'BUTTON',
        dataset: { assistantEffect: effect },
        disabled: false,
        required: false,
        closest: (selector) => {
          if (selector.includes('data-assistant-effect')) return { dataset: { assistantEffect: effect } };
          return null;
        },
        getAttribute: (key) => (key === 'aria-label' ? name : null),
        setAttribute: () => {},
        hasAttribute: () => false,
        getClientRects: () => [1],
      };
      return el;
    };

    const freeControls = [
      'Record tab',
      'Transcript Logs tab',
      'Close modal',
      'Refresh transcript',
      'Copy room code',
    ].map((name) => makeEl(name, 'free'));

    const doc = {
      title: 'Modal',
      querySelectorAll: () => [],
      body: {
        querySelectorAll: (selector) => (selector.includes('button') ? freeControls : []),
      },
      defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    };
    freeControls.forEach((el) => {
      el.ownerDocument = doc;
    });

    const snapshot = readPage(doc).page;
    expect(snapshot.elements).toHaveLength(freeControls.length);
    snapshot.elements.forEach((el) => {
      expect(el.effect).toBe('free');
    });
  });

  it('marks transcript area data-assistant-private so transcript text is never ingested', () => {
    const privateRegion = {};
    const el = {
      tagName: 'BUTTON',
      dataset: {},
      disabled: false,
      required: false,
      closest: (sel) => (sel.includes('data-assistant-private') ? privateRegion : null),
      getAttribute: () => null,
      setAttribute: () => {},
      hasAttribute: () => false,
      getClientRects: () => [1],
    };
    const doc = {
      title: 'Modal',
      querySelectorAll: () => [],
      body: {
        querySelectorAll: (selector) => (selector.includes('button') ? [el] : []),
      },
      defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
    };
    el.ownerDocument = doc;

    const snapshot = readPage(doc).page;
    expect(snapshot.elements[0]).toMatchObject({ private: true });
    expect(JSON.stringify(snapshot)).not.toMatch(/headache|blood pressure|Patient:/);
  });
});
