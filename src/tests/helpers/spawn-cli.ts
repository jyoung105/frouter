import { spawn } from 'node:child_process';

type InputChunk = {
  delayMs?: number;
  data?: string;
};

type RunNodeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  inputChunks?: InputChunk[];
  timeoutMs?: number;
};

type RunNodeResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export function runNode(args: string[], options: RunNodeOptions = {}): Promise<RunNodeResult> {
  const {
    cwd,
    env,
    input,
    inputChunks,
    timeoutMs = 10_000,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    if (Array.isArray(inputChunks) && inputChunks.length > 0) {
      let maxDelay = 0;
      for (const chunk of inputChunks) {
        const delayMs = Math.max(0, chunk?.delayMs ?? 0);
        if (delayMs > maxDelay) maxDelay = delayMs;
        setTimeout(() => {
          if (!child.killed && child.stdin.writable) {
            child.stdin.write(String(chunk?.data ?? ''));
          }
        }, delayMs);
      }
      setTimeout(() => {
        if (child.stdin.writable) child.stdin.end();
      }, maxDelay + 50);
    } else if (typeof input === 'string') {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}
