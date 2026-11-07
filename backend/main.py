
import os
import json
import time
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from google.genai.errors import ServerError
load_dotenv()

app = FastAPI()

# Comma-separated list of allowed frontend URLs, set on the host (Render).
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]

# Allow frontend to access backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY environment variable is not set")


client = genai.Client(api_key=GEMINI_API_KEY)


# Student details received from frontend
class QuizRequest(BaseModel):
    name: str
    age: int
    gender: str
    field: str
    difficulty: str


@app.post("/quiz")
def quiz(qa: QuizRequest):

    prompt = f"""
You are an intelligent AI Quiz Generator for students.

STUDENT DETAILS:
Name: {qa.name}
Age: {qa.age}
Gender: {qa.gender}
Subject/Field: {qa.field}
Difficulty: {qa.difficulty}

YOUR TASK:

Generate exactly 10 unique multiple-choice quiz questions.

RULES:

1. All questions must be related to {qa.field}.
2. Questions must match the student's age and knowledge level.
3. Follow the selected difficulty:
   - Easy: Basic concepts and simple questions.
   - Medium: Conceptual and application-based questions.
   - Hard: Advanced concepts and problem-solving.
4. Cover different topics within the selected field.
5. Do not repeat questions.
6. Each question must have exactly 4 options.
7. Only one option must be correct.
8. Provide the correct answer and a short explanation.
9. Use simple and understandable language.
10. Do not generate questions outside the selected field.

OUTPUT FORMAT:

Return valid JSON in this structure:

{{
    "field": "{qa.field}",
    "difficulty": "{qa.difficulty}",
    "questions": [
        {{
            "question": "Question text",
            "options": {{
                "A": "Option 1",
                "B": "Option 2",
                "C": "Option 3",
                "D": "Option 4"
            }},
            "correct_answer": "A",
            "explanation": "Explanation of the answer"
        }}
    ]
}}

IMPORTANT:
- Generate exactly 10 questions.
- Return valid JSON only.
- Do not include Markdown code blocks.
"""

    # Retry mechanism
    for attempt in range(3):

        try:
            print(f"Gemini request attempt {attempt + 1}")

            response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_mime_type="application/json"
    )
)
            # Convert JSON text into Python dictionary
            quiz_data = json.loads(response.text)

            return quiz_data

        except ServerError as e:

            print("Gemini server error:", e)

            if attempt == 2:
                raise HTTPException(
                    status_code=503,
                    detail="AI service is temporarily busy. Try again later."
                )

            wait_time = 2 ** attempt

            print(f"Retrying in {wait_time} seconds...")
            time.sleep(wait_time)

        except json.JSONDecodeError:
            raise HTTPException(
                status_code=502,
                detail="Gemini returned an invalid JSON response."
            )
