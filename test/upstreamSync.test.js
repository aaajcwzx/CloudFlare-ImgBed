import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { integrationBranch, mergeIntoReviewBranch } from '../.github/scripts/sync-upstream.mjs';

describe('upstream review branch integration', () => {
    let dir, git;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'imgbed-sync-test-'));
        git = (args, allowFailure = false) => {
            const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
            if (!allowFailure && result.status !== 0) throw new Error(result.stderr);
            return result;
        };
        git(['init', '--initial-branch=main']);
        git(['config', 'user.name', 'Test']);
        git(['config', 'user.email', 'test@example.invalid']);
        git(['config', 'core.autocrlf', 'false']);
        writeFileSync(join(dir, 'shared.txt'), 'base\n');
        git(['add', '.']); git(['commit', '-m', 'base']);
        git(['branch', 'upstream']);
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('merges upstream and custom features in a review branch while leaving main unchanged', () => {
        writeFileSync(join(dir, 'custom.txt'), 'custom feature');
        git(['add', '.']); git(['commit', '-m', 'custom']);
        const base = git(['rev-parse', 'HEAD']).stdout.trim();
        git(['update-ref', 'refs/remotes/origin/main', base]);
        git(['switch', 'upstream']);
        writeFileSync(join(dir, 'upstream.txt'), 'upstream feature');
        git(['add', '.']); git(['commit', '-m', 'upstream']);
        const upstream = git(['rev-parse', 'HEAD']).stdout.trim();
        git(['update-ref', 'refs/remotes/upstream/main', upstream]);
        git(['switch', 'main']);
        mergeIntoReviewBranch(git, integrationBranch(base, upstream));
        assert.equal(readFileSync(join(dir, 'custom.txt'), 'utf8'), 'custom feature');
        assert.equal(readFileSync(join(dir, 'upstream.txt'), 'utf8'), 'upstream feature');
        assert.equal(git(['rev-parse', 'main']).stdout.trim(), base);
        assert.equal(git(['merge-base', '--is-ancestor', upstream, 'HEAD'], true).status, 0);
        assert.equal(git(['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.trim().split(' ').length, 3);
    });

    it('aborts conflicting merges and preserves custom production files and history', () => {
        writeFileSync(join(dir, 'shared.txt'), 'custom\n');
        git(['add', '.']); git(['commit', '-m', 'custom']);
        const base = git(['rev-parse', 'HEAD']).stdout.trim();
        git(['update-ref', 'refs/remotes/origin/main', base]);
        git(['switch', 'upstream']);
        writeFileSync(join(dir, 'shared.txt'), 'upstream\n');
        git(['add', '.']); git(['commit', '-m', 'upstream']);
        const upstream = git(['rev-parse', 'HEAD']).stdout.trim();
        git(['update-ref', 'refs/remotes/upstream/main', upstream]);
        git(['switch', 'main']);
        assert.throws(() => mergeIntoReviewBranch(git, integrationBranch(base, upstream)), /shared\.txt/);
        assert.equal(readFileSync(join(dir, 'shared.txt'), 'utf8'), 'custom\n');
        assert.equal(git(['rev-parse', 'main']).stdout.trim(), base);
        assert.equal(git(['status', '--porcelain']).stdout.trim(), '');
    });
});
