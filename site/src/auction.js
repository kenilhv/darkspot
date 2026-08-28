/**
 * Local, market-based task allocation for units WITHOUT connectivity to command.
 *
 * Sources: M. B. Dias, R. Zlot, N. Kalra, A. Stentz, "Market-Based Multirobot
 * Coordination: A Survey and Analysis", Proc. IEEE 94(7):1257–1270, 2006,
 * doi:10.1109/JPROC.2006.876939; R. Zlot, "An Auction-Based Approach to
 * Complex Task Allocation for Multirobot Teams", PhD thesis, CMU-RI-TR-06-53,
 * 2006. The specific mechanism here is a sequential single-item (SSI) auction:
 * tasks are auctioned one at a time, each unit bids its own cost estimate for
 * the task, the lowest bid wins, winners drop out of later rounds (ST-SR-IA in
 * Gerkey & Matarić's MRTA taxonomy, IJRR 23(9):939–954, 2004). SSI auctions
 * are fast and decentralisable but not optimal — Koenig, Tovey, Lagoudakis,
 * Markakis, Kempe, Keskinocak, Kleywegt, Meyerson, Jain, "The Power of
 * Sequential Single-Item Auctions for Agent Coordination", AAAI 2006,
 * pp. 1625–1629, prove a constant-factor bound on total travel. The round
 * structure below (every free unit bids on every remaining task, one lowest
 * bid awarded per round) is that paper's SSI definition; the gap versus the
 * Hungarian optimum is measured in the tests rather than hand-waved.
 *
 * "Local" means: an auction runs only among the units and tasks that share a
 * mesh component (they can hear each other); nothing outside the component is
 * visible, and no participant needs a link to command. Any connected member
 * can act as auctioneer — the outcome does not depend on which one does,
 * because bids are deterministic and ties break by (bid, unitId).
 *
 * Output is ADVISORY (COORDINATION.md §1a Rule 1): it pairs units with tasks
 * as a suggestion for a human to accept; it is never a dispatch order.
 */
export function ssiAuction(units, tasks, costFn, { ties = (a, b) => a.unitId.localeCompare(String(b.unitId)) } = {}) {
  const free = new Set(units.map((u) => u.id));
  const pairings = [];
  const rounds = [];
  const remaining = tasks.slice();
  while (remaining.length && free.size) {
    // every free unit bids on every remaining task; the globally lowest bid is awarded first
    let best = null;
    const bids = [];
    for (const t of remaining) for (const u of units) {
      if (!free.has(u.id)) continue;
      const bid = costFn(u, t);
      if (!Number.isFinite(bid)) continue;
      bids.push({ unitId: u.id, taskId: t.id, bid });
      if (!best || bid < best.bid || (bid === best.bid && ties({ unitId: String(u.id) }, { unitId: String(best.unitId) }) < 0)) best = { unitId: u.id, taskId: t.id, bid };
    }
    if (!best) break;
    rounds.push({ bids, awarded: best });
    pairings.push({ unitId: best.unitId, taskId: best.taskId, cost: best.bid });
    free.delete(best.unitId);
    remaining.splice(remaining.findIndex((t) => t.id === best.taskId), 1);
  }
  return { pairings, rounds, cost: pairings.reduce((a, p) => a + p.cost, 0), unassignedTasks: remaining.map((t) => t.id) };
}
