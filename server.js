import { appendFile } from "fs/promises";
import path from "path";
import nodemailer from "nodemailer";

const CSV_PATH = path.join(import.meta.dir, "inquiries.csv");
const CSV_COLUMNS = ["timestamp", "first_name", "last_name", "email", "phone", "who", "message"];
const FORWARD_TO = process.env.FORWARD_TO || "reach.seattle.homes@gmail.com";

function csvEscape(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

async function ensureCsv() {
  if (!(await Bun.file(CSV_PATH).exists())) {
    await Bun.write(CSV_PATH, CSV_COLUMNS.join(",") + "\n");
  }
}

let transporter;
function getTransporter() {
  if (transporter !== undefined) return transporter;
  const { SMTP_USER, SMTP_PASS } = process.env;
  transporter = SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({ service: "gmail", auth: { user: SMTP_USER, pass: SMTP_PASS } })
    : null;
  return transporter;
}

async function handleInterest(req) {
  let data;
  try {
    data = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const fname = (data.fname || "").trim();
  const lname = (data.lname || "").trim();
  const email = (data.email || "").trim();
  const phone = (data.phone || "").trim();
  const who = (data.who || "").trim();
  const msg = (data.msg || "").trim();

  if (!fname || !lname || !email || !phone) {
    return Response.json({ ok: false, error: "Missing required fields" }, { status: 400 });
  }

  await ensureCsv();
  const row = [new Date().toISOString(), fname, lname, email, phone, who, msg]
    .map(csvEscape)
    .join(",") + "\n";
  await appendFile(CSV_PATH, row);

  let emailSent = false;
  const t = getTransporter();
  if (t) {
    try {
      await t.sendMail({
        from: process.env.SMTP_USER,
        to: FORWARD_TO,
        replyTo: email,
        subject: `New waitlist inquiry — ${fname} ${lname}`,
        text: [
          "New inquiry from the Blue Ocean Housing website:",
          "",
          `Name: ${fname} ${lname}`,
          `Email: ${email}`,
          `Phone: ${phone}`,
          `I am a: ${who || "(not specified)"}`,
          `Message: ${msg || "(none)"}`,
        ].join("\n"),
      });
      emailSent = true;
    } catch (err) {
      console.error("Failed to send inquiry email:", err);
    }
  } else {
    console.warn(
      "SMTP_USER/SMTP_PASS not set — inquiry saved to CSV but not emailed. See README for setup."
    );
  }

  return Response.json({ ok: true, emailSent });
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/api/interest") {
      return handleInterest(req);
    }

    let filePath = url.pathname;
    if (filePath === "/") filePath = "/index.html";

    const isPublic =
      filePath === "/index.html" ||
      filePath === "/units.html" ||
      filePath === "/fair-housing.html" ||
      filePath === "/favicon.ico" ||
      filePath.startsWith("/images/");
    if (!isPublic) return new Response("Not found", { status: 404 });

    const file = Bun.file(`.${filePath}`);
    if (await file.exists()) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Listening on http://localhost:${server.port}`);
