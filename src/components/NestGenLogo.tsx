import Image from "next/image";

/**
 * The official NestGen mark. Single source of truth — both the persistent nav
 * and the reveal render through this component, so they can never drift apart.
 *
 * The asset is used exactly as supplied: never recoloured, re-typeset,
 * re-proportioned, or decorated.
 */
export const LOGO = {
  src: "/brand/nestgen-logo.webp",
  /**
   * Measured from the supplied file. If the asset is ever replaced, update these
   * to the new file's real dimensions — they drive the reserved aspect ratio and
   * therefore both layout stability and correct proportions.
   */
  width: 1600,
  height: 1777,
} as const;

/**
 * A wrapper owns the height + aspect-ratio and the image fills it.
 *
 * The box therefore has correct dimensions before the bitmap arrives (no layout
 * shift) and stays correct even if the image never loads. Sizing the <img>
 * itself with `width: auto` does NOT survive that case — an unloaded image has
 * zero intrinsic width, which collapses the element to 0px.
 */
export default function NestGenLogo({
  /** any CSS length — clamp() is fine, which keeps it responsive without classes */
  height,
  /** hint for the optimizer: widest rendered width in px */
  maxRenderedWidth,
  className = "",
  priority = false,
}: {
  height: string;
  maxRenderedWidth: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={`relative block ${className}`}
      style={{ height, aspectRatio: `${LOGO.width} / ${LOGO.height}` }}
    >
      <Image
        src={LOGO.src}
        alt="NestGen '26"
        fill
        // eager even when not priority: the reveal is a brand moment, so it must
        // never depend on a lazy-load firing at the right scroll position
        priority={priority}
        loading={priority ? undefined : "eager"}
        sizes={`${maxRenderedWidth}px`}
        style={{ objectFit: "contain" }}
      />
    </span>
  );
}
