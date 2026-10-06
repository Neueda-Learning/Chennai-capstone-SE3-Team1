import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Instrument } from '../../core/services/instrument-catalog.service';
import { SymbolPicker, placeList } from './symbol-picker';

const OPTIONS: Instrument[] = [
  { symbol: 'HDFCBANK', name: 'HDFC Bank', price: 1700, changePercent: -0.2 },
  { symbol: 'INFY', name: 'Infosys', price: 1620, changePercent: 0.75 },
  { symbol: 'RELIANCE', name: 'Reliance Industries', price: 2400, changePercent: 0.2 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', price: 3050, changePercent: -0.8 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', price: null, changePercent: null }
];

@Component({
  imports: [SymbolPicker],
  template: `
    <tui-symbol-picker
      [options]="options()"
      [selected]="selected()"
      [unavailable]="unavailable()"
      [multiple]="multiple()"
      [loading]="loading()"
      [disabled]="disabled()"
      (selectedChange)="onChange($event)"
    />
    <button id="outside">outside</button>
  `
})
class Host {
  readonly options = signal<Instrument[]>(OPTIONS);
  readonly selected = signal<string[]>([]);
  readonly unavailable = signal<string[]>([]);
  readonly multiple = signal(false);
  readonly loading = signal(false);
  readonly disabled = signal(false);
  readonly emitted: string[][] = [];

  onChange(next: string[]): void {
    this.emitted.push(next);
    this.selected.set(next);
  }
}

