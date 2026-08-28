/**
 * Assembles the four DarkSpot demo surfaces into one deployable static site.
 *
 * Sources live in sibling worktrees (agent/design-system, agent/swarm) rather than
 * this repo, so this script builds from them by path. Run it from the repo root:
 *   node scripts/build-site.mjs
 *
 * Output: site/  — a plain static directory Render serves as-is.
 *   site/index.html      landing page (checked in, not generated)
 *   site/coordinator/    Vite build of packages/ui/demo (base:'./' so it works in a subdir)
 *   site/sim/            swarm/web verbatim, minus its dev-only node server
 *   site/packages/ui/tokens.json   sim.js fetches this absolute path; without it the
 *                                  page still works from its embedded mirror.
 */
import { cp, mkdir, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HACKATHONS = join(root, '..');
const DESIGN = join(HACKATHONS, 'darkspot-design', 'packages', 'ui');
const SWARM = join(HACKATHONS, 'darkspot-swarm', 'swarm');
const site = join(root, 'site');

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const log = (...a) => console.log('[build-site]', ...a);

for (const [name, p] of [['design', DESIGN], ['swarm', SWARM]]) {
  if (!(await exists(p))) {
    console.error(`[build-site] missing ${name} worktree at ${p}`);
    console.error('  Both sibling worktrees must be checked out. See COORDINATION.md §5a D-1.');
    process.exit(1);
  }
}

// 1. Coordinator — real Vite build, not a copy of a stale dist-demo.
log('building coordinator (vite)…');
execFileSync('npm', ['run', 'demo:build'], { cwd: DESIGN, stdio: 'inherit', shell: true });

// 2. Assemble.
await rm(site, { recursive: true, force: true });
await mkdir(join(site, 'packages', 'ui'), { recursive: true });

log('copying coordinator → site/coordinator');
await cp(join(DESIGN, 'dist-demo'), join(site, 'coordinator'), { recursive: true });

log('copying sim → site/sim');
await cp(join(SWARM, 'web'), join(site, 'sim'), {
  recursive: true,
  filter: (src) => !src.endsWith('serve.js'), // dev-only static server; Render serves these directly
});

// web/sim.js imports '../src/engine.js' and '../src/adapter.js'. In the dev server the site root
// is swarm/, so those resolve to swarm/src/. Mirror that layout here (site/sim/ + site/src/) so
// the same relative imports resolve unchanged — no rewriting of SWARM's source.
log('copying sim algorithm modules → site/src');
await cp(join(SWARM, 'src'), join(site, 'src'), { recursive: true });

if (await exists(join(DESIGN, 'tokens.json'))) {
  await cp(join(DESIGN, 'tokens.json'), join(site, 'packages', 'ui', 'tokens.json'));
  log('copied tokens.json (sim reads it at /packages/ui/tokens.json)');
}

// 3. Landing page + styles are checked into site-src/ and copied last so a rebuild
//    never clobbers them (site/ is wiped above and is not tracked).
log('copying landing page → site/');
await cp(join(root, 'site-src'), site, { recursive: true });

log('done → site/');
