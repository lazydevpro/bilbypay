import { router } from "expo-router";
import { RefreshControl } from "react-native";
import { api } from "../../api";
import { CHOICE_ID } from "../../flows/drafts";
import { useLoad } from "../../state/useLoad";
import { BrandLogo } from "../../ui/Avatar";
import { BrandGrid } from "../../ui/BrandGrid";
import { Card } from "../../ui/Card";
import { ErrorNote } from "../../ui/Notice";
import { Row } from "../../ui/Row";
import { Screen } from "../../ui/Screen";
import { Muted } from "../../ui/Text";
import { colors } from "../../ui/theme";

export default function Catalog() {
  const { data, error, refreshing, refresh, reload } = useLoad(() => api.catalog());

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brown} />}>
      <Muted>Send a gift card to any phone number, or buy one for yourself. The price you see is the price you pay.</Muted>
      <Card tone="sand">
        <Row
          leading={<BrandLogo name="🎁" size={48} />}
          title="Let them choose"
          subtitle="They pick the brand when they open it"
          onPress={() => router.push(`/gifts/${CHOICE_ID}`)}
        />
      </Card>
      <ErrorNote error={error} onRetry={reload} />
      {data ? <BrandGrid brands={data.brands} onPick={(b) => router.push(`/gifts/${b.id}`)} /> : null}
    </Screen>
  );
}
