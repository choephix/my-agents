import { useState, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { focusFromKeyboard } from "./web";

export interface InteractionState {
  hovered: boolean;
  pressed: boolean;
  /** Focused by keyboard (not after a click), i.e. `:focus-visible`. */
  focused: boolean;
}

type Props = Omit<PressableProps, "style" | "children"> & {
  style(state: InteractionState): StyleProp<ViewStyle>;
  children: ReactNode | ((state: InteractionState) => ReactNode);
  /** A callback ref on the host element (web tooltips). */
  ref?: (node: unknown) => void;
};

/**
 * Pressable with hover and keyboard-focus state, the pointer cursor, and one style function for
 * all states. Hover and focus only fire on web; phones get the pressed state.
 */
export function Interactive({ style, children, onHoverIn, onHoverOut, onFocus, onBlur, ...rest }: Props) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...rest}
      onHoverIn={(event) => {
        setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      onFocus={(event) => {
        setFocused(focusFromKeyboard());
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={({ pressed }) => [{ cursor: rest.disabled ? "auto" : "pointer" }, style({ hovered, pressed, focused })]}
    >
      {({ pressed }) => (typeof children === "function" ? children({ hovered, pressed, focused }) : children)}
    </Pressable>
  );
}
