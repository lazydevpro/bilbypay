import { Image, Platform, type ImageSourcePropType } from "react-native";
import { assetSourceKey, assetSourceUri, createAssetPrefetcher } from "./assetCache";
import type { MascotMood } from "./motion";
import { SPRITES } from "./sprites";

const prefetchUri = createAssetPrefetcher((uri) => Image.prefetch(uri));

export function mascotAssetKey(source: ImageSourcePropType): string {
  return assetSourceKey(source, Image.resolveAssetSource);
}

/** Warm the next action while its review page is open; never await this before a payment. */
export async function prefetchMascot(mood: MascotMood): Promise<void> {
  const sprite = SPRITES[mood];
  if (!sprite) return;
  await Promise.all([sprite.source, sprite.poster].map((source) => {
    const uri = assetSourceUri(source, Image.resolveAssetSource);
    // Native release assets are already packaged locally. RN prefetch is for remote images.
    if (!uri || (Platform.OS !== "web" && !/^https?:\/\//i.test(uri))) return false;
    return prefetchUri(uri);
  }));
}
