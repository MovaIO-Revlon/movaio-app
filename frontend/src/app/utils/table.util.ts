import MarkdownIt from 'markdown-it';
import { PSV_REGEX } from './constants';

export interface MarkdownTable {
  title: string;
  headers: string[];
  rows: string[][];
  align?: Array<'left' | 'center' | 'right' | null>;
  width?: string[];
  rowSpan?: string[];
}

export function extractMarkdownTables(markdown: string): MarkdownTable[] {
  const md = new MarkdownIt({ html: true });
  const tokens = md.parse(markdown, {});
  const tables: MarkdownTable[] = [];

  let i = 0;

  while (i < tokens.length) {
    const t = tokens[i];

    if (t.type === 'table_open') {
      const table: MarkdownTable = {
        title: '',
        headers: [],
        rows: [],
        align: [],
      };

      if (i > 0) {
        const prev = tokens[i - 1];
        if (prev.type === 'heading_close' && i > 1) {
          const headingToken = tokens[i - 2];
          if (headingToken.type === 'inline') {
            table.title = headingToken.content.trim();
          }
        }
      }

      i++;

      let inHeader = true;
      let currentRow: string[] = [];

      while (i < tokens.length && tokens[i].type !== 'table_close') {
        const token = tokens[i];

        if (token.type === 'tr_open') {
          currentRow = [];
        }

        if (token.type === 'th_open' || token.type === 'td_open') {
          let cell = '';
          i++;

          while (
            i < tokens.length &&
            tokens[i].type !== 'th_close' &&
            tokens[i].type !== 'td_close'
          ) {
            if (tokens[i].type === 'inline') {
              cell += tokens[i].content;
            }
            i++;
          }

          currentRow.push(cell.trim());

          // alignment handling for th only
          if (token.type === 'th_open' && token.attrs) {
            const alignAttr = token.attrs.find(([key]) => key === 'align');
            if (alignAttr) {
              const value = alignAttr[1];
              table.align?.push(
                value === 'center'
                  ? 'center'
                  : value === 'right'
                    ? 'right'
                    : 'left',
              );
            } else {
              table.align?.push(null);
            }
          }
        }

        if (token.type === 'tr_close') {
          if (inHeader) table.headers = currentRow;
          else table.rows.push(currentRow);
        }

        if (token.type === 'thead_close') {
          inHeader = false;
        }

        i++;
      }

      tables.push(table);
    }

    i++;
  }

  return tables;
}

export function tablesToCsvJson(tables: MarkdownTable[]) {
  return tables.map((table) => ({
    title: table.title,
    headers: table.headers,
    rows: table.rows.map((r) => ({ cells: r })),
  }));
}

interface ICsvTable {
  title: string;
  headers: string[];
  rows: {
    cells: string[];
  }[];
}
[];

interface ICsvTable {
  title: string;
  headers: string[];
  rows: {
    cells: string[];
  }[];
}

export function jsonToCsv(tables: ICsvTable[]): string {
  let csvLines: string[] = [];

  tables.forEach((table, index) => {
    // 1. Add a blank line between tables (except the first one)
    if (index > 0) {
      csvLines.push('');
    }

    // 2. Add the Title as a single-cell row
    if (table.title) {
      csvLines.push(escapeCsvCell(table.title));
    }

    // 3. Add Headers
    csvLines.push(table.headers.map((h) => escapeCsvCell(h)).join(','));

    // 4. Add Rows
    table.rows.forEach((row) => {
      const rowString = row.cells.map((cell) => escapeCsvCell(cell)).join(',');
      csvLines.push(rowString);
    });
  });

  // Use \r\n (CRLF) for better compatibility with Excel
  return csvLines.join('\r\n');
}

/**
 * Helper to handle commas, quotes, and newlines per RFC 4180
 */
function escapeCsvCell(cell: string | null | undefined): string {
  let text = cell ?? '';
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function repairTableStructure(md: string): string {
  const text: string[] = [];
  const lines = md.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];

    if (item.length === 0) {
      if (isTableRow(lines[i - 1]) && isTableRow(lines[i + 1])) {
        continue;
      }
    }

    text.push(item);
  }

  return text.join('\n');
}

function isTableRow(line?: string, delimiter = '|') {
  const trimmedLine = line?.trim() || '';
  return trimmedLine.startsWith(delimiter) && trimmedLine.endsWith(delimiter);
}
interface ITestCase {
  name: string;
  description: string;
  steps: {
    stepNumber: number;
    stepDescription: string;
    action?: string | null;
    locator?: string | null;
    data?: string | null;
  }[];
  testData?: Record<string, string>;
}

export function parseSerializedBddJson(content: string) {
  let lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('step$'));
  const cases: ITestCase[] = [];
  let currentCase: ITestCase | null = null;

  if (lines.length === 1) {
    const [nameDescription, step, ...rest] = lines[0].split('~step$');
    lines = [[nameDescription, step].join('~step$')];
    lines.push(...rest.map((item) => `~step$${item}`));
  }

  const testData = getTestData(content) || undefined;

  for (const line of lines) {
    const [header, stepPart] = line.split('step$');
    const [name, description] = header.split('~');
    const [num, desc, action, locator, data] = stepPart.split('~');

    if (parseInt(num) === 1) {
      currentCase = {
        name: name || 'New Scenario',
        description: description || '',
        steps: [],
        testData,
      };
      cases.push(currentCase);
    }

    if (currentCase) {
      currentCase.steps.push({
        stepNumber: +num,
        stepDescription: desc,
        action: action || 'NULL',
        locator: locator || 'NULL',
        data: data || 'NULL',
      });
    }
  }

  return cases.length ? cases : undefined;
}

