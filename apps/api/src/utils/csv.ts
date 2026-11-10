// Minimal RFC 4180 CSV reader and a formula-injection-safe writer. Bounded: the caller sets
// a row limit and the parser stops, so a hostile file cannot exhaust memory.

export interface CsvResult {
  headers: string[];
  rows: string[][];
  /** True when the row limit cut the file short. */
  truncated: boolean;
}

const detectDelimiter = (firstLine: string): string => {
  const counts: Array<[string, number]> = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
};

export const parseCsv = (input: string, maxRows = 100_000): CsvResult => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const nl = text.search(/\r|\n/);
  const delim = detectDelimiter(nl === -1 ? text : text.slice(0, nl));
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let truncated = false;
  const endRow = (): boolean => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) records.push(row);
    row = [];
    return records.length > maxRows; // header + maxRows data rows
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (endRow()) {
        truncated = true;
        records.length = maxRows + 1;
        break;
      }
    } else field += ch;
  }
  if (!truncated && (field !== "" || row.length)) endRow();
  const [headers = [], ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows, truncated };
};

/** Prefixes values a spreadsheet would run as a formula, then quotes when needed. */
export const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]): string =>
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
