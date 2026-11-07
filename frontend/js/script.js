'use strict';

// FastAPI backend (Render)
const API_BASE = "https://learncheck.onrender.com";
const API = `${API_BASE}/quiz`;

// Wake up the Render server as soon as the page loads (hides cold-start delay)
fetch(`${API_BASE}/`).catch(() => {});

// Quiz data
let questions = [];
let currentQuestion = 0;
let score = 0;
let answered = false;

// Student details for the current quiz
let studentData = {};

// DOM elements
const $ = (id) => document.getElementById(id);

const studentPanel = $('student-panel');
const studentForm = $('student-form');
const quizForm = $('quiz-form');

const questionElement = $('question');
const optionsElement = $('options');
const messageElement = $('message');

const submitBtn = $('submit-btn');
const nextBtn = $('next-btn');

const resultPanel = $('result-panel');
const resultSummary = $('result-summary');

const errorPanel = $('error-panel');
const errorText = $('error-text');
const retryBtn = $('retry-btn');

const progressText = $('progress-text');
const scoreText = $('score-text');
const progressBar = $('progress-bar');


// Generate quiz
studentForm.addEventListener('submit', async function (e) {
  e.preventDefault();

  // Collect student details
  studentData = {
    name: $('student-name').value.trim(),
    age: Number($('student-age').value),
    gender: $('student-gender').value,
    field: $('student-field').value.trim(),
    difficulty: $('student-difficulty').value
  };

  // Basic validation before calling the server
  if (!studentData.name || !studentData.field || !Number.isInteger(studentData.age)) {
    errorPanel.hidden = false;
    errorText.textContent = "Please fill in all fields with valid values.";
    return;
  }

  const generateBtn = studentForm.querySelector('button');
  generateBtn.disabled = true;
  generateBtn.textContent = "Generating Quiz... (first load may take ~30s)";
  errorPanel.hidden = true;

  // Abort if the server takes too long
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    let response;

    try {
      response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(studentData),
        signal: controller.signal
      });
    } catch (networkErr) {
      throw new Error(
        networkErr.name === "AbortError"
          ? "The server took too long to respond. Please try again."
          : "Can't reach the server. It may be waking up. Wait a few seconds and retry."
      );
    }

    // The body may not be JSON (e.g. a Render 502 HTML page)
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* ignore */
    }

    if (!response.ok) {
      const detail = data && data.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map(d => d.msg).join(", ")
            : `Server error (${response.status}). Please try again.`;
      throw new Error(message);
    }

    questions = data && data.questions;

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("No questions were received. Please try again.");
    }

    currentQuestion = 0;
    score = 0;

    studentPanel.hidden = true;
    errorPanel.hidden = true;

    loadQuestion();

  } catch (error) {
    studentPanel.hidden = false;
    errorPanel.hidden = false;
    errorText.textContent = error.message;
    console.error(error);

  } finally {
    clearTimeout(timeoutId);
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate My Quiz →";
  }
});


// Display question
function loadQuestion() {
  if (currentQuestion >= questions.length) {
    showResults();
    return;
  }

  answered = false;

  const q = questions[currentQuestion];

  questionElement.textContent = q.question;
  optionsElement.innerHTML = "";
  optionsElement.classList.remove("locked");

  Object.entries(q.options).forEach(([key, value]) => {
    const label = document.createElement("label");
    label.className = "option";
    label.dataset.value = key;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "q";
    input.value = key;

    const span = document.createElement("span");
    span.textContent = `${key}. ${value}`;

    label.appendChild(input);
    label.appendChild(span);

    optionsElement.appendChild(label);
  });

  messageElement.textContent = "";
  messageElement.className = "message";

  submitBtn.hidden = false;
  nextBtn.hidden = true;

  progressText.textContent =
    `Question ${currentQuestion + 1} of ${questions.length}`;

  scoreText.textContent = `Score: ${score}`;

  const percent = (currentQuestion / questions.length) * 100;

  progressBar.style.width = `${percent}%`;
  progressBar.parentElement.setAttribute("aria-valuenow", percent);

  quizForm.hidden = false;
  resultPanel.hidden = true;

  const firstInput = optionsElement.querySelector("input");
  if (firstInput) firstInput.focus();
}


