/**
 * Turns the assistant's reply into blocks the template can render without ever using innerHTML, so
 * nothing the model (or a tool result it repeated) writes can inject markup. It understands only what
 * the assistant actually produces: paragraphs, "#" headings, "* " or "- " bullets, **bold** and *italic*.
 */
export interface Segment {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface Block {
  kind: 'paragraph' | 'bullet' | 'heading';
  segments: Segment[];
}

const BULLET = /^\s*[*-]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*/g;

export function parseMessage(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      blocks.push({ kind: 'heading', segments: inline(heading[1]) });
      continue;
    }
    const bullet = BULLET.exec(raw);
    blocks.push({
      kind: bullet === null ? 'paragraph' : 'bullet',
      segments: inline(bullet === null ? line : bullet[1].trim())
    });
  }
  return blocks;
}

function inline(line: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of line.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) {
      segments.push({ text: line.slice(last, start), bold: false, italic: false });
    }
    if (match[1] !== undefined) {
      segments.push({ text: match[1], bold: true, italic: false });
    } else {
      segments.push({ text: match[2], bold: false, italic: true });
    }
    last = start + match[0].length;
  }
  if (last < line.length) {
    segments.push({ text: line.slice(last), bold: false, italic: false });
  }
  return segments.length === 0 ? [{ text: line, bold: false, italic: false }] : segments;
}