describe('SymbolPicker', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(selector: string): T | null => root().querySelector<T>(selector);
  const input = (): HTMLInputElement => q<HTMLInputElement>('[data-testid="picker-input"]') as HTMLInputElement;
  const list = (): HTMLElement | null => q('[data-testid="picker-list"]');
  const optionSymbols = (): string[] =>
    Array.from(root().querySelectorAll('[role="option"] .picker-symbol')).map((e) => (e.textContent ?? '').trim());

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function type(text: string): Promise<void> {
    input().value = text;
    input().dispatchEvent(new Event('input'));
    await settle();
  }

  async function key(name: string): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    input().dispatchEvent(event);
    await settle();
    return event;
  }

  async function open(): Promise<void> {
    input().dispatchEvent(new Event('focus'));
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await settle();
  });

  describe('opening and filtering', () => {
    it('is closed until it is focused or clicked, then lists every instrument', async () => {
      expect(list()).toBeNull();

      await open();

      expect(list()).not.toBeNull();
      expect(optionSymbols()).toEqual(['HDFCBANK', 'INFY', 'RELIANCE', 'TCS', 'TATAMOTORS']);
    });

    it('narrows the list as you type, tolerating typos and skipped letters', async () => {
      await open();

      await type('infsys');
      expect(optionSymbols()).toContain('INFY');
      expect(optionSymbols()).not.toContain('TCS');

      await type('rlnc');
      expect(optionSymbols()).toEqual(['RELIANCE']);

      await type('tata');
      expect(optionSymbols()).toEqual(expect.arrayContaining(['TCS', 'TATAMOTORS']));
    });

    it('says so when nothing matches, quoting what was typed', async () => {
      await open();
      await type('qqqq');

      expect(q('[data-testid="picker-none"]')?.textContent).toContain('qqqq');
    });

    it('says so when there are no instruments at all, and when they are still loading', async () => {
      host.options.set([]);
      await open();
      expect(q('[data-testid="picker-none"]')?.textContent).toContain('No instruments are available');

      host.loading.set(true);
      await settle();
      expect(q('[data-testid="picker-loading"]')).not.toBeNull();
    });

    it('closes on Escape, on Tab and on a click elsewhere', async () => {
      await open();
      const escape = await key('Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(list()).toBeNull();

      await open();
      await key('Tab');
      expect(list()).toBeNull();

      await open();
      (q('#outside') as HTMLElement).dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await settle();
      expect(list()).toBeNull();
    });

    it('does not open when disabled', async () => {
      host.disabled.set(true);
      await settle();

      await open();

      expect(list()).toBeNull();
    });
  });

  describe('where the list opens (a card around the box must never cut it off)', () => {
    const viewport = { width: 1440, height: 900 };

    it('opens below the box, as wide as the box, when there is room', () => {
      const place = placeList({ left: 100, right: 500, top: 200, bottom: 244 }, viewport);

      expect(place.top).toBe(248);
      expect(place.bottom).toBeNull();
      expect(place.left).toBe(100);
      expect(place.width).toBe(400);
      expect(place.maxHeight).toBe(272);
    });

    it('opens upwards when the box is near the bottom of the screen and there is more room above', () => {
      const place = placeList({ left: 100, right: 500, top: 800, bottom: 844 }, viewport);

      expect(place.top).toBeNull();
      expect(place.bottom).toBe(900 - 800 + 4);
      expect(place.maxHeight).toBe(272);
    });

    it('stays below, shrunk to fit, when there is little room either way', () => {
      const place = placeList({ left: 0, right: 300, top: 60, bottom: 104 }, { width: 800, height: 250 });

      expect(place.top).toBe(108);
      expect(place.maxHeight).toBe(134); // 250 - 104 - 8 - 4, but never under 96
    });

    it('never makes the list shorter than a few rows', () => {
      expect(placeList({ left: 0, right: 300, top: 20, bottom: 64 }, { width: 800, height: 100 }).maxHeight).toBe(96);
    });

    it('is wider than a narrow box, so company names stay readable', () => {
      const place = placeList({ left: 100, right: 300, top: 200, bottom: 244 }, viewport);

      expect(place.left).toBe(100);
      expect(place.width).toBe(320);
    });

    it('slides left, rather than running off the screen, when a wider list would not fit beside the box', () => {
      const place = placeList({ left: 1300, right: 1400, top: 200, bottom: 244 }, viewport);

      expect(place.width).toBe(320);
      expect(place.left).toBe(1440 - 8 - 320);
    });

    it('keeps the list inside the screen sideways', () => {
      const place = placeList({ left: -40, right: 1600, top: 100, bottom: 144 }, viewport);

      expect(place.left).toBe(8);
      expect(place.left + place.width).toBeLessThanOrEqual(1440 - 8);
    });

    it('is placed in fixed viewport coordinates when opened, and follows the box when the page scrolls', async () => {
      const rect = { left: 50, right: 450, top: 100, bottom: 144, width: 400, height: 44, x: 50, y: 100, toJSON: () => ({}) };
      const box = root().querySelector('.picker-field') as HTMLElement;
      vi.spyOn(box, 'getBoundingClientRect').mockImplementation(() => rect as DOMRect);

      await open();
      const listEl = () => list() as HTMLElement;
      expect(listEl().style.top).toBe('148px');
      expect(listEl().style.left).toBe('50px');
      expect(listEl().style.width).toBe('400px');

      rect.top = 40;
      rect.bottom = 84;
      window.dispatchEvent(new Event('scroll'));
      await settle();
      expect(listEl().style.top).toBe('88px');
    });
  });

  describe('layout', () => {
    it('keeps a single selection on one line, and lets a multiple selection wrap its chips', async () => {
      const field = () => q('.picker-field') as HTMLElement;
      expect(field().classList.contains('picker-nowrap')).toBe(true);

      host.multiple.set(true);
      await settle();
      expect(field().classList.contains('picker-nowrap')).toBe(false);
    });
  });

  describe('keyboard', () => {
    it('opens with the down arrow, then moves through the list, wrapping at both ends', async () => {
      await key('ArrowDown');
      expect(list()).not.toBeNull();

      const active = () => q('.picker-active .picker-symbol')?.textContent?.trim();
      expect(active()).toBe('HDFCBANK');
      await key('ArrowDown');
      expect(active()).toBe('INFY');
      await key('ArrowUp');
      await key('ArrowUp');
      expect(active()).toBe('TATAMOTORS'); // wrapped to the end
      await key('Home');
      expect(active()).toBe('HDFCBANK');
      await key('End');
      expect(active()).toBe('TATAMOTORS');
    });

    it('chooses the highlighted instrument with Enter', async () => {
      await open();
      await key('ArrowDown');
      await key('Enter');

      expect(host.emitted).toEqual([['INFY']]);
    });

    it('tells a screen reader which row is highlighted', async () => {
      await open();
      await key('ArrowDown');

      expect(input().getAttribute('role')).toBe('combobox');
      expect(input().getAttribute('aria-expanded')).toBe('true');
      expect(input().getAttribute('aria-activedescendant')).toBe(q('.picker-active')?.id);
      expect(list()?.getAttribute('role')).toBe('listbox');
    });

    it('keeps the highlight on a real row when typing shortens the list', async () => {
      await open();
      await key('End');
      await type('rel');

      await key('Enter');

      expect(host.emitted).toEqual([['RELIANCE']]);
    });
  });

  describe('single selection (price alerts)', () => {
    it('picks one instrument, closes, and shows it', async () => {
      await open();
      (q('[data-testid="picker-option-TCS"]') as HTMLElement).click();
      await settle();

      expect(host.emitted).toEqual([['TCS']]);
      expect(list()).toBeNull();
      expect(q('[data-testid="picker-single"]')?.textContent).toContain('TCS');
      expect(q('[data-testid="picker-single"]')?.textContent).toContain('Tata Consultancy Services');
    });

    it('replaces the choice when another is picked, and can be cleared', async () => {
      host.selected.set(['TCS']);
      await settle();
      await open();
      (q('[data-testid="picker-option-INFY"]') as HTMLElement).click();
      await settle();
      expect(host.selected()).toEqual(['INFY']);

      (q('[data-testid="picker-clear"]') as HTMLElement).click();
      await settle();
      expect(host.selected()).toEqual([]);
      expect(q('[data-testid="picker-single"]')).toBeNull();
    });
  });

  describe('multiple selection (watchlists)', () => {
    beforeEach(async () => {
      host.multiple.set(true);
      await settle();
    });

    it('stays open and collects several, shown as chips', async () => {
      await open();
      (q('[data-testid="picker-option-TCS"]') as HTMLElement).click();
      await settle();
      (q('[data-testid="picker-option-INFY"]') as HTMLElement).click();
      await settle();

      expect(host.selected()).toEqual(['TCS', 'INFY']);
      expect(list()).not.toBeNull();
      expect(Array.from(root().querySelectorAll('[data-testid="picker-chip"]')).map((c) => c.textContent?.trim())).toEqual(['TCS', 'INFY']);
      expect(q('[data-testid="picker-option-TCS"]')?.getAttribute('aria-selected')).toBe('true');
      expect(list()?.getAttribute('aria-multiselectable')).toBe('true');
    });

    it('un-picks an instrument that is picked again', async () => {
      host.selected.set(['TCS', 'INFY']);
      await settle();
      await open();

      (q('[data-testid="picker-option-TCS"]') as HTMLElement).click();
      await settle();

      expect(host.selected()).toEqual(['INFY']);
    });

    it('removes a chip with its x, and the last chip with Backspace on an empty box', async () => {
      host.selected.set(['TCS', 'INFY', 'RELIANCE']);
      await settle();

      (root().querySelectorAll('[data-testid="picker-chip-remove"]')[0] as HTMLElement).click();
      await settle();
      expect(host.selected()).toEqual(['INFY', 'RELIANCE']);

      await key('Backspace');
      expect(host.selected()).toEqual(['INFY']);
    });

    it('does not take a chip off with Backspace while there is text to delete', async () => {
      host.selected.set(['TCS']);
      await settle();
      await type('in');

      await key('Backspace');

      expect(host.selected()).toEqual(['TCS']);
    });

    it('shows instruments already in the list as unavailable, and will not pick them', async () => {
      host.unavailable.set(['INFY']);
      await settle();
      await open();

      const row = q('[data-testid="picker-option-INFY"]') as HTMLElement;
      expect(row.getAttribute('aria-disabled')).toBe('true');
      expect(row.textContent).toContain('Already added');
      row.click();
      await settle();

      expect(host.emitted).toEqual([]);
    });
  });
});
