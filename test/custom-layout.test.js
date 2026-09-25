'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-radar-layout-'));
process.env.XDG_CONFIG_HOME = path.join(dir, 'xdg');
process.env.XDG_STATE_HOME = path.join(dir, 'state');
process.env.HERDR_CONFIG_PATH = path.join(dir, 'checkout', 'herdr', 'config.toml');
const paths = require('../lib/paths');
const managed = require('../lib/managed-config');
const state = require('../lib/state');
const herdr = require('../lib/herdr');

test('repo config override does not move the machine-local plugin config', () => {
  assert.equal(paths.herdrConfigPath(), process.env.HERDR_CONFIG_PATH);
  assert.equal(
    paths.pluginConfigDir('hhdebb.herdr-radar'),
    path.join(process.env.XDG_CONFIG_HOME, 'herdr', 'plugins', 'config', 'hhdebb.herdr-radar'),
  );
});

test('stable task row survives generated fallback, vendor, repair, and appearance changes', () => {
  const remote = path.join(process.env.XDG_STATE_HOME, 'herdr', 'agent-detection', 'remote');
  fs.mkdirSync(remote, { recursive: true });
  fs.writeFileSync(path.join(remote, 'claude.toml'), '');
  const file = paths.herdrConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '[theme]\nname = "terminal"\nauto_switch = false\n\n[ui]\nstatus_indicators = "symbols"\n');
  const taskToken = 'token = "$task"';
  for (const variant of ['light', 'dark']) {
    const block = managed.sidebarBlock(variant);
    assert.ok(block.includes(`[ui.sidebar.agents.rows_by_agent]`));
    assert.ok(block.includes('claude = ['), 'claude must have a vendor-specific row');
    for (const pattern of [/^rows = (.+)$/m, /^claude = (.+)$/m]) {
      const literal = pattern.exec(block)?.[1];
      assert.ok(literal, 'missing agent row definition');
      const rows = managed.topLevelRows(literal.slice(1, -1));
      assert.equal(rows.length, 2, 'selection must have only activity and task rows');
      assert.match(rows[0], /token = "\$group"/, 'workspace label stays inline');
      assert.match(rows[1], /token = "\$task"/, 'stable task is the second row');
      assert.ok(!literal.includes('$gap'), 'spacer must not be selectable');
    }
  }
  assert.equal(managed.apply().changed, true);
  assert.ok(fs.readFileSync(file, 'utf8').includes(taskToken));
  assert.equal(managed.apply().changed, false, 'a current managed block is left alone');
  // A checkout shared across machines can have stale generated commands.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('interval_seconds = 6', 'interval_seconds = 7'));
  assert.equal(managed.apply().changed, true, 'repair a block generated elsewhere');
  assert.ok(fs.readFileSync(file, 'utf8').includes('interval_seconds = 6'));
  assert.equal(managed.applyAppearance('dark').ok, true);
  assert.ok(fs.readFileSync(file, 'utf8').includes(taskToken));
  assert.equal(managed.apply().ok, true);
  assert.ok(fs.readFileSync(file, 'utf8').includes(taskToken));
});

test('group metadata clears legacy spacer tokens on every pane', async () => {
  const original = herdr.reportMetadataAsync;
  const writes = new Map();
  herdr.reportMetadataAsync = async (pane, _source, tokens) => {
    writes.set(pane, tokens);
    return true;
  };
  try {
    const entries = [
      { pane: 'p1', workspace: 'w1' },
      { pane: 'p2', workspace: 'w1' },
    ];
    assert.equal((await state.writeGroups('test', entries, new Map([['w1', 'main_remote']]))).ok, true);
    assert.equal(writes.get('p1').group, 'main_remote');
    assert.equal(writes.get('p2').group, null);
    assert.equal(writes.get('p1').gap, null);
    assert.equal(writes.get('p2').gap, null);
  } finally {
    herdr.reportMetadataAsync = original;
  }
});
