import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function integrationBranch(base, upstream) {
    if (![base, upstream].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new Error('Invalid commit ID');
    return `sync/upstream-${upstream.slice(0, 12)}-${base.slice(0, 12)}`;
}

export function mergeIntoReviewBranch(run, branch) {
    run(['switch', '-c', branch, 'origin/main']);
    const result = run(['merge', '--no-ff', '--no-edit', 'refs/remotes/upstream/main'], true);
    if (result.status !== 0) {
        const conflicts = run(['diff', '--name-only', '--diff-filter=U']).stdout.trim();
        run(['merge', '--abort']);
        throw new Error(`Upstream needs manual conflict resolution. Production was not changed.\n${conflicts}`);
    }
}

async function main() {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !process.env.GH_TOKEN) throw new Error('Missing GitHub workflow context');
    const run = (args, allowFailure = false) => {
        const result = spawnSync('git', args, { encoding: 'utf8' });
        if (!allowFailure && result.status !== 0) throw new Error(result.stderr || 'Git command failed');
        return result;
    };
    const api = async (path, method = 'GET', body) => {
        const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${process.env.GH_TOKEN}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json',
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} returned ${response.status}`);
        return response.status === 204 ? null : response.json();
    };
    run(['config', 'user.name', 'github-actions[bot]']);
    run(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    run(['fetch', 'origin', 'main']);
    run(['fetch', 'https://github.com/MarSeventh/CloudFlare-ImgBed.git', 'main:refs/remotes/upstream/main']);
    if (run(['merge-base', '--is-ancestor', 'refs/remotes/upstream/main', 'origin/main'], true).status === 0) {
        console.log('Production already contains this upstream version.');
        return;
    }
    const base = run(['rev-parse', 'origin/main']).stdout.trim();
    const upstream = run(['rev-parse', 'refs/remotes/upstream/main']).stdout.trim();
    const branch = integrationBranch(base, upstream);
    const existing = await api(`pulls?state=open&head=${encodeURIComponent(repository.split('/')[0] + ':' + branch)}&base=main`);
    if (existing.length) {
        console.log(`Review already pending: ${existing[0].html_url}`);
        return;
    }
    if (!run(['ls-remote', '--heads', 'origin', branch]).stdout.trim()) {
        mergeIntoReviewBranch(run, branch);
        run(['push', 'origin', `HEAD:refs/heads/${branch}`]);
    }
    const pr = await api('pulls', 'POST', {
        title: `Sync upstream ${upstream.slice(0, 12)}`,
        head: branch,
        base: 'main',
        body: [
            `Upstream commit: ${upstream}. Production base: ${base}.`,
            '',
            'This branch merges upstream while retaining custom commits. Production updates only after this PR is merged.',
            '',
            'Review compatibility notices in `.github/breaking-updates/`, configuration changes and custom-feature regressions before merging. Check any workflow changes as part of review.',
            '',
            'Regression checks are dispatched on this branch. No production deployment is requested by upstream synchronization.',
        ].join('\n'),
    });
    console.log(`Opened review: ${pr.html_url}`);
    // GITHUB_TOKEN-created PRs do not trigger ordinary PR workflows; dispatch tests explicitly.
    await api('actions/workflows/regression.yml/dispatches', 'POST', { ref: branch });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Upstream review: ${pr.html_url}\nProduction was not changed.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(error.message);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Upstream sync stopped: ${error.message}\n`);
        process.exitCode = 1;
    });
}
