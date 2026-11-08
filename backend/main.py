import os
import re
import json
import time
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from google.genai.errors import APIError

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://learncheck.pages.dev"
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY environment variable is not set")

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
client = genai.Client(api_key=GEMINI_API_KEY)


class QuizRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    age: int = Field(ge=5, le=100)
    gender: str
    field: str = Field(min_length=1, max_length=100)
    difficulty: str
    noOfQuestions: int = Field(ge=1, le=20)


@app.get("/")
def health():
    """Used by the frontend to wake the server up and by Render health checks."""
    return {"status": "ok"}


def build_prompt(qa: QuizRequest) -> str:
    return f"""
You are an intelligent AI Quiz Generator for students.

STUDENT DETAILS:
Name: {qa.name}
Age: {qa.age}
Gender: {qa.gender}
Subject/Field: {qa.field}
Difficulty: {qa.difficulty}
Number of Questions: {qa.noOfQuestions}

YOUR TASK:
Generate exactly {qa.noOfQuestions} unique multiple-choice quiz questions.

RULES:
1. All questions must be related to {qa.field}.
2. Questions must match the student's age and knowledge level.
3. Follow the selected difficulty:
   - Easy: Basic concepts and simple questions.
   - Medium: Conceptual and application-based questions.
   - Hard: Advanced concepts and problem-solving.
4. Cover different topics within the selected field.
5. Do not repeat questions.
6. Each question must have exactly 4 options (keys A, B, C, D).
7. Only one option must be correct.
8. Provide the correct answer (A, B, C or D) and a short explanation.
9. Use simple and understandable language.
10. Do not generate questions outside the selected field.

OUTPUT FORMAT (valid JSON only, no Markdown code blocks):

{{
    "field": "{qa.field}",
    "difficulty": "{qa.difficulty}",
    "questions": [
        {{
            "question": "Question text",
            "options": {{"A": "Option 1", "B": "Option 2", "C": "Option 3", "D": "Option 4"}},
            "correct_answer": "A",
            "explanation": "Explanation of the answer"
        }}
    ]
}}
"""


def parse_and_validate(text: str) -> dict:
    # Strip ```json fences if the model adds them anyway
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    data = json.loads(text)

    questions = data.get("questions")
    if not isinstance(questions, list) or not questions:
        raise ValueError("No questions in response")

    for q in questions:
        opts = q.get("options")
        if (
            not q.get("question")
            or not isinstance(opts, dict)
            or set(opts.keys()) != {"A", "B", "C", "D"}
            or q.get("correct_answer") not in opts
        ):
            raise ValueError("Malformed question")
    return data


@app.post("/quiz")
def quiz(qa: QuizRequest):
    prompt = build_prompt(qa)
    last_error = "Unknown error"

    for attempt in range(3):
        try:
            print(f"Gemini request attempt {attempt + 1}")
            response = client.models.generate_content(
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                ),
            )
            return parse_and_validate(response.text)

        except (json.JSONDecodeError, ValueError, AttributeError) as e:
            # Bad/incomplete output from the model: retry
            last_error = "Gemini returned an invalid response."
            print("Parse/validation error:", e)

        except APIError as e:
            print("Gemini API error:", e)
            code = getattr(e, "code", None)

            if code == 429:
                raise HTTPException(429, "Rate limit reached. Please wait a minute and try again.")
            if code in (400, 401, 403, 404):
                # Config problem (bad key / model name): retrying won't help
                raise HTTPException(500, f"AI configuration error ({code}). Check API key and model name.")
            last_error = "AI service is temporarily busy. Try again later."

        except Exception as e:
            print("Unexpected error:", repr(e))
            raise HTTPException(500, "Unexpected server error.")

        if attempt < 2:
            time.sleep(2 ** attempt)

    raise HTTPException(503, last_error)