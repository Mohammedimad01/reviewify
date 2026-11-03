"use client";
import type { Session } from "./types";

/** jsPDF's built-in fonts are Latin-1 only: map common typography, drop the rest. */
function latin1(s: string) {
  return (s || "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs ")
    .replace(/€/g, "EUR ")
    .replace(/[•·]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "");
}

export async function downloadReportPDF(s: Session) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const maxW = W - M * 2;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (t: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 10;
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? [20, 20, 20]));
    const lines = doc.splitTextToSize(latin1(t), maxW - (opts.indent ?? 0)) as string[];
    const lh = size * 1.35;
    for (const line of lines) {
      ensure(lh);
      doc.text(line, M + (opts.indent ?? 0), y);
      y += lh;
    }
    y += opts.gap ?? 4;
  };
  const bullets = (items: string[], indent = 10) => items.forEach((i) => text(`- ${i}`, { indent, gap: 1 }));
  const rule = () => {
    ensure(14);
    doc.setDrawColor(200);
    doc.line(M, y, W - M, y);
    y += 14;
  };

  const r = s.report;
  text("Mock Interview Report", { size: 20, bold: true, gap: 2 });
  text(
    `${s.config.role} - ${s.config.seniority} - ${s.config.round} - ${s.config.persona} interviewer - ${new Date(s.createdAt).toLocaleString()}`,
    { size: 9, color: [110, 110, 110], gap: 10 },
  );

  if (r) {
    text(`Overall score: ${r.overallScore}/100   Verdict: ${r.verdict.toUpperCase()}`, { size: 14, bold: true });
    text(r.verdictReason, { gap: 10 });
    rule();

    text("Top 3 gaps vs the job description", { size: 13, bold: true });
    r.topGaps.forEach((g, i) => {
      text(`${i + 1}. ${g.gap}`, { bold: true, gap: 1 });
      text(`Prepare: ${g.prepare}`, { indent: 12 });
    });
    rule();

    text("Communication", { size: 13, bold: true });
    if (s.stats) {
      text(
        `Filler words: ${s.stats.fillerCount}${Object.keys(s.stats.fillerBreakdown).length ? " (" + Object.entries(s.stats.fillerBreakdown).map(([k, v]) => `${k}: ${v}`).join(", ") + ")" : ""}. ` +
          `Answers: ${s.stats.answers}, avg ${s.stats.avgWordsPerAnswer} words${s.stats.avgAnswerSeconds ? `, ~${s.stats.avgAnswerSeconds}s each` : ""}, longest ${s.stats.longestAnswerWords} words.`,
      );
    }
    bullets(r.communication.notes);
    if (r.communication.rambling) text(`Rambling: ${r.communication.rambling}`, { gap: 8 });
    rule();

    text("Question-by-question", { size: 13, bold: true, gap: 8 });
    for (const q of r.perQuestion) {
      ensure(60);
      text(`Q${q.questionIndex + 1}. ${q.question}`, { bold: true, gap: 2 });
      text(`Score: ${q.score}/10`, { color: [60, 60, 160], gap: 2 });
      if (q.good.length) {
        text("What was good:", { bold: true, gap: 1 });
        bullets(q.good);
      }
      if (q.missing.length) {
        text("What was missing:", { bold: true, gap: 1 });
        bullets(q.missing);
      }
      text("Improved answer (STAR):", { bold: true, gap: 1 });
      text(`Situation: ${q.improvedAnswer.situation}`, { indent: 10, gap: 1 });
      text(`Task: ${q.improvedAnswer.task}`, { indent: 10, gap: 1 });
      text(`Action: ${q.improvedAnswer.action}`, { indent: 10, gap: 1 });
      text(`Result: ${q.improvedAnswer.result}`, { indent: 10, gap: 10 });
    }
    rule();
  }

  text("Transcript", { size: 13, bold: true, gap: 8 });
  for (const t of s.transcript) {
    text(t.speaker === "interviewer" ? "Interviewer" : "Candidate", { bold: true, size: 9, color: [110, 110, 110], gap: 0 });
    text(t.text, { gap: 6 });
  }

  const safe = s.config.role.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save(`interview-report-${safe}-${new Date(s.createdAt).toISOString().slice(0, 10)}.pdf`);
}
