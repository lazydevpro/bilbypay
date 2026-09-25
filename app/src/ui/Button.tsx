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
  primary: { bg: colors.brown, fg: colors.white },
  secondary: { bg: colors.sand, fg: colors.brown },
  ghost: { bg: "transparent", fg: colors.brown },
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
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy }}
      onPress={handle}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: p.bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={p.fg} /> : icon}
        <Text variant="bodyStrong" color={p.fg} numberOfLines={1}>
          {busy && busyLabel ? busyLabel : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: TAP, borderRadius: radius.pill, paddingHorizontal: space.xl, justifyContent: "center", alignItems: "center" },
  compact: { minHeight: 44, paddingHorizontal: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
