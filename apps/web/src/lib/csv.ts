/** Build a CSV from rows and hand it to the browser as a download. Cells that start with = + - @ are prefixed
 *  with ' so a spreadsheet does not run them as formulas. */
export function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 10);
