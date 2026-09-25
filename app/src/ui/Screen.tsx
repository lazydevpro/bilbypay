import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, type RefreshControlProps, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors, space } from "./theme";

type Props = {
  children: ReactNode;
  /** Pinned to the bottom (primary action). */
  footer?: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  edges?: Edge[];
  padded?: boolean;
};

export function Screen({ children, footer, scroll = true, refreshControl, edges = ["bottom"], padded = true }: Props) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, padded && styles.padded]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, padded && styles.padded]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.fill} edges={edges}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {body}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, gap: space.lg },
  padded: { padding: space.xl },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, gap: space.sm, backgroundColor: colors.bg },
});
