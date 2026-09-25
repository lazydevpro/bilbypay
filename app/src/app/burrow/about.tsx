import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { saveBurrowAck } from "../../auth/keyStore";
import { BURROW_DISCLOSURE } from "../../copy/burrow";
import { Button } from "../../ui/Button";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { space } from "../../ui/theme";

/** The disclosure sheet. Shown before the first Add / auto-save, and any time from Burrow or Settings. */
export default function BurrowAbout() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  return (
    <Screen
      footer={
        <Button
          label={next ? "I understand, continue" : "Got it"}
          onPress={async () => {
            await saveBurrowAck();
            router.back();
            if (next) router.push(next);
          }}
        />
      }
    >
      {BURROW_DISCLOSURE.map((d) => (
        <View key={d.title} style={{ gap: space.xs }}>
          <Text variant="heading">{d.title}</Text>
          <Muted>{d.body}</Muted>
        </View>
      ))}
    </Screen>
  );
}
