import { editDistance, normalise, scoreText, search } from './fuzzy';

const INSTRUMENTS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries' },
  { symbol: 'TCS', name: 'Tata Consultancy Services' },
  { symbol: 'INFY', name: 'Infosys' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank' },
  { symbol: 'ITC', name: 'ITC' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors' },
  { symbol: 'AXISBANK', name: 'Axis Bank' },
  { symbol: 'SBIN', name: 'State Bank of India' }
];

const symbols = (query: string, limit?: number) => search(query, INSTRUMENTS, limit).map((i) => i.symbol);

describe('normalise', () => {
  it('lower-cases, strips accents and punctuation, and trims', () => {
    expect(normalise('  Réliance  Ind.-Ltd ')).toBe('reliance ind ltd');
  });
});

describe('editDistance', () => {
  it('counts single edits', () => {
    expect(editDistance('infy', 'infy')).toBe(0);
    expect(editDistance('infy', 'infi')).toBe(1);
    expect(editDistance('infy', 'inffy')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('scoreText', () => {
  it('ranks exact above prefix above word-prefix above substring', () => {
    const exact = scoreText('tcs', 'tcs');
    const prefix = scoreText('tc', 'tcs');
    const wordPrefix = scoreText('serv', 'tata consultancy services');
    const inside = scoreText('sul', 'tata consultancy services');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(0);
  });

  it('scores nothing for an empty or unrelated query', () => {
    expect(scoreText('', 'tcs')).toBe(0);
    expect(scoreText('zzz', 'tcs')).toBe(0);
  });

  it('does not match on a subsequence shorter than three letters', () => {
    expect(scoreText('rc', 'reliance')).toBe(0);
  });
});

describe('search', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(symbols('')).toEqual(INSTRUMENTS.map((i) => i.symbol));
    expect(symbols('   ')).toEqual(INSTRUMENTS.map((i) => i.symbol));
  });

  it('finds by symbol prefix, case-insensitively', () => {
    expect(symbols('tc')[0]).toBe('TCS');
    expect(symbols('REL')[0]).toBe('RELIANCE');
  });

  it('finds by company name, including a word in the middle', () => {
    expect(symbols('consultancy')).toEqual(['TCS']);
    expect(symbols('unilever')).toEqual(['HINDUNILVR']);
    expect(symbols('bank')).toEqual(expect.arrayContaining(['HDFCBANK', 'ICICIBANK', 'AXISBANK', 'SBIN']));
  });

  it('puts an exact symbol first even when other names contain it', () => {
    expect(symbols('itc')[0]).toBe('ITC');
  });

  it('tolerates typos', () => {
    expect(symbols('infsys')).toContain('INFY');
    expect(symbols('reliace')).toContain('RELIANCE');
    expect(symbols('hdfcbnk')).toContain('HDFCBANK');
  });

  it('tolerates skipped letters', () => {
    expect(symbols('rlnc')).toContain('RELIANCE');
    expect(symbols('tmotors')).toContain('TATAMOTORS');
  });

  it('matches across the symbol and the name', () => {
    expect(symbols('tata')).toEqual(expect.arrayContaining(['TCS', 'TATAMOTORS']));
    expect(symbols('tata mot')[0]).toBe('TATAMOTORS');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(symbols('qqqqq')).toEqual([]);
  });

  it('keeps the original order for equal scores, so a refresh does not reshuffle the list', () => {
    const first = symbols('bank');
    expect(symbols('bank')).toEqual(first);
    expect(first.indexOf('HDFCBANK')).toBeLessThan(first.indexOf('ICICIBANK'));
  });

  it('honours the limit', () => {
    expect(symbols('', 3)).toHaveLength(3);
    expect(symbols('bank', 2)).toHaveLength(2);
  });
});
