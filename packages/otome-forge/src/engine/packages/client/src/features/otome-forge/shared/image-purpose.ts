import type { ImageSettings } from "./api-types";

export const IMAGE_PURPOSES = ["scenes", "sprites", "expressions"] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

/** The connection a picture of this purpose is painted on: its own when set, else the story's; none while images are off. */
export function imageConnectionFor(
  images: Pick<ImageSettings, "connectionId" | "purposeConnections">,
  purpose: ImagePurpose,
): string | null {
  return images.connectionId ? images.purposeConnections?.[purpose] || images.connectionId : null;
}
