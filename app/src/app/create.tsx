import { router } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, TextInput } from "react-native";
import { isApiError, messageFor } from "../api";
import { UnlockCancelled } from "../auth/unlock";
import { formatE164 } from "../phone/phone";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { BIOMETRIC } from "../ui/biometric";
import { Mascot } from "../ui/Mascot";
import { Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

/** Name + passkey. For an account that exists but has no number yet, it just links the number. */
export default function CreateScreen() {
  const { status, profile, verification, freshVerification, createAccount, linkNumber } = useSession();
  const existing = status === "needsPhone" || status === "ready";
  const [name, setName] = useState(profile?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reverify, setReverify] = useState(false);

  const go = async () => {
    setError(null);
    setReverify(false);
    try {
      if (existing) await linkNumber(name);
      else await createAccount(name);
      router.replace("/");
    } catch (e) {
      if (e instanceof UnlockCancelled) return;
      setError(messageFor(e));
      // OTP_EXPIRED from the server, or our own "code expired" (no fresh verification in memory).
      setReverify((isApiError(e) && e.code === "OTP_EXPIRED") || !freshVerification());
    }
  };

  return (
    <Screen
      footer={
        <Button
          label={existing ? `Confirm with ${BIOMETRIC}` : `Create your account with ${BIOMETRIC}`}
          busyLabel="One moment…"
          disabled={name.trim().length < 1}
          onPress={go}
        />
      }
    >
      <Mascot size={120} />
      <Text variant="title">{existing ? "Almost there" : "What should friends see?"}</Text>
      <TextInput
        accessibilityLabel="Your name"
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={colors.muted}
        textContentType="name"
        autoComplete="name"
        autoCapitalize="words"
        style={styles.input}
        maxLength={40}
      />
      {verification ? <Muted>Your number: {formatE164(verification.phone)}</Muted> : null}
      <Notice
        tone="info"
        title={`${Platform.OS === "ios" ? "Face ID" : "Fingerprint"} instead of a password`}
        message="BilbyPay uses a passkey saved to your phone. There's no password to forget and nothing to write down. Every payment asks for your face or fingerprint."
      />
      {error ? (
        <Notice
          tone="danger"
          message={error}
          action={reverify ? { label: "Verify my number again", onPress: () => router.dismissTo("/phone") } : undefined}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 56, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 20, color: colors.ink },
});
