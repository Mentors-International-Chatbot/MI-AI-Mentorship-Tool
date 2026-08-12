import { sanitizeForDelivery } from '@/lib/ai/sanitizer';

describe('sanitizeForDelivery', () => {
  it('strips strong/italic markers', () => {
    expect(sanitizeForDelivery('**hola**')).toBe('hola');
    expect(sanitizeForDelivery('*hola*')).toBe('hola');
    expect(sanitizeForDelivery('__hola__')).toBe('hola');
    expect(sanitizeForDelivery('_hola_')).toBe('hola');
  });

  it('normalizes smart punctuation and spacing to plain ASCII', () => {
    expect(sanitizeForDelivery('A—B – “quoted”… it\u00a0works')).toBe('A, B, "quoted"... it works');
  });

  it('strips headers', () => {
    expect(sanitizeForDelivery('# Titulo')).toBe('Titulo');
  });

  it('converts bullet lists to flowing text', () => {
    const input = '- uno\n- dos';
    expect(sanitizeForDelivery(input)).toBe('uno, dos.');
  });

  it('converts numbered lists to flowing text', () => {
    const input = '1. primero\n2. segundo';
    expect(sanitizeForDelivery(input)).toBe('primero, segundo.');
  });

  it('strips inline backticks', () => {
    expect(sanitizeForDelivery('usa `code`')).toBe('usa code');
  });

  it('keeps inner code block text (without fences)', () => {
    const input = '```js\nconst x = 1;\n```';
    expect(sanitizeForDelivery(input)).toBe('const x = 1;');
  });

  it('normalizes real and literal newline sequences into one paragraph', () => {
    expect(sanitizeForDelivery('a\n\n\nb')).toBe('a b');
    expect(sanitizeForDelivery('a\\n\\nb')).toBe('a b');
  });

  it('keeps ordinary straight quotation marks', () => {
    expect(sanitizeForDelivery('Sort as "urgent" or "routine".')).toBe('Sort as "urgent" or "routine".');
  });

  it('preserves system markers that look like brackets', () => {
    const input = 'Texto [FLAG:RED|crisis financiera] fin';
    expect(sanitizeForDelivery(input)).toBe(
      'Texto [FLAG:RED|crisis financiera] fin'
    );
  });
});
