import { StyleSheet, View } from "react-native";
import Svg, { Ellipse, Path } from "react-native-svg";
import { Mascot } from "./Mascot";

/** The approved saving pose includes its plant. This background never represents financial progress. */
export function BurrowGarden({ reassuring = false }: { reassuring?: boolean }) {
  return (
    <View style={styles.garden}>
      <Svg width="100%" height="100%" viewBox="0 0 180 156" aria-hidden>
        <Path d="M35 132C9 102 28 48 84 40C124 12 171 41 170 84C184 129 103 159 35 132Z" fill="#E5E9D2" />
        <Ellipse cx="95" cy="145" rx="64" ry="6" fill="#B9C49A" opacity={0.25} />
      </Svg>
      <View style={styles.bilby}>
        <Mascot size={152} mood={reassuring ? "reassuring" : "saving"} accessibilityLabel={reassuring ? "Bilby is here to help" : "Bilby tending a little plant"} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  garden: { width: 158, height: 158, flexShrink: 0 },
  bilby: { position: "absolute", bottom: 0, left: 3 },
});
