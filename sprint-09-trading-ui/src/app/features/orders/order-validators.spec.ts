import { FormControl } from '@angular/forms';

import {
  atMostTwoDecimals,
  priceAboveZero,
  tradableSymbol,
  wholeQuantity
} from './order-validators';

function control(value: string): FormControl {
  return new FormControl(value);
}

describe('wholeQuantity', () => {
  it('accepts whole units above zero', () => {
    expect(wholeQuantity(control('1'))).toBeNull();
    expect(wholeQuantity(control('10'))).toBeNull();
    expect(wholeQuantity(control('250'))).toBeNull();
  });

  it('rejects a fraction', () => {
    expect(wholeQuantity(control('1.5'))).toEqual({ wholeQuantity: true });
    expect(wholeQuantity(control('0.001'))).toEqual({ wholeQuantity: true });
  });

  it('rejects zero and anything below it', () => {
    expect(wholeQuantity(control('0'))).toEqual({ min: { min: 1, actual: 0 } });
    expect(wholeQuantity(control('-3'))).toEqual({ wholeQuantity: true });
  });

  it('rejects anything that is not a number', () => {
    expect(wholeQuantity(control(''))).toEqual({ required: true });
    expect(wholeQuantity(control('ten'))).toEqual({ wholeQuantity: true });
    expect(wholeQuantity(control('1e3'))).toEqual({ wholeQuantity: true });
  });
});

describe('priceAboveZero', () => {
  it('accepts a price above zero', () => {
    expect(priceAboveZero(control('1450'))).toBeNull();
    expect(priceAboveZero(control('1450.25'))).toBeNull();
    expect(priceAboveZero(control('0.01'))).toBeNull();
  });

  it('rejects zero', () => {
    expect(priceAboveZero(control('0'))).toEqual({ min: { min: 0, actual: 0 } });
    expect(priceAboveZero(control('0.00'))).toEqual({ min: { min: 0, actual: 0 } });
  });

  it('rejects an empty or non-numeric price', () => {
    expect(priceAboveZero(control(''))).toEqual({ required: true });
    expect(priceAboveZero(control('market'))).toEqual({ priceFormat: true });
  });
});

describe('atMostTwoDecimals', () => {
  it('accepts up to two decimal places', () => {
    expect(atMostTwoDecimals(control('1450'))).toBeNull();
    expect(atMostTwoDecimals(control('1450.2'))).toBeNull();
    expect(atMostTwoDecimals(control('1450.25'))).toBeNull();
  });

  it('rejects a third decimal place', () => {
    expect(atMostTwoDecimals(control('1450.251'))).toEqual({ decimals: { max: 2, actual: 3 } });
  });
});

describe('tradableSymbol', () => {
  it('accepts the schemes the contract describes', () => {
    expect(tradableSymbol(control('RELIANCE'))).toBeNull();
    expect(tradableSymbol(control('TCS.NS'))).toBeNull();
    expect(tradableSymbol(control('TCS.BO'))).toBeNull();
    expect(tradableSymbol(control('FX:USDINR'))).toBeNull();
    expect(tradableSymbol(control('X:BTC'))).toBeNull();
  });

  it('rejects an empty symbol', () => {
    expect(tradableSymbol(control(''))).toEqual({ required: true });
  });

  it('trims surrounding whitespace rather than rejecting it', () => {
    expect(tradableSymbol(control('  RELIANCE  '))).toBeNull();
  });

  it('rejects a symbol with a space or separator the scheme does not use', () => {
    expect(tradableSymbol(control('RELIANCE TCS'))).toEqual({ symbolFormat: true });
    expect(tradableSymbol(control('RELIANCE.NS.BO'))).toEqual({ symbolFormat: true });
    expect(tradableSymbol(control('RELIANCE; DROP'))).toEqual({ symbolFormat: true });
  });
});
