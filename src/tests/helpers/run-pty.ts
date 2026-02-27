import { spawn } from "node:child_process";

const PY_PTY_RUNNER = `
import base64
import json
import os
import pty
import select
import signal
import sys
import time

cmd = json.loads(os.environ["PTY_CMD"])
chunks = json.loads(os.environ.get("PTY_INPUT", "[]"))
timeout_ms = int(os.environ.get("PTY_TIMEOUT_MS", "12000"))

chunks = sorted(chunks, key=lambda c: int(c.get("delayMs", 0)))

pid, master_fd = pty.fork()
if pid == 0:
    for key in ("PTY_CMD", "PTY_INPUT", "PTY_TIMEOUT_MS"):
        os.environ.pop(key, None)
    os.execvp(cmd[0], cmd)

start = time.monotonic()
cursor = 0
timed_out = False
captured = bytearray()
exit_status = None

def elapsed_ms():
    return int((time.monotonic() - start) * 1000)

while True:
    now = elapsed_ms()
    while cursor < len(chunks) and now >= int(chunks[cursor].get("delayMs", 0)):
        data = str(chunks[cursor].get("data", ""))
        if data:
            os.write(master_fd, data.encode())
        cursor += 1

    r, _, _ = select.select([master_fd], [], [], 0.05)
    if master_fd in r:
        try:
            block = os.read(master_fd, 4096)
            if block:
                captured.extend(block)
        except OSError:
            pass

    done_pid, status = os.waitpid(pid, os.WNOHANG)
    if done_pid == pid:
        exit_status = status
        break

    if now >= timeout_ms:
        timed_out = True
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        _, status = os.waitpid(pid, 0)
        exit_status = status
        break

# final drain
while True:
    r, _, _ = select.select([master_fd], [], [], 0)
    if master_fd not in r:
        break
    try:
        block = os.read(master_fd, 4096)
    except OSError:
        break
    if not block:
        break
    captured.extend(block)

code = os.waitstatus_to_exitcode(exit_status) if exit_status is not None else None
sig_name = None
if code is not None and code < 0:
    try:
        sig_name = signal.Signals(-code).name
    except Exception:
        sig_name = None
    code = None

sys.stdout.write(json.dumps({
    "code": code,
    "signal": sig_name,
    "timedOut": timed_out,
    "stdout_b64": base64.b64encode(bytes(captured)).decode("ascii"),
    "stderr_b64": "",
}))
`;

type InputChunk = {
  delayMs?: number;
  data?: string;
};

type PtyRunnerJson = {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout_b64?: string;
  stderr_b64?: string;
};

type RunInPtyOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  inputChunks?: InputChunk[];
  timeoutMs?: number;
};

type RunInPtyResult = {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

function runPythonPty(
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: any[] } = {},
): Promise<PtyRunnerJson> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", PY_PTY_RUNNER], options);

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`python3 PTY runner failed (${code}): ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed as PtyRunnerJson);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reject(
          new Error(
            `Failed to parse PTY runner JSON: ${message}\nRAW:${stdout}\nERR:${stderr}`,
          ),
        );
      }
    });
  });
}

export async function runInPty(
  command: string,
  args: string[] = [],
  options: RunInPtyOptions = {},
): Promise<RunInPtyResult> {
  if (process.platform === "win32") {
    throw new Error("runInPty is not supported on Windows");
  }

  const { cwd, env, inputChunks = [], timeoutMs = 12_000 } = options;

  const runnerEnv = {
    ...process.env,
    FROUTER_TUI_FORCE_CLEAR: "1", // keep deterministic frame boundaries in PTY snapshots
    ...env,
    PTY_CMD: JSON.stringify([command, ...args]),
    PTY_INPUT: JSON.stringify(inputChunks),
    PTY_TIMEOUT_MS: String(timeoutMs),
  };

  const result = await runPythonPty({
    cwd,
    env: runnerEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    code: result.code,
    signal: result.signal,
    timedOut: Boolean(result.timedOut),
    stdout: Buffer.from(result.stdout_b64 || "", "base64").toString("utf8"),
    stderr: Buffer.from(result.stderr_b64 || "", "base64").toString("utf8"),
  };
}

export function stripAnsi(text: string) {
  return String(text)
    .replace(/\x1B\][^\x07]*\x07/g, "") // OSC sequences
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
    .replace(/\r/g, "");
}
