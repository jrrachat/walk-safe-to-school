import { useRef, type CSSProperties, type ReactNode } from "react";
export type SheetState = "collapsed" | "half" | "expanded";
const stops: SheetState[] = ["collapsed", "half", "expanded"];
export default function BottomSheet({
  state,
  onChange,
  children,
}: {
  state: SheetState;
  onChange: (state: SheetState) => void;
  children: ReactNode;
}) {
  const drag = useRef<{ y: number; height: number } | null>(null),
    panel = useRef<HTMLElement>(null);
  return (
    <aside
      ref={panel}
      className="planner"
      data-sheet={state}
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLInputElement &&
          window.innerWidth <= 900
        )
          onChange("expanded");
      }}
      style={{ "--sheet-drag": "0px" } as CSSProperties}
    >
      <button
        className="sheet-handle"
        aria-label="Resize destination panel"
        aria-valuetext={state}
        title="Drag up for details or down for more map"
        onPointerDown={(e) => {
          drag.current = {
            y: e.clientY,
            height: panel.current?.getBoundingClientRect().height || 0,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            panel.current?.style.setProperty(
              "--sheet-drag",
              Math.max(-180, Math.min(180, drag.current.y - e.clientY)) + "px",
            );
        }}
        onPointerUp={(e) => {
          const dy = drag.current ? drag.current.y - e.clientY : 0;
          drag.current = null;
          panel.current?.style.setProperty("--sheet-drag", "0px");
          if (Math.abs(dy) > 35)
            onChange(
              stops[
                Math.max(
                  0,
                  Math.min(2, stops.indexOf(state) + (dy > 0 ? 1 : -1)),
                )
              ],
            );
          else onChange(state === "expanded" ? "half" : "expanded");
        }}
        onPointerCancel={() => {
          drag.current = null;
          panel.current?.style.setProperty("--sheet-drag", "0px");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(
              stops[
                Math.max(
                  0,
                  Math.min(
                    2,
                    stops.indexOf(state) + (e.key === "ArrowUp" ? 1 : -1),
                  ),
                )
              ],
            );
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(state === "expanded" ? "half" : "expanded");
          }
        }}
      >
        <span />
      </button>
      <div className="panel-scroll">{children}</div>
    </aside>
  );
}
