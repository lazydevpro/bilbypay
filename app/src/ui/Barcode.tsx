import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Rect } from "react-native-svg";
import { code128Widths } from "../barcode/code128";
import { Text } from "./Text";
import { colors } from "./theme";

/** Renders a gift card barcode from `{ format, value }`: QR for QR formats, Code 128 for the rest. */
export function Barcode({ format, value, width = 300 }: { format: string; value: string; width?: number }) {
  if (/qr/i.test(format)) {
    return (
      <View accessibilityLabel="Gift card QR code" style={{ alignSelf: "center", padding: 12, backgroundColor: colors.white, borderRadius: 12 }}>
        <QRCode value={value} size={Math.min(width, 220)} />
      </View>
    );
  }
  let widths: number[];
  try {
    widths = code128Widths(value);
  } catch {
    return <Text selectable>{value}</Text>;
  }
  const quiet = 10;
  const modules = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const unit = width / modules;
  let x = quiet * unit;
  const bars = widths.map((w, i) => {
    const rect = i % 2 === 0 ? <Rect key={i} x={x} y={0} width={w * unit} height={90} fill={colors.ink} /> : null;
    x += w * unit;
    return rect;
  });
  return (
    <View accessibilityLabel="Gift card barcode" style={{ alignSelf: "center", backgroundColor: colors.white, borderRadius: 12, paddingVertical: 12 }}>
      <Svg width={width} height={90}>
        {bars}
      </Svg>
      <Text variant="caption" color={colors.muted} style={{ textAlign: "center", marginTop: 6 }} selectable>
        {value}
      </Text>
    </View>
  );
}
