// src/tui/FirstRunApp.tsx — Ink-based first-run wizard with Select + PasswordInput.
// Runs pre-ALT_ON (normal terminal), no harness needed.

import { useRef, useState } from "react";
import { Text, Box, useInput } from "ink";
import { Select, PasswordInput, StatusMessage } from "@inkjs/ui";
import { useMountEffect } from "./useMountEffect.js";

type ProviderMeta = {
  name: string;
  signupUrl: string;
  keyPrefix?: string;
};

export type FirstRunResult = {
  apiKeys: Record<string, string>;
  starPromptHandled: boolean;
  startupSearchRequested: boolean;
};

export type FirstRunAppProps = {
  providers: Record<string, ProviderMeta>;
  validateKey: (pk: string, raw: string) => { ok: boolean; key?: string; reason?: string };
  openBrowser: (url: string) => void;
  onDone: (result: FirstRunResult) => void;
};

type Step = "choose" | "input" | "starConfirm" | "saving";

const GITHUB_REPO_URL = "https://github.com/jyoung105/frouter";

export function FirstRunApp({
  providers,
  validateKey,
  openBrowser,
  onDone,
}: FirstRunAppProps) {
  const pks = Object.keys(providers);
  const [providerIdx, setProviderIdx] = useState(0);
  const [step, setStep] = useState<Step>("choose");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedRef = useRef(false);

  const currentPk = pks[providerIdx];
  const currentMeta = currentPk ? providers[currentPk] : null;
  const hasAnyKey = Object.keys(apiKeys).length > 0;

  function clearCompletionTimer() {
    if (completionTimerRef.current) {
      clearTimeout(completionTimerRef.current);
      completionTimerRef.current = null;
    }
  }

  useMountEffect(() => () => clearCompletionTimer());

  function finalizeOnce(
    nextApiKeys: Record<string, string>,
    startupSearchRequested: boolean,
  ) {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    clearCompletionTimer();
    setApiKeys(nextApiKeys);
    setSaving(true);
    completionTimerRef.current = setTimeout(() => {
      onDone({
        apiKeys: nextApiKeys,
        starPromptHandled: true,
        startupSearchRequested,
      });
    }, 600);
  }

  useInput((input, key) => {
    if (saving || resolvedRef.current) return;

    if (step === "starConfirm") {
      if (key.escape || (key.ctrl && input === "c")) {
        if (hasAnyKey) finalizeOnce(apiKeys, false);
        return;
      }
    }

    if (key.ctrl && input === "c") {
      if (hasAnyKey) {
        clearCompletionTimer();
        setError("");
        setStep("starConfirm");
      } else {
        setError("At least one API key is required to use frouter.");
        setProviderIdx(0);
        setStep("choose");
      }
    }
  });

  function advanceProvider(nextApiKeys: Record<string, string>) {
    setError("");
    if (providerIdx + 1 < pks.length) {
      setProviderIdx(providerIdx + 1);
      setStep("choose");
      return;
    }
    if (Object.keys(nextApiKeys).length === 0) {
      setError("At least one API key is required to use frouter.");
      setProviderIdx(0);
      setStep("choose");
      return;
    }
    clearCompletionTimer();
    setApiKeys(nextApiKeys);
    setStep("starConfirm");
  }

  if (saving) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text bold>frouter — Free Model Router</Text>
        <Box marginTop={1}>
          <StatusMessage variant="success">
            {Object.keys(apiKeys).length} key(s) configured. Starting frouter…
          </StatusMessage>
        </Box>
      </Box>
    );
  }

  if (!currentMeta && step !== "starConfirm") return null;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold>frouter — Free Model Router</Text>
      <Text dimColor>Set up your API keys (step {providerIdx + 1}/{pks.length})</Text>

      <Box marginTop={1} flexDirection="column">
        {step === "starConfirm" ? (
          <Box flexDirection="column">
            <Text>Support for github star: [Y/n]</Text>
            <Text dimColor>Yes opens the repo in your browser and starts frouter in model search.</Text>
            <Box marginTop={1}>
              <Select
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                onChange={(val) => {
                  if (val === "yes") {
                    openBrowser(GITHUB_REPO_URL);
                    finalizeOnce(apiKeys, true);
                    return;
                  }
                  finalizeOnce(apiKeys, false);
                }}
              />
            </Box>
          </Box>
        ) : (
          <>
            <Text>
              <Text bold>{currentMeta.name}</Text>
              <Text dimColor>  Free key at: </Text>
              <Text color="cyan">{currentMeta.signupUrl}</Text>
            </Text>

            {step === "choose" && (
              <Box marginTop={1} flexDirection="column">
                <Select
                  options={[
                    { label: "Open browser + enter key", value: "open" },
                    { label: "Enter key manually", value: "manual" },
                    { label: "Skip this provider", value: "skip" },
                    ...(hasAnyKey
                      ? [{ label: "Skip remaining setup →", value: "done" }]
                      : []),
                  ]}
                  onChange={(val) => {
                    if (val === "open") {
                      openBrowser(currentMeta.signupUrl);
                      setStep("input");
                    } else if (val === "manual") {
                      setStep("input");
                    } else if (val === "done") {
                      advanceProvider(apiKeys);
                    } else {
                      advanceProvider(apiKeys);
                    }
                  }}
                />
              </Box>
            )}

            {step === "input" && (
              <Box marginTop={1} flexDirection="column">
                <Text dimColor>Paste your {currentMeta.name} API key (Enter to submit, Esc to skip):</Text>
                <PasswordInput
                  placeholder={currentMeta.keyPrefix ? `${currentMeta.keyPrefix}...` : "paste key here"}
                  onSubmit={(value) => {
                    if (!value) {
                      advanceProvider(apiKeys);
                      return;
                    }
                    const checked = validateKey(currentPk, value);
                    if (!checked.ok) {
                      setError(checked.reason || "Invalid key");
                      return;
                    }
                    const nextApiKeys = { ...apiKeys, [currentPk]: checked.key };
                    setApiKeys(nextApiKeys);
                    setError("");
                    advanceProvider(nextApiKeys);
                  }}
                />
                {error && (
                  <StatusMessage variant="error">{error}. Try again or Esc to skip.</StatusMessage>
                )}
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