export function transformBddJsonToMarkdownTables(
  testCases: ITestCase[],
): MarkdownTable[] {
  return testCases.map((testCase) => {
    const headers = ['#', 'Step Description', 'Action', 'Locator', 'Data'];
    let rowSpan: MarkdownTable['rowSpan'] = undefined;
    const align: MarkdownTable['align'] = [
      'center',
      'left',
      'left',
      'left',
      'left',
      'left',
    ];
    const width: MarkdownTable['width'] = [
      '2rem',
      'fit-content',
      '7rem',
      '7rem',
      'fit-content',
      'fit-content',
    ];

    let rows = testCase.steps.map((step) => [
      step.stepNumber.toString(),
      step.stepDescription || '',
      step.action || '',
      step.locator || '',
      step.data || '',
    ]);

    if (testCase?.testData) {
      headers.push('Test Data');
      rowSpan = Array.from({ length: headers.length }, () => '');
      rowSpan[rowSpan.length - 1] = rows.length.toString();
      rows = rows.map((item, index) => {
        return [
          ...item,
          index === 0
            ? Object.keys(testCase.testData || {})
                .map((key) => `${key}: ${testCase.testData?.[key]}` || '')
                .join('\n')
            : '',
        ];
      });
    }

    return {
      title: `${testCase.name}: ${testCase.description}`,
      headers,
      rows,
      align,
      width,
    };
  });
}

export function extractJsonFromMarkdown(content: string): unknown[] | null {
  const md = new MarkdownIt();
  const results: unknown[] = [];

  const tokens = md.parse(content, {});

  for (const t of tokens) {
    if (t.type === 'fence' && t.info?.trim() === 'json') {
      try {
        results.push(JSON.parse(t.content));
      } catch {}
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type === 'paragraph_open') {
      const inline = tokens[i + 1];
      if (inline?.type === 'inline') {
        const text = inline.content.trim();
        if (text.startsWith('{') || text.startsWith('[')) {
          try {
            results.push(JSON.parse(text));
          } catch {}
        }
      }
    }
  }

  return results?.length ? results : null;
}

// custom handler
export function normalizeBddJSON(data: unknown[]): ITestCase[] {
  const testCases: ITestCase[] = [];

  (data as Record<string, any>[]).forEach((item) => {
    if (item) {
      if (['userStory', 'scenarios'].every((key) => !!item[key])) {
        (item['scenarios'] as Record<string, any>[]).forEach((item) => {
          testCases.push({
            name: item?.['scenarioName'] || '',
            description: item?.['description'] || '',
            steps: (item?.['steps'] as Record<string, any>[]).map((step) => ({
              stepNumber: step['step']?.split('$')?.[1] || 0,
              stepDescription: step['actionDesc'],
              action: step['keyword'],
              locator: step['target'],
              data: step['value'],
            })),
          });
        });
      }
    }
  });

  return testCases;
}

function extractTestDataSection(text: string) {
  const startMarker = '## Test Data';
  const startIndex = text.indexOf(startMarker);

  if (startIndex === -1) return null;

  const remainingText = text.slice(startIndex + startMarker.length);

  const nextHeaderMatch = remainingText.match(/\n##\s+/);

  let endIndex;

  if (nextHeaderMatch) {
    endIndex = startIndex + startMarker.length + nextHeaderMatch.index!;
  } else {
    endIndex = text.length;
  }

  return text.slice(startIndex, endIndex).trim();
}

function parseTestData(section: string) {
  const lines = section.split('\n');

  const data: Record<string, string> = {};

  for (const line of lines) {
    if (!line.includes('|')) continue;
    if (/field/i.test(line)) continue;

    const [key, value] = line.split('|').map((s) => s.trim());

    if (key && value) {
      data[key] = value;
    }
  }

  return data;
}

function getTestData(t: string) {
  const section = extractTestDataSection(t);

  if (section) {
    const testData = parseTestData(section);
    return testData;
  }

  return null;
}

export function extractPsvTables(markdown: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];

  const psvRegex = PSV_REGEX;

  let match: RegExpExecArray | null;

  while ((match = psvRegex.exec(markdown))) {
    const type = match[1].trim();
    const content = match[2].trim();

    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    let title = type;

    const titleLine = lines.find((line) => line.startsWith('#'));

    if (titleLine) {
      title = titleLine.replace(/^#+\s*/, '').trim();
    }

    const dataLines = lines.filter((line) => !line.startsWith('#'));

    if (dataLines.length < 2) continue;

    const headers = dataLines[0].split('|').map((v) => v.trim());

    const rows = dataLines
      .slice(1)
      .map((line) => line.split('|').map((v) => v.trim()));

    tables.push({
      title,
      headers,
      rows,
    });
  }

  return tables;
}
