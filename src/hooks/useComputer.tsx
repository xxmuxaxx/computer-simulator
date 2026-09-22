import { createContext, useContext } from 'react';
import type { VirtualComputer } from '../core/computer/VirtualComputer';

export const ComputerContext = createContext<VirtualComputer | null>(null);

export function useComputer(): VirtualComputer {
  const computer = useContext(ComputerContext);
  if (!computer) throw new Error('useComputer must be used inside <ComputerContext.Provider>');
  return computer;
}
