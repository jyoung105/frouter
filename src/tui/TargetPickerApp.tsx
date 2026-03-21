// src/tui/TargetPickerApp.tsx — Ink-based target picker with Select.
// Uses ink-harness (runs mid-session from ALT_ON state).
// Pure UI component — returns user's selection; business logic lives in frouter.ts.

import { useState } from "react";
import { Text, Box, useInput } from "ink";
import { Select, StatusMessage } from "@inkjs/ui";

type Target = { id: string; label: string; path: string; enabled: boolean };

export type TargetPickerResult =
  | { action: "cancelled" }
  | { action: "selected"; targetId: string; launch: boolean };

export type TargetPickerAppProps = {
  modelName: string;
  modelFullId: string;
  targets: Target[];
  onDone: (result: TargetPickerResult) => void;
};

type Phase = "selectTarget" | "selectAction";

export function TargetPickerApp({
  modelName,
  modelFullId,
  targets,
  onDone,
}: TargetPickerAppProps) {
  const [phase, setPhase] = useState<Phase>("selectTarget");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [notice, setNotice] = useState<{ message: string; variant: "success" | "error" | "warning" } | null>(null);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      onDone({ action: "cancelled" });
      return;
    }
    if (key.escape) {
      onDone({ action: "cancelled" });
      return;
    }
  });

  const targetOptions = targets.map((t) => ({
    label: `${t.label}  ${t.enabled ? "[enabled]" : "[disabled]"}  ${t.path}`,
    value: t.id,
  }));

  const actionOptions = [
    { label: "Save + Launch opencode", value: "launch" },
    { label: "Save only", value: "save" },
    { label: "Cancel", value: "cancel" },
  ];

  if (phase === "selectTarget") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text bold inverse> Configure: {modelName} </Text>
        <Text dimColor>  {modelFullId}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Select target:</Text>
          <Select
            options={targetOptions}
            onChange={(val) => {
              const target = targets.find((t) => t.id === val);
              setSelectedTarget(val);
              if (target && !target.enabled) {
                setNotice({ message: `${target.label} is currently disabled.`, variant: "warning" });
              } else {
                setNotice(null);
                setPhase("selectAction");
              }
            }}
          />
        </Box>
        {notice && (
          <Box marginTop={1}>
            <StatusMessage variant={notice.variant}>{notice.message}</StatusMessage>
          </Box>
        )}
      </Box>
    );
  }

  // phase === "selectAction"
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold inverse> Configure: {modelName} </Text>
      <Text dimColor>  {modelFullId}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Choose action:</Text>
        <Select
          options={actionOptions}
          onChange={(val) => {
            if (val === "cancel") {
              onDone({ action: "cancelled" });
            } else {
              onDone({ action: "selected", targetId: selectedTarget, launch: val === "launch" });
            }
          }}
        />
      </Box>
      {notice && (
        <Box marginTop={1}>
          <StatusMessage variant={notice.variant}>{notice.message}</StatusMessage>
        </Box>
      )}
    </Box>
  );
}
