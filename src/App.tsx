import { useEffect } from 'react';
import { appRegistry } from './apps';
import { Desktop } from './desktop/Desktop/Desktop';
import { ComputerContext } from './hooks/useComputer';
import { useSettings } from './hooks/useObservable';
import { useComputerStore } from './store/computerStore';

function ThemedApp({ children }: { children: React.ReactNode }) {
  const settings = useSettings();
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.fontSize = `${15 * settings.uiScale}px`;
  }, [settings.theme, settings.uiScale]);
  return <>{children}</>;
}

function BootScreen() {
  return (
    <div className="boot-screen">
      <div className="boot-logo">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 8l4 4-4 4M14 16h4" />
        </svg>
      </div>
      <div className="boot-spinner" />
      <div className="boot-text">Starting Computer Simulator</div>
    </div>
  );
}

export default function App() {
  const { status, computer, boot, flush } = useComputerStore();

  useEffect(() => {
    void boot(appRegistry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onBeforeUnload = () => void flush();
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush();
    });
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flush]);

  if (status !== 'ready' || !computer) return <BootScreen />;

  return (
    <ComputerContext.Provider value={computer}>
      <ThemedApp>
        <Desktop />
      </ThemedApp>
    </ComputerContext.Provider>
  );
}
