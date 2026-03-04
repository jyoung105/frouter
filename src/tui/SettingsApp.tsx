// src/tui/SettingsApp.tsx — Ink-based settings screen with Select + PasswordInput + Spinner.
// Uses ink-harness (runs mid-session from ALT_ON state).

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Text, Box, useInput } from "ink";
import { Select, PasswordInput, StatusMessage } from "@inkjs/ui";

type ProviderMeta = {
  name: string;
  testModel: string;
  chatUrl: string;
  keyPrefix?: string;
  signupUrl?: string;
};

export type SettingsResult = {
  config: any;
};

export type SettingsAppProps = {
  config: any;
  providers: Record<string, ProviderMeta>;
  getApiKey: (config: any, pk: string) => string | null;
  validateKey: (pk: string, raw: string) => { ok: boolean; key?: string; reason?: string };
  saveConfig: (config: any) => void;
  ping: (key: string | null, model: string, url: string) => Promise<{ code: string; ms?: number }>;
  openBrowser?: (url: string) => void;
  initialMode?: "navigate" | "editKey";
  initialProvider?: string;
  onDone: (result: SettingsResult) => void;
};

type Mode = "navigate" | "editKey";

export function SettingsApp({
  config: initialConfig,
  providers,
  getApiKey,
  validateKey,
  saveConfig,
  ping,
  openBrowser,
  initialMode = "navigate",
  initialProvider,
  onDone,
}: SettingsAppProps) {
  const [config, setConfig] = useState(() => JSON.parse(JSON.stringify(initialConfig)));
  const pks = Object.keys(providers);
  const [selectedPk, setSelectedPk] = useState(initialProvider && pks.includes(initialProvider) ? initialProvider : pks[0] || "");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [noticeVariant, setNoticeVariant] = useState<"success" | "error" | "warning">("success");
  const [autoOpenedProviders, setAutoOpenedProviders] = useState<Record<string, boolean>>({});
  const bootstrappedPingsRef = useRef(false);
  const initializedEditModeRef = useRef(false);
  const autoOpenedOnSelectionRef = useRef<string>("");

  const currentMeta = providers[selectedPk];

  const showNotice = useCallback((msg: string, variant: "success" | "error" | "warning" = "success") => {
    setNotice(msg);
    setNoticeVariant(variant);
  }, []);

  const formatPingResult = useCallback((r: { code: string; ms?: number }) => {
    const msPart = Number.isFinite(r?.ms) ? `${r.ms}ms ` : "";
    const ok = r?.code === "200" || r?.code === "401";
    return `${msPart}${r?.code || "ERR"} ${ok ? "\u2713" : "\u2717"}`;
  }, []);

  const runProviderPing = useCallback(
    (pk: string, cfgOverride?: any) => {
      const meta = providers[pk];
      if (!meta) return;
      const cfg = cfgOverride ?? config;
      const apiKey = getApiKey(cfg, pk);
      setTestResults((prev) => ({ ...prev, [pk]: "testing\u2026" }));
      void ping(apiKey, meta.testModel, meta.chatUrl)
        .then((r) => {
          setTestResults((prev) => ({ ...prev, [pk]: formatPingResult(r) }));
        })
        .catch(() => {
          setTestResults((prev) => ({ ...prev, [pk]: "ERR \u2717" }));
        });
    },
    [config, formatPingResult, getApiKey, ping, providers],
  );

  const maybeAutoOpenSignup = useCallback(
    (pk: string, cfgOverride?: any) => {
      const meta = providers[pk];
      if (!meta?.signupUrl || !openBrowser) return;
      if (autoOpenedProviders[pk]) return;
      const cfg = cfgOverride ?? config;
      if (getApiKey(cfg, pk)) return;
      openBrowser(meta.signupUrl);
      setAutoOpenedProviders((prev) => ({ ...prev, [pk]: true }));
      showNotice(`Opened ${meta.name} key page in browser`, "success");
    },
    [autoOpenedProviders, config, getApiKey, openBrowser, providers, showNotice],
  );

  useEffect(() => {
    if (bootstrappedPingsRef.current) return;
    bootstrappedPingsRef.current = true;
    for (const pk of pks) runProviderPing(pk);
  }, [pks, runProviderPing]);

  useEffect(() => {
    if (initializedEditModeRef.current) return;
    initializedEditModeRef.current = true;
    if (initialMode === "editKey" && selectedPk) {
      maybeAutoOpenSignup(selectedPk);
      runProviderPing(selectedPk);
    }
  }, [initialMode, maybeAutoOpenSignup, runProviderPing, selectedPk]);

  useEffect(() => {
    if (!selectedPk || mode !== "navigate") return;
    if (autoOpenedOnSelectionRef.current === selectedPk) return;
    autoOpenedOnSelectionRef.current = selectedPk;
    maybeAutoOpenSignup(selectedPk);
  }, [maybeAutoOpenSignup, mode, selectedPk]);

  // Global key handler
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onDone({ config });
      return;
    }

    // ESC in editKey mode: cancel back to navigate
    if (mode === "editKey" && key.escape) {
      setMode("navigate");
      showNotice("");
      return;
    }

    if (mode !== "navigate") return;

    if (key.escape) {
      saveConfig(config);
      onDone({ config });
      return;
    }

    const lowerInput = input.toLowerCase();

    if (lowerInput === "q") {
      saveConfig(config);
      onDone({ config });
      return;
    }

    if (key.upArrow || lowerInput === "k") {
      moveSelection(-1);
      return;
    }

    if (key.downArrow || lowerInput === "j") {
      moveSelection(1);
      return;
    }

    if (input === " ") {
      // Toggle provider
      const next = { ...config };
      next.providers ??= {};
      next.providers[selectedPk] ??= {};
      next.providers[selectedPk].enabled = !(next.providers[selectedPk].enabled !== false);
      setConfig(next);
      saveConfig(next);
      runProviderPing(selectedPk, next);
      showNotice("");
      return;
    }

    if (lowerInput === "d") {
      // Delete key
      if (config.apiKeys?.[selectedPk]) {
        const next = { ...config };
        delete next.apiKeys[selectedPk];
        setConfig(next);
        saveConfig(next);
        runProviderPing(selectedPk, next);
        showNotice(`Removed ${currentMeta.name} key`, "warning");
      }
      return;
    }

    if (lowerInput === "t") {
      // Test key
      runProviderPing(selectedPk);
      return;
    }

    if (key.return) {
      showNotice("");
      setMode("editKey");
      maybeAutoOpenSignup(selectedPk);
      runProviderPing(selectedPk);
      return;
    }
  });

  const providerOptions = pks.map((pk) => {
    const meta = providers[pk];
    const enabled = config.providers?.[pk]?.enabled !== false;
    const apiKey = getApiKey(config, pk);
    const status = enabled ? "[ON]" : "[OFF]";
    const keyHint = apiKey ? `${apiKey.slice(0, 4)}****` : "(no key)";
    const testHint = testResults[pk] ? ` [${testResults[pk]}]` : "";
    return {
      label: `${status} ${meta.name}  ${keyHint}${testHint}`,
      value: pk,
    };
  });

  function moveSelection(delta: number) {
    if (!pks.length) return;
    const currentIdx = Math.max(0, pks.indexOf(selectedPk));
    const nextIdx = Math.max(0, Math.min(pks.length - 1, currentIdx + delta));
    if (nextIdx !== currentIdx) {
      setSelectedPk(pks[nextIdx]);
    }
  }

  function handleKeySave(value: string) {
    const next = { ...config };
    next.apiKeys ??= {};
    if (value) {
      const checked = validateKey(selectedPk, value);
      if (!checked.ok) {
        showNotice(`Invalid key for ${currentMeta.name}: ${checked.reason}`, "error");
        return;
      }
      next.apiKeys[selectedPk] = checked.key;
      showNotice(`Saved ${currentMeta.name} key`, "success");
    } else {
      delete next.apiKeys[selectedPk];
      showNotice(`Removed ${currentMeta.name} key`, "warning");
    }
    setConfig(next);
    saveConfig(next);
    runProviderPing(selectedPk, next);
    setMode("navigate");
  }

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold inverse> frouter Settings </Text>
      <Text dimColor>{"\n"}  {"\u2191\u2193"}:navigate  Enter:edit key  Space:toggle  T:test  D:delete  ESC/Q:back</Text>

      <Box marginTop={1} flexDirection="column">
        {mode === "navigate" && (
          <Select
            options={providerOptions}
            defaultValue={selectedPk}
            onChange={(val) => setSelectedPk(val)}
          />
        )}

        {mode === "editKey" && (
          <Box flexDirection="column">
            {currentMeta.signupUrl && (
              <Text>
                <Text dimColor>Get a key at: </Text>
                <Text color="cyan">{currentMeta.signupUrl}</Text>
              </Text>
            )}
            <Text>Enter API key for <Text bold>{currentMeta.name}</Text>:</Text>
            <PasswordInput
              placeholder={currentMeta.keyPrefix ? `${currentMeta.keyPrefix}...` : "paste key here"}
              onSubmit={handleKeySave}
            />
            <Text dimColor>Enter to save, Esc to cancel</Text>
          </Box>
        )}
      </Box>

      {notice && (
        <Box marginTop={1}>
          <StatusMessage variant={noticeVariant}>{notice}</StatusMessage>
        </Box>
      )}
    </Box>
  );
}
