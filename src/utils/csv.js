export function downloadCSV(filename, rows, columns) {
  if (!rows.length) {
    alert('No data to download yet.');
    return;
  }
  const header = columns.map((c) => c.label).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${(row[c.name] ?? '').toString().replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const csv = `${header}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
