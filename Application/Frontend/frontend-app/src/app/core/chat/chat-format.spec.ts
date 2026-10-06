import { parseMessage } from './chat-format';

describe('parseMessage', () => {
  it('splits paragraphs and ignores blank lines', () => {
    const blocks = parseMessage('First line.\n\nSecond line.');

    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(blocks[0].segments[0].text).toBe('First line.');
  });

  it('reads # headings of any depth, without the hash marks', () => {
    const blocks = parseMessage('### The Current Outlook\n## Context ##\n# Top');

    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'heading', 'heading']);
    expect(blocks.map((b) => b.segments[0].text)).toEqual(['The Current Outlook', 'Context', 'Top']);
  });

  it('does not mistake a hash inside a line, or without a space, for a heading', () => {
    const blocks = parseMessage('Stock #1 pick\n#hashtag');

    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect(blocks[1].segments[0].text).toBe('#hashtag');
  });

  it('reads "* " and "- " lines as bullets', () => {
    const blocks = parseMessage('* one\n- two\n*not a bullet');

    expect(blocks.map((b) => b.kind)).toEqual(['bullet', 'bullet', 'paragraph']);
    expect(blocks[0].segments[0].text).toBe('one');
    expect(blocks[1].segments[0].text).toBe('two');
  });

  it('marks **bold** and *italic* runs and keeps the text around them', () => {
    const [block] = parseMessage('Your **TCS** holding is *large* today.');

    expect(block.segments).toEqual([
      { text: 'Your ', bold: false, italic: false },
      { text: 'TCS', bold: true, italic: false },
      { text: ' holding is ', bold: false, italic: false },
      { text: 'large', bold: false, italic: true },
      { text: ' today.', bold: false, italic: false }
    ]);
  });

  it('handles bold inside a bullet, as the assistant writes it', () => {
    const [block] = parseMessage('*   **Sell 20 shares of TCS:** This reduces concentration.');

    expect(block.kind).toBe('bullet');
    expect(block.segments[0]).toEqual({ text: 'Sell 20 shares of TCS:', bold: true, italic: false });
    expect(block.segments[1].text).toBe(' This reduces concentration.');
  });

  it('reads a whole italic line, such as a disclaimer', () => {
    const [block] = parseMessage('*(Note: I cannot place orders for you.)*');

    expect(block.segments).toEqual([{ text: '(Note: I cannot place orders for you.)', bold: false, italic: true }]);
  });

  it('passes HTML through as plain text: it is never interpreted as markup', () => {
    const [block] = parseMessage('<img src=x onerror=alert(1)> and <script>bad()</script>');

    const joined = block.segments.map((s) => s.text).join('');
    expect(joined).toBe('<img src=x onerror=alert(1)> and <script>bad()</script>');
    expect(block.segments.every((s) => !s.bold && !s.italic)).toBe(true);
  });

  it('leaves a lone asterisk alone', () => {
    const [block] = parseMessage('Price is 5 * 3 = 15');

    expect(block.segments.map((s) => s.text).join('')).toBe('Price is 5 * 3 = 15');
  });

  it('returns nothing for empty text', () => {
    expect(parseMessage('')).toEqual([]);
    expect(parseMessage('  \n  ')).toEqual([]);
  });
});
