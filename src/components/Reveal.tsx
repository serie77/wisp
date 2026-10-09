"use client";
import { useEffect } from "react";

/**
 * Adds `.in` to `.reveal` elements as they scroll into view. Watches the DOM so elements that mount
 * later (client-side navigation, streamed sections) are picked up too.
 */
export function Reveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.12 },
    );
    const scan = () => document.querySelectorAll<HTMLElement>(".reveal:not(.in)").forEach((el) => io.observe(el));
    let queued = 0;
    const mo = new MutationObserver(() => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; scan(); }); });
    scan();
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); cancelAnimationFrame(queued); };
  }, []);
  return null;
}
