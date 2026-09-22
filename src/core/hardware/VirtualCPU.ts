import { Observable } from '../../utils/Observable';
import { clamp } from '../../utils/format';

export interface CpuSpec {
  model: string;
  cores: number;
  baseFrequencyMHz: number;
  maxFrequencyMHz: number;
}

export const DEFAULT_CPU: CpuSpec = {
  model: 'Simulated Core X4',
  cores: 4,
  baseFrequencyMHz: 2400,
  maxFrequencyMHz: 3600,
};

/** Virtual CPU: derives its load from the processes running on the computer. */
export class VirtualCPU extends Observable {
  readonly model: string;
  readonly cores: number;
  readonly baseFrequencyMHz: number;
  readonly maxFrequencyMHz: number;
  private _load = 0;
  private _coreLoads: number[];

  constructor(spec: CpuSpec = DEFAULT_CPU) {
    super();
    this.model = spec.model;
    this.cores = spec.cores;
    this.baseFrequencyMHz = spec.baseFrequencyMHz;
    this.maxFrequencyMHz = spec.maxFrequencyMHz;
    this._coreLoads = new Array(spec.cores).fill(0);
  }

  /** Overall load, 0..100. */
  get load(): number {
    return this._load;
  }

  get coreLoads(): readonly number[] {
    return this._coreLoads;
  }

  /** Frequency scales linearly between base and max with the load. */
  get frequencyMHz(): number {
    return Math.round(this.baseFrequencyMHz + (this.maxFrequencyMHz - this.baseFrequencyMHz) * (this._load / 100));
  }

  update(totalLoad: number, random: () => number = Math.random): void {
    this._load = Math.round(clamp(totalLoad, 0, 100) * 10) / 10;
    // Spread the load over the cores with some noise, keeping the average close to the total.
    const loads = Array.from({ length: this.cores }, () => this._load * (0.6 + random() * 0.8));
    const avg = loads.reduce((a, b) => a + b, 0) / this.cores || 1;
    const scale = this._load > 0 ? this._load / avg : 0;
    this._coreLoads = loads.map((l) => Math.round(clamp(l * scale, 0, 100) * 10) / 10);
    this.emit();
  }
}
