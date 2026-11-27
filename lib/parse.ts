import "server-only";
import { AppError } from "@/lib/errors";
import { ACCEPTED_EXT, MAX_FILE_BYTES, MAX_FILE_LABEL, MIN_TEXT_CHARS } from "@/lib/limits";

export type Parsed = { text: string; pageCount: number; kind: "pdf" | "docx" };

/** Extracts text in memory only. The file and text are never written anywhere. */
export async function parseResume(file: File): Promise<Parsed> {
  const name = file.name.toLowerCase();
  const ext = ACCEPTED_EXT.find((e) => name.endsWith(e));
  if (!ext) throw new AppError("BAD_TYPE", "Please upload a PDF or DOCX file.", 415, false);
  if (file.size > MAX_FILE_BYTES)
    throw new AppError("FILE_TOO_LARGE", `That file is too big. The limit is ${MAX_FILE_LABEL}.`, 413, false);

  const buf = new Uint8Array(await file.arrayBuffer());
  const unreadable = new AppError(
    "UNREADABLE_FILE",
    "We couldn't read text from this file. Upload a text PDF or DOCX.",
    422,
    false
  );

  let text = "";
  let pageCount = 1;
  try {
    if (ext === ".pdf") {
      if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) throw unreadable; // %PDF
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(buf);
      const out = await extractText(pdf, { mergePages: true });
      text = out.text;
      pageCount = out.totalPages;
    } else {
      if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw unreadable; // zip "PK"
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: Buffer.from(buf) });
      text = out.value;
      // DOCX has no fixed pages; estimate ~550 words per page.
      pageCount = Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 550));
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw unreadable;
  }

  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS) throw unreadable;
  // Guard against absurdly long docs (keeps cost and latency bounded).
  if (text.length > 60_000) text = text.slice(0, 60_000);
  return { text, pageCount, kind: ext === ".pdf" ? "pdf" : "docx" };
}
