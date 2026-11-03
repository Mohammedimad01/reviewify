import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 4 * 1024 * 1024; // Vercel request bodies are capped at 4.5 MB

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 4 MB)." }, { status: 413 });
    }
    const name = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const out = await extractText(pdf, { mergePages: true });
      text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
    } else if (
      name.endsWith(".docx") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: buf });
      text = out.value;
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = buf.toString("utf8");
    } else {
      return NextResponse.json({ error: "Unsupported file type. Upload a PDF or DOCX, or paste the text." }, { status: 415 });
    }

    text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 50) {
      return NextResponse.json(
        { error: "Couldn't read much text from that file (it may be a scanned image). Please paste your resume text instead." },
        { status: 422 },
      );
    }
    return NextResponse.json({ text });
  } catch (e) {
    console.error("extract failed", e);
    return NextResponse.json({ error: "Failed to read the file. Try pasting the text instead." }, { status: 500 });
  }
}
