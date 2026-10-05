import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { messageFor } from "../api";
import { UnlockCancelled } from "../auth/unlock";
import { IS_MOCK, IS_TESTNET } from "../config";
import { useSession } from "../state/session";
import { EntryScene } from "../ui/EntryScene";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, space } from "../ui/theme";

export default function Welcome() {
  const { logIn, pendingClaim } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onLogIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await logIn();
      router.replace("/");
    } catch (e) {
      if (!(e instanceof UnlockCancelled)) setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      edges={["top", "bottom"]}
      footer={
        <>
          <Button label="Get started" disabled={busy} onPress={() => router.push({ pathname: "/phone", params: { purpose: pendingClaim ? "claim" : "onboard", code: pendingClaim ?? "" } })} />
          <Button variant="ghost" label="I already have an account" busyLabel="Opening your account…" onPress={onLogIn} />
        </>
      }
    >
      <View style={styles.brand}>
        <Text variant="title" style={styles.wordmark}>bilbypay</Text>
        <Text variant="caption" color={colors.muted}>Hello, friend.</Text>
      </View>
      <View style={styles.hero}>
        <EntryScene mood={busy ? "thinking" : error ? "reassuring" : "welcome"} interactive={!busy} />
        <View style={styles.words}>
          <Text variant="display">A little joy.{"\n"}Every payment.</Text>
          <Muted>Send money to a phone number. Share a thoughtful gift. Make someone&apos;s day.</Muted>
        </View>
      </View>
      {pendingClaim ? <Notice tone="success" title="Someone sent you something" message="Set up BilbyPay to open it." /> : null}
      {IS_MOCK ? <Notice tone="info" title="Demo mode" message="Nothing real moves. Use the code 000000 when asked." /> : null}
      {!IS_MOCK && IS_TESTNET ? <Notice tone="info" title="Test mode" message="Test money only. Use the code 000000 when asked." /> : null}
      {error ? <Notice tone="danger" message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  wordmark: { letterSpacing: -1 },
  hero: { flex: 1, justifyContent: "center", gap: space.xl, paddingBottom: space.sm },
  words: { gap: space.md },
});
