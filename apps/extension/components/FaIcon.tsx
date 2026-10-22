import type { CSSProperties } from "react";
import { config, type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon, type FontAwesomeIconProps } from "@fortawesome/react-fontawesome";

// La extensión usa shadow DOM y CSP estrictas en algunos portales. Fijamos el
// tamaño en línea y evitamos depender del CSS global que inyecta Font Awesome.
config.autoAddCss = false;

export interface FaIconProps extends Omit<FontAwesomeIconProps, "icon" | "size" | "style"> {
  icon: IconDefinition;
  /** Tamaño en píxeles. */
  size?: number;
  style?: CSSProperties;
}

export function FaIcon({ icon, size = 16, className, style, ...props }: FaIconProps) {
  return (
    <FontAwesomeIcon
      icon={icon}
      className={["shrink-0", className].filter(Boolean).join(" ")}
      style={{
        width: size,
        height: size,
        display: "inline-block",
        verticalAlign: "-0.125em",
        ...style,
      }}
      {...props}
    />
  );
}
