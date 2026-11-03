// Run from client/: node scripts/verifyPrescriptionRendering.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { InlineGhostField } = await server.ssrLoadModule('/src/components/prescriptions/InlineGhostField.jsx');
  let changes = 0;
  const fields = [['Name', 'Synthetic medicine'], ['Dose', 'Saved dose'], ['Frequency', 'Saved frequency'], ['Duration', 'Saved duration']];
  const html = renderToStaticMarkup(React.createElement('fieldset', {}, fields.map(([label, suggestedValue]) =>
    React.createElement(InlineGhostField, { key: label, label, value: '', suggestedValue, onChange() { changes++; } }))));
  for (const expected of ['rx-inline-ghost-text', 'Synthetic medicine', 'Saved dose', 'Saved frequency', 'Saved duration', 'Tab accepts saved text']) {
    assert.ok(html.includes(expected), `Missing rendered content: ${expected}`);
  }
  assert.equal((html.match(/class="rx-inline-ghost-text"/g) || []).length, 4);
  assert.equal((html.match(/value=""/g) || []).length >= 4, true);
  assert.equal(changes, 0, 'Rendering ghost text must not write prescription values');
  const partial = renderToStaticMarkup(React.createElement(InlineGhostField, { label: 'Name', value: 'Syn', suggestedValue: 'Synthetic medicine', onChange() {} }));
  assert.ok(partial.includes('rx-inline-ghost-prefix">Syn</span>thetic medicine'));
  assert.ok(partial.includes('value="Syn"'));
  console.log('PASS: four medicine inputs render saved name/dose/frequency/duration as inline ghost overlays, with empty actual values and no draft writes.');
} finally { await server.close(); }
