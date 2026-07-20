// Evidence -- trust-evidence (success) or trust-boundary (deny) callout. Renders
// the per-scenario lead/body copy passed in from the CP model.
import { ShieldCheck, ShieldAlert } from "lucide-react";
import type { EvidenceItem } from "../engine/providers";
import { t } from "../i18n";

interface EvidenceProps {
  kind: "success" | "error";
  items: EvidenceItem[];
}

const styles = {
  evidence: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 13,
    padding: "16px 18px",
    borderRadius: "var(--radius-lg)",
    borderLeft: "3px solid",
  },
  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  evidenceList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  },
  evidenceItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  evidenceLead: {
    fontSize: 13,
    color: "var(--text-strong)",
    fontWeight: 700,
  },
  evidenceBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  },
};

export function Evidence({ kind, items }: EvidenceProps) {
  const accent = kind === "error" ? "var(--status-danger)" : "var(--brand)";
  const bg =
    kind === "error" ? "rgba(200,71,39,0.06)" : "var(--surface-brand-tint)";
  const Icon = kind === "error" ? ShieldAlert : ShieldCheck;

  return (
    <div
      style={{
        ...styles.evidence,
        borderColor: accent,
        background: bg,
        border: `1px solid ${accent}`,
      }}
    >
      <div style={{ ...styles.evidenceHead, color: accent }}>
        <Icon size={15} />
        <span className="idira-eyebrow" style={{ color: accent }}>
          {kind === "error"
            ? t("chrome.evidence.title.error")
            : t("chrome.evidence.title.success")}
        </span>
      </div>
      <div style={styles.evidenceList}>
        {items.map((it, i) => (
          <div key={i} style={styles.evidenceItem}>
            <strong style={styles.evidenceLead}>{it.lead}</strong>
            <span style={styles.evidenceBody}>{it.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
