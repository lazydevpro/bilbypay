import { getLocales } from "expo-localization";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api } from "../api";
import { initialPhoneInput, formatAsYouType, type PhonePurpose, toE164 } from "../phone/phone";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { CountryButton, CountryPicker } from "../ui/CountryPicker";
import { ErrorNote } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

const TITLES: Record<PhonePurpose, { title: string; body: string }> = {
  onboard: { title: "What's your number?", body: "Friends send you money using it. We'll text you a code to check it's yours." },
  claim: { title: "Check it's your number", body: "We'll text you a code so we know this is meant for you." },
  change: { title: "Your new number", body: "We'll text a code to your new number, then show you the details before linking it." },
  renew: { title: "Keep your number current", body: "Verify that you still use this number so friends can keep paying you." },
};

function defaultRegion(): string {
  try {
    return getLocales()[0]?.regionCode ?? "US";
  } catch {
    return "US";
  }
}

export default function PhoneScreen() {
  const params = useLocalSearchParams<{ purpose?: PhonePurpose; code?: string; phone?: string }>();
  const purpose: PhonePurpose = params.purpose ?? "onboard";
  const { setVerification } = useSession();
  const [initial] = useState(() => initialPhoneInput(params.phone, defaultRegion()));
  const [country, setCountry] = useState(initial.country);
  const [picking, setPicking] = useState(false);
  const [input, setInput] = useState(initial.input);
  const [error, setError] = useState<unknown>(null);

  const e164 = toE164(input, country.code);
  const copy = TITLES[purpose];

  const next = async () => {
    if (!e164) return;
    setError(null);
    setVerification(null);
    try {
      await api.otpStart(e164, country.code);
      router.push({ pathname: "/code", params: { phone: e164, region: country.code, purpose, code: params.code ?? "" } });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Screen footer={<Button label="Text me a code" disabled={!e164} onPress={next} />}>
      <Text variant="title">{copy.title}</Text>
      <Muted>{copy.body}</Muted>
      <View style={styles.row}>
        <CountryButton country={country} onPress={() => setPicking(true)} />
        <TextInput
          accessibilityLabel="Phone number"
          value={input}
          onChangeText={(t) => setInput(formatAsYouType(t, country.code))}
          placeholder="Phone number"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          autoFocus
          style={styles.input}
          onSubmitEditing={next}
        />
      </View>
      {input.length > 6 && !e164 ? <Muted variant="small">That doesn&apos;t look like a full number yet.</Muted> : null}
      <ErrorNote error={error} />
      <CountryPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(c) => {
          setCountry(c);
          setPicking(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  input: { flex: 1, minHeight: 56, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 20, color: colors.ink },
});
