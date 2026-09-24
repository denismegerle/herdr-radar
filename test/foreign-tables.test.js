'use strict';

// A table the user already owns is refused in every form TOML can spell it
// (#22). Only the `[theme.custom]` header on a line of its own used to be
// seen; a dotted key or an inline table on the way down slipped past, the
// block was appended, and the whole config.toml stopped parsing.

const test = require('node:test');
const assert = require('node:assert/strict');

const { claimsTable } = require('../lib/toml-blocks');
const managed = require('../lib/managed-config');
const identity = require('../lib/identity');

const claims = [
  ['a header', '[theme.custom]\nname = "x"'],
  ['an indented header', '  [theme.custom]'],
  ['a header with a comment after it', '[theme.custom] # mine'],
  ['a header with spaces inside the brackets', '[ theme.custom ]'],
  ['a quoted header', '[theme."custom"]'],
  ['a sub-table header', '[theme.custom.accent]\nfg = "x"'],
  ['an array-of-tables header', '[[theme.custom]]'],
  ['a dotted key under the parent', '[theme]\ncustom.name = "x"'],
  ['a dotted key at the top level', 'theme.custom.name = "x"'],
  ['an inline table', '[theme]\ncustom = { name = "x" }'],
  ['an inline table above it', 'theme = { custom = { name = "x" } }'],
  ['a scalar where the table would go', '[theme]\ncustom = 1'],
];

for (const [form, toml] of claims) {
  test(`${form} claims the table`, () => {
    assert.equal(claimsTable(toml, 'theme.custom'), true);
  });
}

const free = [
  ['the parent table alone', '[theme]\nname = "x"'],
  ['a sibling key', '[theme]\ncustom_name = "x"'],
  ['a sibling table', '[theme.customs]'],
  ['the same key under another table', '[ui]\ncustom.name = "x"'],
  ['a commented-out header', '# [theme.custom]'],
  ['the name inside a value', '[theme]\nname = "[theme.custom]"'],
];

for (const [form, toml] of free) {
  test(`${form} does not claim the table`, () => {
    assert.equal(claimsTable(toml, 'theme.custom'), false);
  });
}

// The reporter's own file: `[ui.sidebar.spaces]` written by hand.
test('a hand-written sidebar table is foreign', () => {
  const toml = '[ui]\nstatus_indicators = "symbols"\n\n[ui.sidebar.spaces]\nrow_gap = 1\n';
  assert.deepEqual(managed.foreignTables(toml), ['ui.sidebar.spaces']);
});

// The plugin's own blocks are never counted against it.
test('the managed blocks are not foreign', () => {
  const theme = identity.markers('theme');
  const sidebar = identity.markers('sidebar');
  const toml = [
    '[ui]',
    '',
    theme.start,
    '[theme.custom]',
    'fg = "x"',
    theme.end,
    '',
    sidebar.start,
    '[ui.sidebar.agents]',
    '[ui.sidebar.agents.rows_by_agent]',
    '[ui.sidebar.spaces]',
    sidebar.end,
    '',
  ].join('\n');
  assert.deepEqual(managed.foreignTables(toml), []);
});
