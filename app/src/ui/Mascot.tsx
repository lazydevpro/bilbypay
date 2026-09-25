import { Image, StyleSheet, View } from "react-native";
import { colors } from "./theme";

const bilby = require("../../assets/bilby.webp");

/** The Bilby, on a soft round backdrop (the art has a white background). */
export function Mascot({ size = 160 }: { size?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Bilby, the BilbyPay mascot"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Image source={bilby} style={{ width: size * 0.86, height: size * 0.86 }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.white, alignItems: "center", justifyContent: "center", alignSelf: "center", overflow: "hidden" },
});
