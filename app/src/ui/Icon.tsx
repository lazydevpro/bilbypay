import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName = "home" | "activity" | "gift" | "settings" | "send" | "receive" | "burrow" | "contacts" | "copy" | "share" | "check" | "chevron" | "close";

/** A handful of simple line icons, drawn here to avoid an icon font dependency. */
export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string }) {
  const p = { stroke: color, strokeWidth: 2, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "home" && <Path {...p} d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />}
      {name === "activity" && <Path {...p} d="M4 6h16M4 12h16M4 18h10" />}
      {name === "gift" && (
        <>
          <Rect {...p} x="3" y="8" width="18" height="13" rx="2" />
          <Path {...p} d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z" />
        </>
      )}
      {name === "settings" && (
        <>
          <Circle {...p} cx="12" cy="12" r="3" />
          <Path {...p} d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
        </>
      )}
      {name === "send" && <Path {...p} d="M12 19V5M5 12l7-7 7 7" />}
      {name === "receive" && <Path {...p} d="M12 5v14M5 12l7 7 7-7" />}
      {name === "burrow" && <Path {...p} d="M3 18c0-5 4-9 9-9s9 4 9 9M7 18a5 5 0 0 1 10 0M3 18h18" />}
      {name === "contacts" && (
        <>
          <Circle {...p} cx="12" cy="8" r="4" />
          <Path {...p} d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </>
      )}
      {name === "copy" && (
        <>
          <Rect {...p} x="8" y="8" width="13" height="13" rx="2" />
          <Path {...p} d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
        </>
      )}
      {name === "share" && <Path {...p} d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />}
      {name === "check" && <Path {...p} d="M5 12l5 5 9-10" />}
      {name === "chevron" && <Path {...p} d="M9 6l6 6-6 6" />}
      {name === "close" && <Path {...p} d="M6 6l12 12M18 6L6 18" />}
    </Svg>
  );
}
