import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { api, messageFor } from "../api";
import { UnlockCancelled } from "../auth/unlock";
import { IS_MOCK } from "../config";
import { formatE164, type PhonePurpose } from "../phone/phone";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { ErrorNote, Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

const RESEND_AFTER = 30;

export default function CodeScreen() {
  const { phone = "", region, purpose = "onboard", code: claimCode } = useLocalSearchParams<{
    phone: string;
    region?: string;
    purpose?: PhonePurpose;
    code?: string;
  }>();
  const { setVerification, status, linkNumber } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [wait, setWait] = useState(RESEND_AFTER);
  const submitting = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setWait((w) => (w > 0 ? w - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const verify = async (value: string) => {
    if (submitting.current || value.length !== 6) return;
    submitting.current = true;
    setError(null);
    try {
      const v = await api.otpVerify(phone, value);
      setVerification(v);
      if (purpose === "claim" && claimCode && status === "ready") {
        router.dismissTo(`/claim/${claimCode}`);
      } else if (purpose === "change") {
        await linkNumber();
        router.dismissTo("/(tabs)/settings");
      } else {
        // New person, or an account that has no number yet (needsPhone).
        router.push("/create");
      }
    } catch (e) {
      if (!(e instanceof UnlockCancelled)) setError(e);
      setCode("");
    } finally {
      submitting.current = false;
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await api.otpStart(phone, region);
      setWait(RESEND_AFTER);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button label="Continue" disabled={code.length !== 6} onPress={() => verify(code)} />
          <Button variant="ghost" label={wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"} disabled={wait > 0} onPress={resend} />
        </>
      }
    >
      <Text variant="title">Enter the code</Text>
      <Muted>We texted a 6-digit code to {formatE164(phone)}.</Muted>
      <TextInput
        accessibilityLabel="6-digit code"
        value={code}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void verify(digits);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus
        maxLength={6}
        style={styles.input}
        placeholder="••••••"
        placeholderTextColor={colors.sandDeep}
      />
      {IS_MOCK ? <Notice message="Demo mode: the code is 000000." /> : null}
      {error ? <ErrorNote error={error} /> : null}
      {error && messageFor(error).includes("expired") ? (
        <Button variant="secondary" label="Change number" onPress={() => router.back()} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    marginTop: space.md,
    minHeight: 64,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    fontSize: 32,
    letterSpacing: 12,
    textAlign: "center",
    color: colors.ink,
    fontWeight: "700",
  },
});
