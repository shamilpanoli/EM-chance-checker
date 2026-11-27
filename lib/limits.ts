// Shared by browser and server. Vercel serverless functions accept request bodies up to 4.5 MB.
export const MAX_FILE_BYTES = 4.5 * 1024 * 1024;
export const MAX_FILE_LABEL = "4.5 MB";
export const ACCEPTED_EXT = [".pdf", ".docx"];
export const ACCEPTED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
export const MIN_TEXT_CHARS = 200;
export const RATE_LIMIT_PER_HOUR = 5;
