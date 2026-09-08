import { performance } from 'node:perf_hooks';

/** Stage diagnostics distinguish slow native rendering from transport failures. */
export async function timedStage<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  console.info(`[integration] ${name}: started`);
  try {
    return await run();
  } finally {
    console.info(`[integration] ${name}: ${(performance.now() - started).toFixed(0)} ms`);
  }
}
