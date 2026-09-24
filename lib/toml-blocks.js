'use strict';

// Text-level edits to a TOML file we do not parse: values inside one named
// table, and delimited blocks appended at the tail. Herdr's config.toml is
// the user's file; the plugin only ever touches the lines it put there, and
// a full parse-and-serialise round trip would reorder and re-comment
// everything else.

const fs = require('node:fs');

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Slice `[table]` and its bare keys out of the file: from the header to the
// next header or the end. Other tables may carry the same key names.
function tableSpan(text, table) {
  const start = text.search(new RegExp(`^\\[${escapeRegExp(table)}\\]\\s*$`, 'm'));
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const nextHeader = rest.search(/^\[/m);
  return {
    head: text.slice(0, start),
    body: nextHeader === -1 ? text.slice(start) : text.slice(start, start + 1 + nextHeader),
    tail: nextHeader === -1 ? '' : text.slice(start + 1 + nextHeader),
  };
}

// The double-quoted value of a bare key in `[table]`, or null.
function tableValue(text, table, key) {
  const span = tableSpan(text, table);
  if (!span) return null;
  return span.body.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, 'm'))?.[1] ?? null;
}

// The raw right-hand side of a bare key in `[table]` — quotes, booleans and
// all, minus a trailing comment — or null when the line is absent. This is
// what editTable takes back verbatim, so a value read here can be restored.
function tableRaw(text, table, key) {
  const span = tableSpan(text, table);
  if (!span) return null;
  const match = span.body.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*(.*)$`, 'm'));
  if (!match) return null;
  return match[1].replace(/\s+#.*$/, '').trim();
}

// Rewrite bare keys in `[table]`; returns null when the table is absent.
// Values are inserted verbatim, so quote strings at the call site. A null
// value deletes the line.
function editTable(text, table, edits) {
  const span = tableSpan(text, table);
  if (!span) return null;
  let edited = span.body;
  for (const [key, value] of Object.entries(edits)) {
    // Only uncommented assignments at the start of a line; Herdr's file ships
    // with a commented template of every key.
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, 'm');
    if (value === null) {
      edited = edited.replace(new RegExp(`^${escapeRegExp(key)}\\s*=.*\\n?`, 'm'), '');
      continue;
    }
    const line = `${key} = ${value}`;
    edited = pattern.test(edited) ? edited.replace(pattern, line) : `${edited.replace(/\n*$/, '')}\n${line}\n`;
  }
  return span.head + edited + span.tail;
}

// Rewrite bare keys at the top level — everything before the first table
// header. New keys are appended to that region so they never land inside a
// table by accident. Values are inserted verbatim.
function editTopLevel(text, edits) {
  const firstHeader = text.search(/^\[/m);
  let head = firstHeader === -1 ? text : text.slice(0, firstHeader);
  const tail = firstHeader === -1 ? '' : text.slice(firstHeader);
  for (const [key, value] of Object.entries(edits)) {
    const line = `${key} = ${value}`;
    const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, 'm');
    head = pattern.test(head) ? head.replace(pattern, line) : `${head.replace(/\n*$/, '')}\n${line}\n`;
  }
  // Keep one blank line between the top-level keys and the first table.
  if (tail && !head.endsWith('\n\n')) head = `${head.replace(/\n*$/, '')}\n\n`;
  return head.replace(/^\n+/, '') + tail;
}

// Replace the block between the `start` and `end` marker lines, or append it.
function upsertTail(text, start, end, body) {
  const pattern = new RegExp(`\\n*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (pattern.test(text)) return text.replace(pattern, `\n\n${body}`);
  return `${text.replace(/\n+$/, '')}\n\n${body}\n`;
}

function dropBlock(text, start, end) {
  return text
    .replace(new RegExp(`\\n*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`), '\n\n')
    .replace(/\n{3,}/g, '\n\n');
}

// A dotted TOML key as a plain path: whitespace and quotes dropped, so
// `ui . "sidebar" . spaces` and `ui.sidebar.spaces` read the same.
function keyPath(raw) {
  return raw
    .split('.')
    .map((part) => part.trim().replace(/^"(.*)"$|^'(.*)'$/, '$1$2'))
    .join('.');
}

// Whether a file already lays claim to `table`, in any of the ways TOML
// lets it — not just a `[table]` header on a line of its own:
//
//   [theme.custom]            a header, indented or with a comment after it
//   [theme.custom.accent]     a sub-table: its parent is the user's too
//   [theme]  custom.name = 1  a dotted key under a parent header
//   [ui]     sidebar = { … }  an inline table on the way down
//   theme.custom.name = 1     a dotted key at the top level
//
// Every one of these makes a later `[table]` header a parse error, and a
// config.toml that fails to parse takes every plugin down with it. Only the
// header form was checked before, and the block was written on top of the
// rest (#22). Values are never read, except to step over a multi-line
// string: a key binding's command may hold a whole TOML snippet, and a
// header-shaped line inside it is text, not a table.
function claimsTable(text, table) {
  const under = `${table}.`;
  let current = '';
  let quote = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (quote) {
      if (line.includes(quote)) quote = null;
      continue;
    }
    const opened = line.match(/=\s*("""|''')/);
    if (opened && line.indexOf(opened[1], opened.index + opened[0].length) === -1) quote = opened[1];
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/);
    if (header) {
      current = keyPath(header[1]);
      if (current === table || current.startsWith(under)) return true;
      continue;
    }
    const key = line.match(
      /^((?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*'))*)\s*=\s*(\{?)/,
    );
    if (!key) continue;
    const full = current ? `${current}.${keyPath(key[1])}` : keyPath(key[1]);
    if (full === table || full.startsWith(under)) return true;
    // An inline table is closed the moment its line ends: nothing can be
    // added to it or beneath it by a header later on.
    if (key[2] && table.startsWith(`${full}.`)) return true;
  }
  return false;
}

// Herdr watches its config directory and reloads on change; a partial write
// would be read as a broken file. Write beside it and rename into place.
function writeAtomic(file, text, suffix = '.tmp') {
  const tmp = `${file}${suffix}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = {
  escapeRegExp,
  tableValue,
  tableRaw,
  editTable,
  editTopLevel,
  upsertTail,
  dropBlock,
  claimsTable,
  writeAtomic,
};
