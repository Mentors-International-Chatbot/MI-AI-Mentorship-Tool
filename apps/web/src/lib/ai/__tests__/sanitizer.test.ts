import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForDelivery } from '../sanitizer';

test('strips strong/italic markers', () => {
  assert.equal(sanitizeForDelivery('**hola**'), 'hola');
  assert.equal(sanitizeForDelivery('*hola*'), 'hola');
  assert.equal(sanitizeForDelivery('__hola__'), 'hola');
  assert.equal(sanitizeForDelivery('_hola_'), 'hola');
});

test('replaces em dash', () => {
  assert.equal(sanitizeForDelivery('A — B'), 'A - B');
});

test('strips headers', () => {
  assert.equal(sanitizeForDelivery('# Titulo'), 'Titulo');
});

test('converts bullet lists to flowing text', () => {
  const input = '- uno\n- dos';
  assert.equal(sanitizeForDelivery(input), 'uno, dos.');
});

test('converts numbered lists to flowing text', () => {
  const input = '1. primero\n2. segundo';
  assert.equal(sanitizeForDelivery(input), 'primero, segundo.');
});

test('strips inline backticks', () => {
  assert.equal(sanitizeForDelivery('usa `code`'), 'usa code');
});

test('keeps inner code block text (without fences)', () => {
  const input = '```js\nconst x = 1;\n```';
  assert.equal(sanitizeForDelivery(input), 'const x = 1;');
});

test('collapses extra newlines', () => {
  const input = 'a\n\n\nb';
  assert.equal(sanitizeForDelivery(input), 'a\n\nb');
});

test('preserves system markers that look like brackets', () => {
  const input = 'Texto [FLAG:RED|crisis financiera] fin';
  assert.equal(
    sanitizeForDelivery(input),
    'Texto [FLAG:RED|crisis financiera] fin'
  );
});

