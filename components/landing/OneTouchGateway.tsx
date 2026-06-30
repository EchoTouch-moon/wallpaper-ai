"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { OneTouchIntro } from "@/components/landing/OneTouchIntro";
import styles from "./OneTouchGateway.module.css";

type OneTouchGatewayProps = {
  children: ReactNode;
};

export function OneTouchGateway({ children }: OneTouchGatewayProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isIntroVisible, setIsIntroVisible] = useState(true);
  const [isContentRevealed, setIsContentRevealed] = useState(false);

  const handleRevealStart = useCallback(() => {
    setIsContentRevealed(true);
  }, []);

  const handleIntroComplete = useCallback(() => {
    setIsContentRevealed(true);
    setIsIntroVisible(false);
  }, []);

  return (
    <div className={styles.gateway}>
      <div
        ref={contentRef}
        className={`${styles.content} ${
          isContentRevealed ? styles.contentRevealed : ""
        }`}
        aria-hidden={!isContentRevealed}
      >
        {children}
      </div>

      {isIntroVisible ? (
        <OneTouchIntro
          contentRef={contentRef}
          onRevealStart={handleRevealStart}
          onComplete={handleIntroComplete}
        />
      ) : null}
    </div>
  );
}
