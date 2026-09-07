import { useState } from "react";
import "./style.css";

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const analyzePPT = async () => {
    if (!file) {
      setError("Please select a PPTX file first.");
      return;
    }

    setLoading(true);
    setError("");
    setData(null);

    try {
      const formData = new FormData();
      formData.append("ppt", file);

      const response = await fetch("http://localhost:5000/api/analyze", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Analysis failed");
      }

      setData(result);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to fetch");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="container">

        <p className="badge">AI PROJECT</p>

        <h1>Smart Study Assistant</h1>

        <p className="subtitle">
          Upload any PPTX → AI Summary → Important Topics → Quiz
        </p>

        <div className="upload-card">
          <h2>📄 Upload Any PowerPoint</h2>

          <p>
            Use any normal text-based .pptx from any subject.
          </p>

          <input
            type="file"
            accept=".pptx"
            onChange={(e) => {
              setFile(e.target.files[0]);
              setError("");
              setData(null);
            }}
          />

          {file && (
            <p className="filename">
              Selected: <b>{file.name}</b>
            </p>
          )}

          <button onClick={analyzePPT} disabled={loading}>
            {loading ? "⏳ Analyzing..." : "✨ Analyze with AI"}
          </button>

          {error && <div className="error">{error}</div>}
        </div>

        {data && (
          <div className="results">

            <section className="result-card">
              <h2>📝 AI Summary</h2>
              <p>{data.summary}</p>
            </section>

            <section className="result-card">
              <h2>⭐ Important Topics</h2>

              <ul>
                {data.importantTopics?.map((topic, index) => (
                  <li key={index}>{topic}</li>
                ))}
              </ul>
            </section>

            <section className="result-card">
              <h2>🧠 Quiz</h2>

              {data.quiz?.map((q, index) => (
                <div className="quiz-question" key={index}>
                  <h3>
                    {index + 1}. {q.question}
                  </h3>

                  <div className="options">
                    {q.options?.map((option, optionIndex) => (
                      <div className="option" key={optionIndex}>
                        {option}
                      </div>
                    ))}
                  </div>

                  <p className="answer">
                    <b>Answer:</b> {q.answer}
                  </p>

                  <p>
                    <b>Explanation:</b> {q.explanation}
                  </p>
                </div>
              ))}
            </section>

          </div>
        )}

      </div>
    </div>
  );
}

export default App;