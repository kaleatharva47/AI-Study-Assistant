
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs";
import JSZip from "jszip";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// ===============================
// UPLOAD DIRECTORY
// ===============================

const uploadDir = "uploads";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// ===============================
// MULTER CONFIGURATION
// ===============================

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

// ===============================
// EXTRACT TEXT FROM PPTX
// ===============================

async function extractText(filePath) {
  const zip = await JSZip.loadAsync(
    fs.readFileSync(filePath)
  );

  const names = Object.keys(zip.files)
    .filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name)
    )
    .sort((a, b) => {
      const slideA = Number(
        a.match(/slide(\d+)/)[1]
      );

      const slideB = Number(
        b.match(/slide(\d+)/)[1]
      );

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

// ===============================
// GROQ AI FUNCTION
// ===============================

async function askAI(prompt) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY is missing in .env"
    );
  }

  console.log("Sending request to Groq AI...");

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },

      body: JSON.stringify({
        model: "llama-3.1-8b-instant",

        messages: [
          {
            role: "user",
            content: prompt
          }
        ],

        temperature: 0.2,
        max_tokens: 4000
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Groq API Error:", data);

    throw new Error(
      data?.error?.message ||
      `Groq API error: ${response.status}`
    );
  }

  const text =
    data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error(
      "Groq returned an empty response."
    );
  }

  console.log(
    "Groq AI response received successfully."
  );

  return text;
}

// ===============================
// HOME ROUTE
// ===============================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message:
      "AI Study Assistant Backend is running"
  });
});

// ===============================
// ANALYZE PPT ROUTE
// ===============================

app.post(
  "/api/analyze",
  upload.single("ppt"),

  async (req, res) => {
    let filePath;

    try {
      // -------------------------------
      // CHECK FILE
      // -------------------------------

      if (!req.file) {
        return res.status(400).json({
          error:
            "Please upload a PPTX file."
        });
      }

      // -------------------------------
      // CHECK FILE TYPE
      // -------------------------------

      if (
        !req.file.originalname
          .toLowerCase()
          .endsWith(".pptx")
      ) {
        return res.status(400).json({
          error:
            "Only .pptx files are supported."
        });
      }

      filePath = req.file.path;

      console.log(
        "PPT received:",
        req.file.originalname
      );

      // -------------------------------
      // EXTRACT SLIDES
      // -------------------------------

      const slides =
        await extractText(filePath);

      console.log(
        "Slides extracted:",
        slides.length
      );

      // -------------------------------
      // CREATE CONTENT
      // -------------------------------

      const content = slides
        .map(
          (slide, index) =>
            `Slide ${index + 1}: ${slide}`
        )
        .join("\n");

      if (!content.trim()) {
        return res.status(400).json({
          error:
            "No readable text found in PPTX."
        });
      }

      // -------------------------------
      // AI PROMPT
      // -------------------------------

      const prompt = `
You are an AI Study Assistant for college students.

Analyze the PowerPoint content provided below.

Your job is to create:

1. A clear study-friendly summary.
2. A list of important topics.
3. Exactly 10 multiple-choice questions.

IMPORTANT RULES:

- Return ONLY valid JSON.
- Do NOT use Markdown.
- Do NOT use code blocks.
- Do NOT add any explanation outside JSON.
- Questions must be based ONLY on the PowerPoint content.
- Do not invent information.
- Use simple English suitable for college students.
- Every MCQ must have exactly 4 options.
- The answer must be exactly one of the four options.
- Include a short explanation for every answer.
- Create exactly 10 MCQs.

Use EXACTLY this JSON structure:

{
  "summary": "Clear study-friendly summary",

  "importantTopics": [
    "Topic 1",
    "Topic 2",
    "Topic 3"
  ],

  "quiz": [
    {
      "question": "Question 1",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": "Option A",
      "explanation": "Short explanation"
    }
  ]
}

POWERPOINT CONTENT:

${content.slice(0, 120000)}
`;

      // -------------------------------
      // ASK GROQ
      // -------------------------------

      let raw = await askAI(prompt);

      console.log(
        "Raw AI response received."
      );

      // -------------------------------
      // CLEAN AI RESPONSE
      // -------------------------------

      raw = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      // -------------------------------
      // FIND JSON
      // -------------------------------

      const firstBrace =
        raw.indexOf("{");

      const lastBrace =
        raw.lastIndexOf("}");

      if (
        firstBrace !== -1 &&
        lastBrace !== -1
      ) {
        raw = raw.substring(
          firstBrace,
          lastBrace + 1
        );
      }

      // -------------------------------
      // PARSE JSON
      // -------------------------------

      let result;

      try {
        result = JSON.parse(raw);
      } catch (jsonError) {
        console.error(
          "Invalid JSON from AI:"
        );

        console.error(raw);

        throw new Error(
          "AI returned an invalid JSON response. Please try again."
        );
      }

      // -------------------------------
      // VALIDATE RESULT
      // -------------------------------

      if (
        !result.summary ||
        !Array.isArray(
          result.importantTopics
        ) ||
        !Array.isArray(result.quiz)
      ) {
        throw new Error(
          "AI returned an incomplete result."
        );
      }

      // -------------------------------
      // CHECK QUESTIONS
      // -------------------------------

      if (result.quiz.length < 10) {
        throw new Error(
          `AI generated only ${result.quiz.length} questions. Please try again.`
        );
      }

      // Exactly 10 questions
      result.quiz =
        result.quiz.slice(0, 10);

      // -------------------------------
      // SEND RESULT
      // -------------------------------

      res.json({
        success: true,
        slides: slides.length,
        summary: result.summary,
        importantTopics:
          result.importantTopics,
        quiz: result.quiz
      });

    } catch (error) {
      console.error(
        "ANALYSIS ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message ||
          "Analysis failed"
      });

    } finally {

      // -------------------------------
      // DELETE UPLOADED PPT
      // -------------------------------

      if (
        filePath &&
        fs.existsSync(filePath)
      ) {
        try {
          fs.unlinkSync(filePath);

          console.log(
            "Uploaded PPT deleted."
          );

        } catch (deleteError) {
          console.error(
            "Could not delete uploaded file:",
            deleteError.message
          );
        }
      }
    }
  }
);

// ===============================
// START SERVER
// ===============================

const PORT =
  process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
