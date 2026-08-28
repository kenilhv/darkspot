import { useEffect, useRef, useState } from 'react';
import { SimFrame, SimLegend, SimControls, SimStat, SimAllocationReadout, sim } from '../src';

/** Demo-only placeholder drawing so the frame has something inside it. Not SWARM's sim. */
function PlaceholderCanvas({ tick }: { tick: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = (c.width = c.clientWidth);
    const h = (c.height = c.clientHeight);
    ctx.clearRect(0, 0, w, h);
    const pts: ReadonlyArray<readonly [number, number]> = [[0.2, 0.3], [0.45, 0.25], [0.7, 0.4], [0.35, 0.65], [0.6, 0.7], [0.85, 0.6]];
    ctx.strokeStyle = sim.link;
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]!, b = pts[j]!;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.35) {
          ctx.beginPath(); ctx.moveTo(a[0] * w, a[1] * h); ctx.lineTo(b[0] * w, b[1] * h); ctx.stroke();
        }
      }
    }
    const p = (i: number) => [pts[i]![0] * w, pts[i]![1] * h] as const;
    ctx.strokeStyle = sim.route; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(...p(0)); ctx.lineTo(...p(1)); ctx.lineTo(...p(2)); ctx.stroke();
    ctx.setLineDash([6, 4]); ctx.strokeStyle = sim.droneRoute; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(...p(3)); ctx.lineTo(...p(5)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = sim.label; ctx.font = '12px IBM Plex Mono, monospace';
    ctx.fillText('SIMULATION', (p(3)[0] + p(5)[0]) / 2, (p(3)[1] + p(5)[1]) / 2 - 8);
    const kinds = ['bridge', 'relay', 'unit', 'settlement', 'relay', 'unit'] as const;
    pts.forEach(([x, y], i) => {
      const px = x * w, py = y * h + Math.sin((tick + i) / 3) * 2, k = kinds[i]!;
      if (k === 'bridge') { ctx.fillStyle = sim.nodeBridge; ctx.fillRect(px - 7, py - 7, 14, 14); }
      else if (k === 'relay') { ctx.fillStyle = sim.nodeRelay; ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px + 8, py + 7); ctx.lineTo(px - 8, py + 7); ctx.closePath(); ctx.fill(); }
      else if (k === 'unit') { ctx.fillStyle = sim.nodeUnit; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = '#665D91'; ctx.strokeStyle = sim.silenceRing; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    });
  }, [tick]);
  return <canvas ref={ref} />;
}

export function SimDemo() {
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000 / speed);
    return () => clearInterval(id);
  }, [running, speed]);
  const modes = [
    { component: 0, mode: 'hungarian' as const, units: 3, tasks: 4, cost: 12.4 },
    { component: 2, mode: 'auction' as const, units: 2, tasks: 2, cost: 7.1, rounds: 2 },
    { component: 3, mode: 'auction' as const, units: 1, tasks: 0, idle: true },
  ];
  return (
    <SimFrame
      title="Mesh formation · routing · allocation"
      canvasDescription={`Tick ${tick}. 6 nodes: 1 bridge, 2 relays, 2 units, 1 settlement. One AntHocNet path bridge→relay→unit. One simulated UAV ferry route.`}
      controls={
        <SimControls
          running={running}
          onRun={() => setRunning(true)}
          onPause={() => setRunning(false)}
          onStep={() => setTick((t) => t + 1)}
          onReset={() => { setRunning(false); setTick(0); }}
          speed={speed}
          onSpeed={setSpeed}
          tick={tick}
        />
      }
      aside={
        <>
          <div className="ds-simstats">
            <SimStat label="Protocol" value="AntHocNet" detail="vs AODV baseline" tone="accent" />
            <SimStat label="Delivery" value="0.97" detail="AODV 0.91 (demo numbers)" />
            <SimStat label="Links cut" value={1} tone="hazard" />
            <SimStat label="Without command" value={3} detail="units" tone="attention" />
          </div>
          <SimAllocationReadout modes={modes} unitsWithoutCommand={3} />
          <SimLegend />
        </>
      }
    >
      <PlaceholderCanvas tick={tick} />
    </SimFrame>
  );
}
