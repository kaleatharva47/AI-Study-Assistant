
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import path from "path";
import JSZip from "jszip";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const uploadDir = "uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

async function extractText(filePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));

  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const slideA = Number(a.match(/slide(\d+)/)[1]);
      const slideB = Number(b.match(/slide(\d+)/)[1]);
      return slideA - slideB;
    });

  const slides = [];

  for (const name of names) {
    const xml = await zip.files[name].async("string");

    const texts = [
      ...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)
    ].map((match) =>
      match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    );

    if (texts.length) {
      slides.push(texts.join(" "));
    }
  }

  return slides;
}

async function askAI(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing in .env");
  }

  const { GoogleGenerativeAI } =
    await import("@google/generative-ai");

  const ai = new GoogleGenerativeAI(
    process.env.GEMINI_API_KEY
  );

  const model = ai.getGenerativeModel({
    model: "gemini-3.6-flash"
  });

  const result = await model.generateContent(prompt);

  return result.response.text();
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "AI Study Assistant Backend is running"
  });
});

app.post(
  "/api/analyze",
  upload.single("ppt"),
  async (req, res) => {
    let filePath;

    try {
      if (!req.file) {
        return res.status(400).json({
          error: "Please upload a PPTX file."
        });
      }

      if (
        !req.file.originalname
          .toLowerCase()
          .endsWith(".pptx")
      ) {
        return res.status(400).json({
          error: "Only .pptx files are supported."
        });
      }

      filePath = req.file.path;

      console.log("PPT received:", req.file.originalname);

      const slides = await extractText(filePath);

      console.log("Slides extracted:", slides.length);

      const content = slides
        .map((slide, index) => `Slide ${index + 1}: ${slide}`)
        .join("\n");

      if (!content.trim()) {
        return res.status(400).json({
          error: "No readable text found in PPTX."
        });
      }

      const prompt = `
Analyze this PowerPoint as a college study assistant.

Return ONLY valid JSON.

Use exactly this format:

{
  "summary": "A clear study-friendly summary",
  "importantTopics": [
    "Topic 1",
    "Topic 2",
    "Topic 3"
  ],
  "quiz": [
    {
      "question": "Question",
      "options": ["A", "B", "C", "D"],
      "answer": "A",
      "explanation": "Short explanation"
    }
  ]
}

Create exactly 10 MCQs.

The questions must be based ONLY on the PowerPoint content.

Keep the language simple and suitable for college students.

POWERPOINT CONTENT:

${content.slice(0, 120000)}
`;

      let raw = await askAI(prompt);

      raw = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      const result = JSON.parse(raw);

      res.json({
        success: true,
        slides: slides.length,
        summary: result.summary,
        importantTopics: result.importantTopics,
        quiz: result.quiz
      });

    } catch (error) {
      console.error("ANALYSIS ERROR:", error);

      res.status(500).json({
        error: error.message || "Analysis failed"
      });

    } finally {
      if (
        filePath &&
        fs.existsSync(filePath)
      ) {
        fs.unlinkSync(filePath);
      }
    }
  }
);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

