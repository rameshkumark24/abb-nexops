"""
Seed the industrial_qa table from NexOps-Industrial-QA.pdf.

Run once:  python seed_qa.py
Safe to re-run — skips insert if rows already exist.
"""

import os
import re
import sys

from db import IndustrialQA, get_session, init_db


def parse_qa_from_pdf(pdf_path: str) -> list[dict]:
    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber not installed. Run: pip install pdfplumber")
        sys.exit(1)

    with pdfplumber.open(pdf_path) as pdf:
        text = ""
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"

    # Find the start of section body (skip TOC)
    body_start = text.find("01. Bearings and Lubrication\n")
    if body_start == -1:
        raise ValueError("Could not locate section body in PDF")
    body_text = text[body_start:]

    # Match section headers like "01. Bearings and Lubrication"
    section_pattern = re.compile(r"^(\d{2})\.\s+([A-Za-z][^\n(]+?)(?:\s*\n)", re.MULTILINE)
    sections = []
    for m in section_pattern.finditer(body_text):
        sections.append((m.start(), int(m.group(1)), m.group(2).strip()))

    # Extract Q&A pairs within each section boundary
    qa_pattern = re.compile(r"Q(\d+)\.\s+(.*?)\nA\.\s+(.*?)(?=\nQ\d+\.|$)", re.DOTALL)
    all_qa: list[dict] = []

    for i, (pos, sec_num, sec_name) in enumerate(sections):
        end = sections[i + 1][0] if i + 1 < len(sections) else len(body_text)
        section_text = body_text[pos:end]

        for m in qa_pattern.finditer(section_text):
            q_text = " ".join(m.group(2).split())
            a_text = " ".join(m.group(3).split())
            all_qa.append(
                {
                    "section_number": sec_num,
                    "section_name": sec_name,
                    "question": q_text,
                    "answer": a_text,
                }
            )

    return all_qa


def seed_qa(pdf_path: str | None = None) -> None:
    if pdf_path is None:
        pdf_path = os.path.join(os.path.dirname(__file__), "NexOps-Industrial-QA.pdf")

    if not os.path.exists(pdf_path):
        print(f"PDF not found at: {pdf_path}")
        sys.exit(1)

    init_db()
    session = get_session()
    try:
        existing = session.query(IndustrialQA).count()
        if existing > 0:
            print(f"industrial_qa already contains {existing} rows — skipping seed.")
            return

        print(f"Parsing Q&A pairs from: {pdf_path}")
        qa_pairs = parse_qa_from_pdf(pdf_path)
        print(f"Parsed {len(qa_pairs)} Q&A pairs across 38 sections.")

        for qa in qa_pairs:
            session.add(IndustrialQA(**qa))

        session.commit()
        print(f"Seeded {len(qa_pairs)} industrial Q&A entries into industrial_qa table.")
    except Exception as e:
        session.rollback()
        print(f"Seed failed: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    pdf_arg = sys.argv[1] if len(sys.argv) > 1 else None
    seed_qa(pdf_arg)