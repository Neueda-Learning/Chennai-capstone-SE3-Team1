import { FormControl } from '@angular/forms';

import { wholeQuantity } from './order-validators';

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
