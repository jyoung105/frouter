// src/tui/UpdateApp.tsx — Ink-based update flow with ProgressBar + Spinner.
// Runs pre-ALT_ON (normal terminal), no harness needed.

import { useState, useRef, useCallback, useEffect } from "react";
import { Text, Box } from "ink";
import {
  ConfirmInput,
  Spinner,
  ProgressBar,
  StatusMessage,
} from "./primitives.js";
import { spawn } from "node:child_process";

type UpdateInstallCommand = { bin: string; args: string[] };

export type UpdateAppProps = {
  currentVersion: string;
  latestVersion: string;
  detectInstallCommand: () => UpdateInstallCommand | null;
  readHighestPercent: (text: string) => number | null;
  onDone: (result: "skipped" | "updated" | "failed") => void;
};

type Phase = "confirm" | "installing" | "done";

export function UpdateApp({
  currentVersion,
  latestVersion,
  detectInstallCommand,
  readHighestPercent,
  onDone,
}: UpdateAppProps) {
  const [phase, setPhase] = useState<Phase>("confirm");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { cleanupRef.current?.(); }, []);

  const startInstall = useCallback(() => {
    setPhase("installing");

    const command = detectInstallCommand();
    if (!command) {
      setError("No supported package manager found (npm or bun).");
      setPhase("done");
      setTimeout(() => onDone("failed"), 500);
      return;
    }

    let done = false;
    let currentProgress = 0;

    const child = spawn(command.bin, command.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) => !k.toLowerCase().startsWith("npm_"),
        ),
      ),
    });

    const fallback = setInterval(() => {
      if (currentProgress < 95) {
        currentProgress = Math.min(currentProgress + 1, 95);
        setProgress(currentProgress);
      }
    }, 120);

    cleanupRef.current = () => clearInterval(fallback);

    const onChunk = (chunk: Buffer) => {
      const highest = readHighestPercent(String(chunk));
      if (highest != null) {
        const next = Math.min(highest, 99);
        if (next > currentProgress) {
          currentProgress = next;
          setProgress(currentProgress);
        }
      }
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    function finish(ok: boolean) {
      if (done) return;
      done = true;
      clearInterval(fallback);
      cleanupRef.current = null;
      if (ok) {
        setProgress(100);
        setPhase("done");
        setTimeout(() => onDone("updated"), 500);
      } else {
        const errMsg = "Update command failed.";
        setError(errMsg);
        setPhase("done");
        setTimeout(() => onDone("failed"), 500);
      }
    }

    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  }, [detectInstallCommand, readHighestPercent, onDone]);

  if (phase === "confirm") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>
          <Text color="yellow">Update available: </Text>
          <Text dimColor>{currentVersion}</Text>
          <Text> → </Text>
          <Text color="green" bold>{latestVersion}</Text>
        </Text>
        <Box marginTop={1}>
          <Text>Update now? </Text>
          <ConfirmInput
            defaultChoice="cancel"
            onConfirm={() => startInstall()}
            onCancel={() => onDone("skipped")}
          />
        </Box>
      </Box>
    );
  }

  if (phase === "installing") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Spinner label="Updating free-router…" />
        <Box marginTop={1}>
          <Text>  </Text>
          <ProgressBar value={progress} />
          <Text> {progress}%</Text>
        </Box>
      </Box>
    );
  }

  // phase === "done"
  return (
    <Box flexDirection="column" paddingLeft={1}>
      {error ? (
        <StatusMessage variant="error">{error}</StatusMessage>
      ) : (
        <StatusMessage variant="success">
          Updated to {latestVersion}. Restarting…
        </StatusMessage>
      )}
    </Box>
  );
}
