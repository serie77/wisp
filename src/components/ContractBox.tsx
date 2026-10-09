"use client";
import { useState } from "react";

/** The official Wisp token address (WISP_TOKEN_MINT), copyable. Empty until launch. */
export function ContractBox({ mint, className = "" }: { mint: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!mint) return;
    try { await navigator.clipboard.writeText(mint); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div className={`ca-box ${className}`}>
      <span className="ca-label">CA</span>
      {mint ? (
        <button type="button" onClick={copy} className="ca-addr" title="Copy contract address" aria-label={`Copy contract address ${mint}`}>
          <span className="truncate">{mint}</span>
          <span className="ca-copy" aria-hidden="true">{copied ? "copied" : "copy"}</span>
        </button>
      ) : (
        <span className="ca-addr ca-empty">Not live yet</span>
      )}
    </div>
  );
}
