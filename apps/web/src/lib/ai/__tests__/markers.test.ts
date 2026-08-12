import { parseMarkers } from '@/lib/ai/prompts/markers';

describe('parseMarkers', () => {
  it('returns clean text when no markers present', () => {
    const result = parseMarkers('Hola, ¿cómo va tu negocio?');
    expect(result.cleanText).toBe('Hola, ¿cómo va tu negocio?');
    expect(result.flags).toEqual([]);
    expect(result.lessonsCompleted).toEqual([]);
    expect(result.escalations).toEqual([]);
    expect(result.financials).toEqual([]);
  });

  it('extracts a single RED flag', () => {
    const input = 'Todo bien. [FLAG:RED|Crisis financiera grave]';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('Todo bien.');
    expect(result.flags).toEqual([{ level: 'RED', reason: 'Crisis financiera grave' }]);
  });

  it('extracts a single YELLOW flag', () => {
    const input = 'Sigamos. [FLAG:YELLOW|Confusión sobre precios]';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('Sigamos.');
    expect(result.flags).toEqual([{ level: 'YELLOW', reason: 'Confusión sobre precios' }]);
  });

  it('extracts multiple flags', () => {
    const input = 'Texto [FLAG:RED|motivo1] más [FLAG:YELLOW|motivo2]';
    const result = parseMarkers(input);
    expect(result.flags).toHaveLength(2);
    expect(result.flags[0]).toEqual({ level: 'RED', reason: 'motivo1' });
    expect(result.flags[1]).toEqual({ level: 'YELLOW', reason: 'motivo2' });
  });

  it('extracts lesson completion', () => {
    const input = '¡Felicidades! [LESSON_COMPLETE:5]';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('¡Felicidades!');
    expect(result.lessonsCompleted).toEqual([5]);
  });

  it('extracts multiple lesson completions', () => {
    const input = 'Bien [LESSON_COMPLETE:3] y [LESSON_COMPLETE:4]';
    const result = parseMarkers(input);
    expect(result.lessonsCompleted).toEqual([3, 4]);
  });

  it('extracts escalation', () => {
    const input = 'Voy a conectarte con alguien. [ESCALATE|Necesita ayuda legal]';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('Voy a conectarte con alguien.');
    expect(result.escalations).toEqual(['Necesita ayuda legal']);
  });

  it('extracts financial data', () => {
    const input = 'Buen reporte. [FINANCIAL:revenue=500000,netProfit=120000]';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('Buen reporte.');
    expect(result.financials).toEqual([{ revenue: 500000, netProfit: 120000 }]);
  });

  it('handles negative financial values', () => {
    const input = 'Entendido. [FINANCIAL:revenue=100000,netProfit=-30000]';
    const result = parseMarkers(input);
    expect(result.financials).toEqual([{ revenue: 100000, netProfit: -30000 }]);
  });

  it('handles decimal financial values', () => {
    const input = 'Ok. [FINANCIAL:revenue=1500.50,netProfit=300.75]';
    const result = parseMarkers(input);
    expect(result.financials).toEqual([{ revenue: 1500.5, netProfit: 300.75 }]);
  });

  it('extracts all marker types at once', () => {
    const input =
      'Gran trabajo hoy. [FLAG:YELLOW|Duda sobre costos] [LESSON_COMPLETE:7] [ESCALATE|Problemas personales] [FINANCIAL:revenue=200000,netProfit=50000]';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('Gran trabajo hoy.');
    expect(result.flags).toHaveLength(1);
    expect(result.lessonsCompleted).toEqual([7]);
    expect(result.escalations).toEqual(['Problemas personales']);
    expect(result.financials).toEqual([{ revenue: 200000, netProfit: 50000 }]);
  });

  it('handles empty string', () => {
    const result = parseMarkers('');
    expect(result.cleanText).toBe('');
    expect(result.flags).toEqual([]);
  });

  it('trims whitespace after removing markers', () => {
    const input = '  Hola  [FLAG:RED|test]  ';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('Hola');
  });

  it('strips a provider drafting sentinel without treating it as progress', () => {
    const result = parseMarkers('A complete learner-facing answer. [END] [DRAFT_DONE]');
    expect(result.cleanText).toBe('A complete learner-facing answer.');
    expect(result.lessonsCompleted).toEqual([]);
    expect(result.milestones).toEqual([]);
  });

  it('preserves bracketed domain terminology', () => {
    expect(parseMarkers('Confirm the [SKU] before ordering.').cleanText).toBe('Confirm the [SKU] before ordering.');
  });

  it('handles markers with no surrounding text', () => {
    const input = '[FLAG:RED|urgente]';
    const result = parseMarkers(input);
    expect(result.cleanText).toBe('');
    expect(result.flags).toEqual([{ level: 'RED', reason: 'urgente' }]);
  });
});
