/**
 * Tick-based driver that runs a routing protocol over a Network for a set of
 * traffic sessions and collects comparable metrics. Both protocols see the same
 * scenario callbacks (congestion, link cuts, moves) at the same ticks.
 */
export function runSessions(proto, sessions, {
  ticks = 50, packetsPerTick = 4, hello = true, onTick = null, scenario = null,
} = {}) {
  const isAnt = typeof proto.helloRound === 'function';
  const perTick = [];
  const totals = { sent: 0, delivered: 0, delaySum: 0, hopSum: 0 };
  for (const { s, d } of sessions) {
    if (isAnt) { if (!proto.entries(s, d).size) proto.reactiveSetup(s, d); }
    else if (!proto.route(s, d)) proto.discover(s, d);
  }
  for (let t = 0; t < ticks; t++) {
    if (scenario) scenario(t, proto.net, proto);
    if (isAnt && hello) { proto.helloRound(); for (const { s, d } of sessions) proto.proactiveCheck(s, d); }
    const row = { tick: t, sent: 0, delivered: 0, delaySum: 0, paths: [] };
    for (const { s, d } of sessions) {
      for (let p = 0; p < packetsPerTick; p++) {
        const r = proto.sendData(s, d);
        row.sent++; totals.sent++;
        if (r.delivered) { row.delivered++; totals.delivered++; row.delaySum += r.delay; totals.delaySum += r.delay; totals.hopSum += r.hops; }
        row.paths.push(r.path);
      }
    }
    perTick.push(row);
    if (onTick) onTick(row, proto);
  }
  return {
    deliveryRatio: totals.delivered / totals.sent,
    meanDelay: totals.delivered ? totals.delaySum / totals.delivered : Infinity,
    meanHops: totals.delivered ? totals.hopSum / totals.delivered : Infinity,
    perTick, stats: { ...proto.stats },
  };
}
