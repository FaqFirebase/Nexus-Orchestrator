// Scores the routing engines against a labeled prompt set.
// Usage: npm run eval:router
// Env: TYPESAFE_API_KEY (Jev), ROUTER_MODEL + ROUTER_URL/ROUTER_KEY or LOCAL_URL/LOCAL_KEY (LLM router).
// Each engine runs only when its settings are present.
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import {
  askJev,
  resolveJevCategory,
  routeWithLlm,
  CATEGORY_DEFINITIONS,
  JEV_MIN_CONFIDENCE,
  type RouteContext,
  type RouteRequest,
  type RoutingCategory,
} from '../router.js';

dotenv.config({ quiet: true });

interface EvalCase {
  prompt: string;
  expected: string;
  hasAttachments?: boolean;
}

interface EvalRun {
  prompt: string;
  expected: string;
  latencyMs: number;
  inputTokens: number;
  /** Category for each confidence limit (LLM runs use a single entry). */
  picks: Map<number, string>;
  error?: string;
}

const CASES_PATH = new URL('./routerEval.cases.json', import.meta.url);
const DEFAULT_LOCAL_URL = 'http://localhost:11434';
const CONFIDENCE_LIMITS = [0, 0.3, JEV_MIN_CONFIDENCE, 0.7];
const NO_LIMIT = 0;
const PERCENTILE_MEDIAN = 0.5;
const PERCENTILE_TAIL = 0.95;
const PERCENT = 100;

const cases: EvalCase[] = JSON.parse(readFileSync(CASES_PATH, 'utf-8'));

// Every built-in category gets one placeholder model so every category is eligible.
const categories: Record<string, RoutingCategory> = Object.fromEntries(
  Object.keys(CATEGORY_DEFINITIONS).map(name => [name, { models: [`${name.toLowerCase()}-model`], provider: 'local' }]),
);

const context: RouteContext = {
  router: {
    engine: 'jev',
    model: process.env.ROUTER_MODEL || '',
    url: process.env.ROUTER_URL || '',
    key: process.env.ROUTER_KEY || '',
    jevKey: process.env.TYPESAFE_API_KEY || '',
  },
  categories,
  localProvider: { url: process.env.LOCAL_URL || DEFAULT_LOCAL_URL, key: process.env.LOCAL_KEY || '' },
  defaultJevKey: '',
};

function toRequest(evalCase: EvalCase): RouteRequest {
  return { prompt: evalCase.prompt, hasAttachments: evalCase.hasAttachments ?? false, availableModels: [] };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, latencyMs: performance.now() - start };
}

async function runJev(evalCase: EvalCase): Promise<EvalRun> {
  const { value, latencyMs } = await timed(() => askJev(toRequest(evalCase), context));
  const picks = new Map(CONFIDENCE_LIMITS.map(limit => [limit, resolveJevCategory(value.answer, value.candidates, limit)]));
  return { prompt: evalCase.prompt, expected: evalCase.expected, latencyMs, inputTokens: value.usage?.input_tokens ?? 0, picks };
}

async function runLlm(evalCase: EvalCase): Promise<EvalRun> {
  const { value, latencyMs } = await timed(() => routeWithLlm(toRequest(evalCase), context));
  return {
    prompt: evalCase.prompt,
    expected: evalCase.expected,
    latencyMs,
    inputTokens: value.usage?.prompt_tokens ?? 0,
    picks: new Map([[NO_LIMIT, value.category]]),
  };
}

async function evaluate(runOne: (c: EvalCase) => Promise<EvalRun>): Promise<EvalRun[]> {
  const runs: EvalRun[] = [];
  for (const evalCase of cases) {
    try {
      runs.push(await runOne(evalCase));
    } catch (err: any) {
      runs.push({ prompt: evalCase.prompt, expected: evalCase.expected, latencyMs: 0, inputTokens: 0, picks: new Map(), error: err.message });
    }
  }
  return runs;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function formatPercent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((part / whole) * PERCENT).toFixed(1)}%`;
}

function report(name: string, runs: EvalRun[]): void {
  const ok = runs.filter(r => !r.error);
  const latencies = ok.map(r => r.latencyMs);
  const tokens = ok.reduce((sum, r) => sum + r.inputTokens, 0);

  console.log(`\n=== ${name} ===`);
  console.log(`Cases: ${runs.length}  Errors: ${runs.length - ok.length}`);
  console.log(`Latency ms: p50 ${percentile(latencies, PERCENTILE_MEDIAN).toFixed(0)}  p95 ${percentile(latencies, PERCENTILE_TAIL).toFixed(0)}`);
  console.log(`Input tokens: total ${tokens}  mean ${ok.length ? (tokens / ok.length).toFixed(0) : 0}`);

  const limits = [...(ok[0]?.picks.keys() ?? [])];
  for (const limit of limits) {
    const correct = ok.filter(r => r.picks.get(limit) === r.expected).length;
    const label = limits.length > 1 ? `Accuracy (confidence limit ${limit})` : 'Accuracy';
    console.log(`${label}: ${correct}/${ok.length} = ${formatPercent(correct, ok.length)}`);
  }

  const reportLimit = limits.includes(JEV_MIN_CONFIDENCE) ? JEV_MIN_CONFIDENCE : NO_LIMIT;
  const misses = ok.filter(r => r.picks.get(reportLimit) !== r.expected);
  for (const miss of misses) {
    console.log(`  MISS expected ${miss.expected.padEnd(9)} got ${(miss.picks.get(reportLimit) ?? '').padEnd(9)} ${miss.prompt.slice(0, 70)}`);
  }
  for (const failed of runs.filter(r => r.error)) {
    console.log(`  ERROR ${failed.error} :: ${failed.prompt.slice(0, 50)}`);
  }
}

async function main(): Promise<void> {
  const engines: Array<[string, (c: EvalCase) => Promise<EvalRun>]> = [];
  if (context.router.jevKey) engines.push(['Jev', runJev]);
  if (context.router.model) engines.push([`LLM router (${context.router.model})`, runLlm]);
  if (engines.length === 0) {
    console.error('Set TYPESAFE_API_KEY and/or ROUTER_MODEL to run the evaluation.');
    process.exit(1);
  }
  for (const [name, runOne] of engines) {
    report(name, await evaluate(runOne));
  }
}

main();
