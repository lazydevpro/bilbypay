import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { colors, radius, space, TAP } from "./theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = {
  label: string;
  /** May return a promise; the button stays disabled until it settles, so a double tap never runs twice. */
  onPress: () => unknown;
  variant?: Variant;
  disabled?: boolean;
  /** Shown instead of `label` while the press is running. */
  busyLabel?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  accessibilityHint?: string;
};

const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primaryDeep },
  secondary: { bg: colors.surface, fg: colors.ink, border: colors.line },
  ghost: { bg: "transparent", fg: colors.ink },
  danger: { bg: colors.redSoft, fg: colors.red },
};

export function Button({ label, onPress, variant = "primary", disabled, busyLabel, icon, style, compact, accessibilityHint }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const p = palette[variant];
  const inactive = disabled || busy;

  const handle = async () => {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    try {
      await onPress();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy && busyLabel ? busyLabel : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy }}
      onPress={handle}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: p.bg, opacity: inactive ? 0.55 : 1, borderColor: p.border ?? "transparent", borderWidth: variant === "secondary" ? 1 : 0,
          borderBottomWidth: p.border ? (pressed ? 1 : 4) : 0, transform: [{ translateY: pressed && !inactive ? 3 : 0 }] },
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={p.fg} /> : icon}
        <Text variant="bodyStrong" color={p.fg} style={styles.label}>
          {busy && busyLabel ? busyLabel : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: TAP + 4, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md, justifyContent: "center", alignItems: "center" },
  compact: { minHeight: 44, paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  label: { textAlign: "center", flexShrink: 1 },
});
