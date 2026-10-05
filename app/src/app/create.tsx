import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import type { DirectoryConsent } from "../api/types";
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
  const { status, profile, verification, freshVerification, prepareNumber, confirmNumber } = useSession();
  const existing = status === "needsPhone" || status === "ready" || status === "pendingPhone";
  const [prepared, setPrepared] = useState<DirectoryConsent | null>(null);
  const [name, setName] = useState(profile?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [reverify, setReverify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);

  const go = async () => {
    setError(null);
    setReverify(false);
    setBusy(true);
    try {
      if (!prepared) {
        setPrepared(await prepareNumber(name));
        return;
      }
      const result = await confirmNumber(prepared, name);
      router.replace(result.status === "pending" ? "/settings/phone" : "/");
    } catch (e) {
      if (e instanceof UnlockCancelled) return;
      setPrepared(null);
      setError(messageFor(e));
      // OTP_EXPIRED from the server, or our own "code expired" (no fresh verification in memory).
      setReverify((isApiError(e) && e.code === "OTP_EXPIRED") || !freshVerification());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          label={prepared ? (prepared.operation === "requestRecovery" ? `Start the waiting period with ${BIOMETRIC}` : `Link my number with ${BIOMETRIC}`) : existing ? "Review number link" : `Create your account with ${BIOMETRIC}`}
          busyLabel="One moment…"
          disabled={name.trim().length < 1}
          onPress={go}
        />
      }
    >
      <View style={styles.intro}>
        <Text variant="display">{existing ? "Almost there" : "Let's make it yours"}</Text>
        <Muted>This is the name your friends will see.</Muted>
        <View style={styles.nameCard}>
          <View style={{ flex: 1, gap: space.xs }}><Text variant="caption" color={colors.primary}>HELLO, I’M</Text><Text variant="title" numberOfLines={2}>{name.trim() || "Your name"}</Text></View>
          <Mascot size={114} mood={busy ? "thinking" : error ? "reassuring" : focused ? "attentive" : "welcome"} interactive={!busy} />
        </View>
      </View>
      <TextInput
        accessibilityLabel="Your name"
        value={name}
        onChangeText={value => { setName(value); setPrepared(null); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!busy}
        placeholder="Your name"
        placeholderTextColor={colors.muted}
        textContentType="name"
        autoComplete="name"
        autoCapitalize="words"
        style={styles.input}
        maxLength={40}
      />
      {verification ? <Muted>Your number: {formatE164(verification.phone)}</Muted> : null}
      {prepared ? <Notice tone="info" title={prepared.operation === "requestRecovery" ? "This number is linked elsewhere" : "Let friends find you"} message={prepared.operation === "requestRecovery" ? "Start a 7-day waiting period to link this number to your account. You will need to verify the number again afterward. This gives you no access to the other account or its money." : "Confirm that payments to this number should reach this account. Your display name is chosen by you; it is not a verified identity."} /> : null}
      <Notice
        tone="info"
        title="Your phone protects your account"
        message="Use your phone's screen lock to confirm it's you when you pay. No password to remember."
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
  intro: { gap: space.sm, paddingBottom: space.md },
  nameCard: { flexDirection: "row", alignItems: "center", gap: space.md, paddingLeft: space.xl, paddingRight: space.sm, backgroundColor: colors.primarySoft, borderRadius: radius.lg, marginTop: space.md, borderWidth: 1, borderColor: "#D3DFF8" },
  input: { minHeight: 60, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 20, color: colors.ink },
});
