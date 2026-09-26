import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { messageFor } from "../api";
import { UnlockCancelled } from "../auth/unlock";
import { IS_MOCK, IS_TESTNET } from "../config";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Mascot } from "../ui/Mascot";
import { Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { space } from "../ui/theme";

export default function Welcome() {
  const { logIn, pendingClaim } = useSession();
  const [error, setError] = useState<string | null>(null);

  const onLogIn = async () => {
    setError(null);
    try {
      await logIn();
      router.replace("/");
    } catch (e) {
      if (!(e instanceof UnlockCancelled)) setError(messageFor(e));
    }
  };

  return (
    <Screen
      edges={["top", "bottom"]}
      footer={
        <>
          <Button label="Get started" onPress={() => router.push({ pathname: "/phone", params: { purpose: pendingClaim ? "claim" : "onboard", code: pendingClaim ?? "" } })} />
          <Button variant="ghost" label="I already have an account" onPress={onLogIn} />
        </>
      }
    >
      <View style={styles.hero}>
        <Mascot size={200} />
        <Text variant="display" style={styles.center}>
          Send dollars to any phone number
        </Text>
        <Muted style={styles.center}>Friends get it in seconds, even if they don't have BilbyPay yet. No fees, no forms.</Muted>
      </View>
      {pendingClaim ? <Notice tone="success" title="Someone sent you something" message="Set up BilbyPay in under a minute to open it." /> : null}
      {IS_MOCK ? <Notice tone="info" title="Demo mode" message="Nothing real moves. Use the code 000000 when asked." /> : null}
      {!IS_MOCK && IS_TESTNET ? <Notice tone="info" title="Test mode" message="Test money only. Use the code 000000 when asked." /> : null}
      {error ? <Notice tone="danger" message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: "center", gap: space.lg, paddingTop: space.xxl },
  center: { textAlign: "center" },
});
