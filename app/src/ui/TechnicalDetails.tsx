// glossary-allow-file — spec §3a: the collapsed "technical details" row is the one place this may appear.
import { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import type { Receipt } from "../api/types";
import { Text } from "./Text";
import { colors, space } from "./theme";

export function TechnicalDetails({ technical }: { technical?: Receipt["technical"] }) {
  const [open, setOpen] = useState(false);
  if (!technical) return null;
  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} style={styles.header}>
        <Text variant="small" color={colors.muted}>
          Technical details
        </Text>
        <Text variant="small" color={colors.muted}>
          {open ? "Hide" : "Show"}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <Text variant="caption" color={colors.muted}>
            Network record
          </Text>
          <Text variant="caption" selectable style={styles.mono}>
            {technical.txHash}
          </Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(technical.explorerUrl)}>
            <Text variant="small" color={colors.blue}>
              View public record
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line, paddingTop: space.md },
  header: { flexDirection: "row", justifyContent: "space-between", minHeight: 44, alignItems: "center" },
  body: { gap: space.xs },
  mono: { fontFamily: "Menlo" },
});
