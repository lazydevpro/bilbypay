import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { messageFor } from "../api";
import { UnlockCancelled } from "../auth/unlock";
import { fundingReturnId } from "../auth/route";
import { firstName } from "../flows/drafts";
import { useSession } from "../state/session";
import { EntryScene } from "../ui/EntryScene";
import { BIOMETRIC } from "../ui/biometric";
import { Button } from "../ui/Button";
import { Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { space } from "../ui/theme";

/** The session ran out (or a reinstall kept the account id): one Face ID to carry on. */
export default function Unlock() {
  const { unlock, logOut, profile } = useSession();
  const { funding } = useLocalSearchParams<{ funding?: string }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      await unlock();
      const id = fundingReturnId(funding);
      router.replace(id ? { pathname: "/funding", params: { id } } : "/");
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
          <Button label={`Unlock with ${BIOMETRIC}`} busyLabel="Opening your account…" onPress={go} />
          <Button
            variant="ghost"
            label="Use a different account"
            disabled={busy}
            onPress={async () => {
              await logOut();
              router.replace("/welcome");
            }}
          />
        </>
      }
    >
      <View style={styles.hero}>
        <EntryScene resting mood={busy ? "thinking" : error ? "reassuring" : "sleepy"} />
        <Text variant="title" style={styles.center}>
          Welcome back{profile ? `, ${firstName(profile.displayName)}` : ""}
        </Text>
        <Muted style={styles.center}>Bilby&apos;s kept your spot. Unlock your account to pick up where you left off.</Muted>
      </View>
      {error ? <Notice tone="danger" message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: "center", gap: space.lg },
  center: { textAlign: "center" },
});
