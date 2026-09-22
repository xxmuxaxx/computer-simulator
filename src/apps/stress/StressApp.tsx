import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Meter } from '../../components/Meter';
import { useComputer } from '../../hooks/useComputer';
import { useSimulation } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './stress.css';

const STAGES = ['Integer math', 'Floating point', 'Memory bandwidth', 'Disk throughput'];
const DURATION_TICKS = 24; // 250 ms each

/** A deliberately heavy demo application: it reserves lots of RAM and burns simulated CPU while running. */
export function StressApp({ pid }: AppProps) {
  const computer = useComputer();
  useSimulation();
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ticks = useRef(0);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
  };

  useEffect(() => stop, []);

  const start = () => {
    ticks.current = 0;
    setProgress(0);
    setScore(null);
    setRunning(true);
    timer.current = setInterval(() => {
      ticks.current++;
      computer.processManager.boost(pid, 55);
      setProgress(Math.min(100, (ticks.current / DURATION_TICKS) * 100));
      if (ticks.current >= DURATION_TICKS) {
        stop();
        setScore(Math.round(8200 + Math.random() * 1800));
        computer.notifications.success('Benchmark finished', 'Results are ready.');
      }
    }, 250);
  };

  const stage = Math.min(STAGES.length - 1, Math.floor((progress / 100) * STAGES.length));

  return (
    <div className="stress">
      <div className="stress-head">
        <Icon name="flame" size={28} />
        <div>
          <h2>System Benchmark</h2>
          <p>Heavy demo application: uses about 900 MB of RAM and stresses the virtual CPU. Watch the effect in Task Manager.</p>
        </div>
      </div>
      <div className="stress-live">
        <span>CPU {Math.round(computer.cpu.load)}%</span>
        <Meter value={computer.cpu.load} label="CPU" />
        <span>RAM {Math.round(computer.memory.usagePercent)}%</span>
        <Meter value={computer.memory.usagePercent} label="RAM" />
      </div>
      <div className="stress-run">
        <div className="stress-stage">{running ? `${STAGES[stage]}...` : score ? 'Completed' : 'Ready'}</div>
        <Meter value={progress} label="Benchmark progress" tone="accent" />
        {score !== null && (
          <div className="score">
            Score <strong>{score}</strong>
          </div>
        )}
        <button className={`btn ${running ? 'btn-danger' : 'btn-primary'}`} onClick={running ? stop : start}>
          {running ? 'Stop' : score ? 'Run again' : 'Run benchmark'}
        </button>
      </div>
    </div>
  );
}
