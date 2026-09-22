import { Icon } from '../../components/Icon';
import { useComputer } from '../../hooks/useComputer';
import { useSimulation } from '../../hooks/useObservable';
import type { AppProps } from '../types';
import './runtime-monitor.css';

/** Debug view over every live RuntimeInstance - lists exactly what Runtime Monitor's spec
 * mock-up shows (pid, cpu/ram, wasm status, display resolution, input) without any special
 * "developer mode" gate, the same way Task Manager and Network Monitor are ordinary apps. */
export function RuntimeMonitorApp(_props: AppProps) {
  const computer = useComputer();
  useSimulation();
  const instances = computer.runtime.list();

  return (
    <div className="runtime-monitor">
      {instances.length === 0 ? (
        <p className="hint">No runtime instances are currently running.</p>
      ) : (
        instances.map((info) => (
          <section key={info.id} className="rm-card">
            <header>
              <Icon name="gamepad" size={20} />
              <strong>{info.appName}</strong>
              <span className={`rm-badge rm-${info.state}`}>{info.state}</span>
            </header>
            <dl>
              <div>
                <dt>Instance</dt>
                <dd>{info.id}</dd>
              </div>
              <div>
                <dt>Process</dt>
                <dd>PID {info.pid}</dd>
              </div>
              <div>
                <dt>CPU</dt>
                <dd>{info.cpuUsage.toFixed(1)}%</dd>
              </div>
              <div>
                <dt>RAM</dt>
                <dd>{info.memoryUsage} MB</dd>
              </div>
              <div>
                <dt>FPS</dt>
                <dd>{info.fps}</dd>
              </div>
              <div>
                <dt>WASM</dt>
                <dd>{info.wasmStatus}</dd>
              </div>
              <div>
                <dt>Display</dt>
                <dd>
                  {info.displayWidth}x{info.displayHeight}
                </dd>
              </div>
              <div>
                <dt>Input</dt>
                <dd>{info.inputConnected ? 'connected' : 'idle'}</dd>
              </div>
              {info.lastError && (
                <div>
                  <dt>Last error</dt>
                  <dd>{info.lastError}</dd>
                </div>
              )}
            </dl>
          </section>
        ))
      )}
    </div>
  );
}