// Get selected answer
function getSelectedValue() {
  const selected = quizForm.querySelector('input[name="q"]:checked');
  return selected ? selected.value : null;
}


// Check answer
quizForm.addEventListener("submit", function (e) {
  e.preventDefault();

  if (answered) return;

  const selectedAnswer = getSelectedValue();

  if (!selectedAnswer) {
    messageElement.textContent = "Please select an answer first.";
    messageElement.className = "message bad";
    return;
  }

  const q = questions[currentQuestion];
  const correct = selectedAnswer === q.correct_answer;

  if (correct) score++;

  answered = true;

  // Lock options and highlight answers
  optionsElement.classList.add("locked");

  optionsElement.querySelectorAll(".option").forEach(label => {
    const input = label.querySelector("input");
    input.disabled = true;

    if (label.dataset.value === q.correct_answer) {
      label.classList.add("correct");
    } else if (label.dataset.value === selectedAnswer) {
      label.classList.add("wrong");
    }
  });

  // Show explanation
  messageElement.textContent =
    (correct ? "Correct! " : "Incorrect. ") + (q.explanation || "");

  messageElement.className = correct ? "message ok" : "message bad";

  scoreText.textContent = `Score: ${score}`;

  submitBtn.hidden = true;
  nextBtn.hidden = false;

  nextBtn.textContent =
    currentQuestion === questions.length - 1
      ? "See Results"
      : "Next Question";
});


// Next question
nextBtn.addEventListener("click", function () {
  currentQuestion++;
  loadQuestion();
});


// Show final results and save them
function showResults() {
  quizForm.hidden = true;
  resultPanel.hidden = false;

  const total = questions.length;
  const percentage = Math.round((score / total) * 100);

  progressText.textContent = "Quiz completed";
  scoreText.textContent = `Score: ${score}`;

  progressBar.style.width = "100%";
  progressBar.parentElement.setAttribute("aria-valuenow", 100);

  let verdict;

  if (percentage >= 80) {
    verdict = "Excellent work!";
  } else if (percentage >= 50) {
    verdict = "Good effort. Keep practising!";
  } else {
    verdict = "Keep learning and try again!";
  }

  resultSummary.textContent =
    `Well done, ${studentData.name}! You scored ${score}/${total} (${percentage}%). ${verdict}`;

  // Create result object
  const result = {
    name: studentData.name,
    age: studentData.age,
    gender: studentData.gender,
    field: studentData.field,
    difficulty: studentData.difficulty,
    score: score,
    total: total,
    percentage: percentage,
    date: new Date().toLocaleString()
  };

  // Save to localStorage (guarded: storage can be blocked or full)
  try {
    let history = JSON.parse(localStorage.getItem("quizResults") || "[]");

    if (!Array.isArray(history)) {
      history = [];
    }

    history.push(result);

    // Keep only the latest 20 results
    history = history.slice(-20);

    localStorage.setItem("quizResults", JSON.stringify(history));
    console.log("Quiz result saved:", result);

  } catch (error) {
    console.error("Could not save quiz history:", error);
  }
}


// Restart quiz with same questions
$('restart-btn').addEventListener('click', function () {
  currentQuestion = 0;
  score = 0;
  loadQuestion();
});


// Retry if quiz generation fails
retryBtn.addEventListener('click', function () {
  errorPanel.hidden = true;
  studentPanel.hidden = false;
});


// Update footer year
$('year').textContent = new Date().getFullYear();


// Initial state
quizForm.hidden = true;
resultPanel.hidden = true;
errorPanel.hidden = true;
studentPanel.hidden = false;