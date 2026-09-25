import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { messageFor } from "../api";
import { UnlockCancelled } from "../auth/unlock";
import { useSession } from "../state/session";
import { BIOMETRIC } from "../ui/biometric";
import { Button } from "../ui/Button";
import { Mascot } from "../ui/Mascot";
import { Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { space } from "../ui/theme";

/** The session ran out (or a reinstall kept the account id): one Face ID to carry on. */
export default function Unlock() {
  const { unlock, logOut, profile } = useSession();
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    try {
      await unlock();
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
          <Button label={`Unlock with ${BIOMETRIC}`} onPress={go} />
          <Button
            variant="ghost"
            label="Use a different account"
            onPress={async () => {
              await logOut();
              router.replace("/welcome");
            }}
          />
        </>
      }
    >
      <View style={styles.hero}>
        <Mascot size={180} />
        <Text variant="title" style={styles.center}>
          Welcome back{profile ? `, ${profile.displayName.split(" ")[0]}` : ""}
        </Text>
        <Muted style={styles.center}>For your safety, BilbyPay asks for {BIOMETRIC} every so often.</Muted>
      </View>
      {error ? <Notice tone="danger" message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: "center", gap: space.lg },
  center: { textAlign: "center" },
});
