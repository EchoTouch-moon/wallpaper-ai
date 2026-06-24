"use client";

import { useState, type FocusEvent, type ReactNode } from "react";
import styles from "./EditorDock.module.css";

export type EditorDockSide = "left" | "right";

export interface EditorDockItem {
  /** Stable key used for selection and accessible relationships. */
  id: string;
  /** Visible when the dock is expanded and always exposed as an accessible name. */
  label: string;
  icon: ReactNode;
  /** Marks the tool as selected when `activeId` is not supplied. */
  active?: boolean;
  disabled?: boolean;
  /** Id of the panel this tool reveals, when it has one. */
  controls?: string;
  onSelect?: () => void;
}

export interface EditorDockProps {
  items: readonly EditorDockItem[];
  side: EditorDockSide;
  /** Optional active item for a controlled dock. */
  activeId?: string | null;
  /** Optional controlled expansion state. Omit for hover/focus expansion. */
  expanded?: boolean;
  /** Default panel relationship for the active tool. */
  controls?: string;
  label?: string;
  className?: string;
  onItemSelect?: (item: EditorDockItem) => void;
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * A compact, keyboard-friendly vertical tool dock. The parent that owns the
 * revealed panel supplies `controls` (or a per-item `controls` id), while the
 * dock owns only its transient hover/focus expansion by default.
 */
export function EditorDock({
  items,
  side,
  activeId,
  expanded,
  controls,
  label = "编辑工具",
  className,
  onItemSelect,
  onExpandedChange,
}: EditorDockProps) {
  const [isEngaged, setIsEngaged] = useState(false);
  const isExpanded = expanded ?? isEngaged;

  const setExpansion = (nextExpanded: boolean) => {
    if (expanded === undefined) {
      setIsEngaged(nextExpanded);
    }
    onExpandedChange?.(nextExpanded);
  };

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setExpansion(false);
  };

  return (
    <nav
      aria-label={label}
      className={[styles.dock, styles[side], className].filter(Boolean).join(" ")}
      data-editor-dock="true"
      data-expanded={isExpanded}
      data-side={side}
      onMouseEnter={() => setExpansion(true)}
      onMouseLeave={() => setExpansion(false)}
      onFocus={() => setExpansion(true)}
      onBlur={handleBlur}
    >
      <div className={styles.toolList}>
        {items.map((item) => {
          const isActive = activeId === undefined ? Boolean(item.active) : item.id === activeId;
          const panelId = isActive ? item.controls ?? controls : undefined;

          return (
            <button
              aria-controls={panelId}
              aria-expanded={panelId ? isActive : undefined}
              aria-pressed={isActive}
              aria-label={item.label}
              className={styles.tool}
              data-active={isActive || undefined}
              disabled={item.disabled}
              key={item.id}
              onClick={() => {
                setExpansion(true);
                item.onSelect?.();
                onItemSelect?.(item);
              }}
              type="button"
            >
              <span aria-hidden="true" className={styles.icon}>
                {item.icon}
              </span>
              <span className={styles.label}>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
