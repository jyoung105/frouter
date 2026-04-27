import { useState, type ReactNode } from "react";
import { Text, Box, useInput } from "ink";
import { useMountEffect } from "./useMountEffect.js";

type SelectOption = { label: string; value: string };

export function Select({
  options,
  onChange,
}: {
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [idx, setIdx] = useState(0);

  useInput((input, key) => {
    if (options.length === 0) return;
    if (key.upArrow || (key.ctrl && input === "p")) {
      setIdx((i) => (i - 1 + options.length) % options.length);
    } else if (key.downArrow || (key.ctrl && input === "n")) {
      setIdx((i) => (i + 1) % options.length);
    } else if (key.return) {
      const safeIdx = Math.min(idx, options.length - 1);
      onChange(options[safeIdx].value);
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((opt, i) => (
        <Text key={opt.value} color={i === idx ? "cyan" : undefined}>
          {i === idx ? "❯ " : "  "}
          {opt.label}
        </Text>
      ))}
    </Box>
  );
}

export function PasswordInput({
  placeholder,
  onSubmit,
}: {
  placeholder?: string;
  onSubmit: (value: string) => void;
}) {
  const [buf, setBuf] = useState("");

  useInput((input, key) => {
    if (key.return) {
      onSubmit(buf);
      return;
    }
    if (key.escape) {
      onSubmit("");
      return;
    }
    if (key.backspace || key.delete) {
      setBuf((b) => b.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta) return;
    if (!input) return;
    if (input.length === 1 && input < " ") return;
    setBuf((b) => b + input);
  });

  if (buf) {
    return <Text color="cyan">{"•".repeat(buf.length)}</Text>;
  }
  return <Text dimColor>{placeholder ?? ""}</Text>;
}

type StatusVariant = "success" | "error" | "warning" | "info";

export function StatusMessage({
  variant,
  children,
}: {
  variant: StatusVariant;
  children: ReactNode;
}) {
  const color =
    variant === "success"
      ? "green"
      : variant === "error"
        ? "red"
        : variant === "warning"
          ? "yellow"
          : "blue";
  const icon =
    variant === "success"
      ? "✓"
      : variant === "error"
        ? "✗"
        : variant === "warning"
          ? "!"
          : "i";
  return (
    <Text color={color}>
      {icon} {children}
    </Text>
  );
}

export function ConfirmInput({
  defaultChoice = "confirm",
  onConfirm,
  onCancel,
}: {
  defaultChoice?: "confirm" | "cancel";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useInput((input, key) => {
    if (key.return) {
      if (defaultChoice === "confirm") onConfirm();
      else onCancel();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    const ch = input.toLowerCase();
    if (ch === "y") onConfirm();
    else if (ch === "n") onCancel();
  });

  const hint = defaultChoice === "confirm" ? "[Y/n]" : "[y/N]";
  return <Text dimColor>{hint}</Text>;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label }: { label?: string }) {
  const [frame, setFrame] = useState(0);
  useMountEffect(() => {
    const t = setInterval(
      () => setFrame((i) => (i + 1) % SPINNER_FRAMES.length),
      80,
    );
    return () => clearInterval(t);
  });
  return (
    <Text>
      <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>
      {label ? <Text> {label}</Text> : null}
    </Text>
  );
}

export function ProgressBar({
  value,
  width = 24,
}: {
  value: number;
  width?: number;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const filled = Math.round((pct / 100) * width);
  return (
    <Box>
      <Text color="green">{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(Math.max(0, width - filled))}</Text>
    </Box>
  );
}
