import { StyleSheet, View } from "react-native";
import { isApiError, messageFor } from "../api";
import { Button } from "./Button";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

type Tone = "info" | "warning" | "danger" | "success";

const tones: Record<Tone, { bg: string; fg: string; border: string }> = {
  info: { bg: colors.blueSoft, fg: colors.ink, border: colors.blueSoft },
  warning: { bg: colors.goldSoft, fg: colors.ink, border: colors.gold },
  danger: { bg: colors.redSoft, fg: colors.red, border: colors.red },
  success: { bg: colors.greenSoft, fg: colors.green, border: colors.greenSoft },
};

export function Notice({ tone = "info", title, message, action }: { tone?: Tone; title?: string; message: string; action?: { label: string; onPress: () => unknown } }) {
  const t = tones[tone];
  return (
    <View accessibilityRole="alert" style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }]}>
      {title ? (
        <Text variant="bodyStrong" color={t.fg}>
          {title}
        </Text>
      ) : null}
      <Text variant="small" color={tone === "danger" ? colors.ink : t.fg}>
        {message}
      </Text>
      {action ? <Button compact variant="secondary" label={action.label} onPress={action.onPress} style={{ alignSelf: "flex-start" }} /> : null}
    </View>
  );
}

/** Any thrown error → a sentence with a next step; offline gets its own look and a retry. */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => unknown }) {
  if (!error) return null;
  const offline = isApiError(error) && error.code === "NETWORK";
  return (
    <Notice
      tone={offline ? "warning" : "danger"}
      title={offline ? "No connection" : undefined}
      message={messageFor(error)}
      action={onRetry ? { label: "Try again", onPress: onRetry } : undefined}
    />
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: space.lg, gap: space.sm, borderWidth: 1 },
});
